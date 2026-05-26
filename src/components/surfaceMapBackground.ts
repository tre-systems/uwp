// Rendered-map background for the Surface view, projected through
// the same 20-face icosahedral net the hex grid sits on.
//
// For each pixel in the output canvas we map (x, y) → barycentric in
// the containing triangle → 3D point on the unit sphere → (lat, lon)
// → sample the Rust pre-bake. Pixels outside the net stay transparent
// so the canvas itself reads as an "unfolded icosahedron." Because
// every adjacent pair of flat triangles shares its edge on the
// icosahedron, continents flow continuously across fold lines.
//
// Colour comes from the canonical biome palette so the surface map
// agrees pixel-for-pixel with the globe shader and the region view.

import { netToSphere, NET_WIDTH, NET_HEIGHT } from '../domain/icosahedron'
import {
  biomeColorLinear,
  biomeIsIce,
  biomeIsOcean,
  linearToSrgb8,
  type PaletteBaseColors,
} from '../domain/surfaceMap/biomePalette'

export interface PreBake {
  lon_cells: number
  lat_cells: number
  heightmap: number[] | Float32Array
  biome_id?: number[] | Uint8Array
  sea_level_threshold?: number
}

interface RenderOptions {
  /** Fraction of cells classed as ocean. */
  waterFraction: number
  /** Latitude-derived ice cap onset, in degrees. Only used as a fallback
   *  when the prebake doesn't carry a biome channel; once Phase A's
   *  multi-channel atlas reaches every caller this becomes dead code. */
  iceLatitudeDeg: number
  /** Mean equilibrium temperature in Kelvin. Same fallback caveat. */
  meanTempK: number
  /** Output image size. The icosahedral net is rendered into a canvas
   *  matching the connected strip's aspect ratio (11 : 3√3 ≈ 2.12).
   *  Width controls the resolution. */
  width: number
  /** Linear-RGB palette base colours — shared with the globe shader so
   *  the two views agree on biome appearance. */
  paletteBase: PaletteBaseColors
}

export function renderSurfaceBackground(prebake: PreBake, opts: RenderOptions): string {
  const width = opts.width
  const height = Math.round((width * NET_HEIGHT) / NET_WIDTH)
  const scaleNetToPx = width / NET_WIDTH

  const heightmap =
    prebake.heightmap instanceof Float32Array
      ? prebake.heightmap
      : Float32Array.from(prebake.heightmap)
  const biome =
    prebake.biome_id instanceof Uint8Array
      ? prebake.biome_id
      : prebake.biome_id
        ? Uint8Array.from(prebake.biome_id)
        : undefined
  const seaLevel =
    typeof prebake.sea_level_threshold === 'number'
      ? prebake.sea_level_threshold
      : quantile(heightmap, clamp(opts.waterFraction, 0, 1))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(width, height)
  const data = img.data

  const sunDir: [number, number, number] = [-0.55, -0.55, 0.62]

  // Pre-bake the palette into a 16-entry sRGB lookup. Avoids running
  // the linear→sRGB encode for every pixel.
  const paletteSrgb: [number, number, number][] = new Array(16)
  for (let i = 0; i < 16; i++) {
    const linear = biomeColorLinear(i, opts.paletteBase)
    paletteSrgb[i] = [
      linearToSrgb8(linear[0]),
      linearToSrgb8(linear[1]),
      linearToSrgb8(linear[2]),
    ]
  }

  // First pass: project every pixel and sample the heightmap + biome.
  // The heightmap is bilinear (smooth coastlines); the biome is nearest-
  // neighbour (categorical).
  const elev = new Float32Array(width * height)
  const biomeBuf = new Uint8Array(width * height)
  const inside = new Uint8Array(width * height)
  const latArr = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const netX = x / scaleNetToPx
      const netY = y / scaleNetToPx
      const proj = netToSphere(netX, netY)
      const idx = y * width + x
      if (!proj) continue
      inside[idx] = 1
      latArr[idx] = proj.lat
      const sample = normalisedSurfaceSample(proj.lat, proj.lon)
      elev[idx] = sampleBilinear(
        heightmap,
        prebake.lon_cells,
        prebake.lat_cells,
        sample.lat,
        sample.lon,
      )
      if (biome) {
        biomeBuf[idx] = sampleNearestByte(
          biome,
          prebake.lon_cells,
          prebake.lat_cells,
          sample.lat,
          sample.lon,
        )
      }
    }
  }

  // Second pass: shade each pixel. Hillshade modulation lifts/darkens
  // the biome colour by local slope so terrain reads as 3D rather than
  // a flat-fill polygon. Biome stays the colour family; hillshade is
  // the texture.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (!inside[idx]) {
        data[idx * 4 + 3] = 0
        continue
      }
      const h = elev[idx]
      const biomeId = biome ? biomeBuf[idx] : classifyFallback(h, seaLevel, latArr[idx], opts)
      const isWater = biomeIsOcean(biomeId)

      // Slope: prefer in-face neighbours; if neighbour is outside the
      // net (zero) reuse our own elevation so the hillshade goes flat
      // at fold edges instead of going crazy.
      const xL = x > 0 && inside[idx - 1] ? idx - 1 : idx
      const xR = x < width - 1 && inside[idx + 1] ? idx + 1 : idx
      const yU = y > 0 && inside[idx - width] ? idx - width : idx
      const yD = y < height - 1 && inside[idx + width] ? idx + width : idx
      const dx = elev[xR] - elev[xL]
      const dy = elev[yD] - elev[yU]
      const nx = -dx * 60
      const ny = -dy * 60
      const nz = 1
      const nl = Math.hypot(nx, ny, nz)
      const lamb = Math.max(0, (nx * sunDir[0] + ny * sunDir[1] + nz * sunDir[2]) / nl)
      // Ocean fragments take a gentler shade so the depth gradient
      // reads correctly; land gets the full hillshade.
      const shade = isWater ? 0.85 + lamb * 0.25 : 0.6 + lamb * 0.55

      let r = paletteSrgb[biomeId][0]
      let g = paletteSrgb[biomeId][1]
      let b = paletteSrgb[biomeId][2]

      if (isWater) {
        // Smooth depth gradient between shallow and deep ocean palette
        // entries — biome atlas only distinguishes deep/shallow at cell
        // granularity, but the per-fragment depth gives a continuous
        // transition that reads better than two flat tones meeting at a
        // texel boundary.
        const depth = clamp(seaLevel - h, 0, 1)
        const t = smoothstep(0.0, 0.5, depth)
        const shallow = paletteSrgb[1]
        const deep = paletteSrgb[0]
        r = shallow[0] + (deep[0] - shallow[0]) * t
        g = shallow[1] + (deep[1] - shallow[1]) * t
        b = shallow[2] + (deep[2] - shallow[2]) * t
      }

      r *= shade
      g *= shade
      b *= shade

      // Ice biomes pick up a slight cool tint over the base palette so
      // pack ice reads distinctly from snow caps on land. Cheap effect,
      // matches the WGSL globe.
      if (biomeIsIce(biomeId)) {
        r = r * 0.95 + 6
        g = g * 0.95 + 10
        b = b * 0.95 + 15
      }

      const di = idx * 4
      data[di] = clamp255(r)
      data[di + 1] = clamp255(g)
      data[di + 2] = clamp255(b)
      data[di + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

// Heightmap-only fallback used when the prebake doesn't carry biome ids
// (e.g. a legacy caller that hasn't migrated). Implements just enough
// of the Rust classifier to pick the right BiomeId from elevation,
// latitude, and the option scalars. Once all callers pass the biome
// channel this can be deleted.
function classifyFallback(
  h: number,
  seaLevel: number,
  latRad: number,
  opts: RenderOptions,
): number {
  const absLatDeg = (Math.abs(latRad) * 180) / Math.PI
  const above = Math.max(0, h - seaLevel)
  if (absLatDeg > opts.iceLatitudeDeg) return h < seaLevel ? 13 : 11
  if (h < seaLevel) return h - seaLevel < -0.08 ? 0 : 1
  if (above < 0.015) return 2
  if (above > 0.55) return 9
  if (above > 0.32) return 8
  if (opts.meanTempK < 278) return 12
  return 3
}

// ---------- helpers ----------

function sampleBilinear(
  heightmap: Float32Array,
  lonCells: number,
  latCells: number,
  latNorm: number,
  lonNorm: number,
): number {
  const lat = clamp(clamp(latNorm, 0, 1) * latCells - 0.5, 0, latCells - 1)
  const lon = (((lonNorm % 1) + 1) % 1) * lonCells - 0.5
  const lonFloor = Math.floor(lon)
  const i0 = Math.floor(lat)
  const i1 = Math.min(i0 + 1, latCells - 1)
  const j0 = mod(lonFloor, lonCells)
  const j1 = (j0 + 1) % lonCells
  const fi = lat - i0
  const fj = lon - lonFloor
  const h00 = heightmap[i0 * lonCells + j0]
  const h01 = heightmap[i0 * lonCells + j1]
  const h10 = heightmap[i1 * lonCells + j0]
  const h11 = heightmap[i1 * lonCells + j1]
  const h0 = h00 * (1 - fj) + h01 * fj
  const h1 = h10 * (1 - fj) + h11 * fj
  return h0 * (1 - fi) + h1 * fi
}

function sampleNearestByte(
  buf: Uint8Array,
  lonCells: number,
  latCells: number,
  latNorm: number,
  lonNorm: number,
): number {
  const i = Math.min(
    Math.floor(clamp(latNorm, 0, 1) * latCells),
    latCells - 1,
  )
  const lon = (((lonNorm % 1) + 1) % 1) * lonCells
  const j = Math.min(Math.floor(lon), lonCells - 1)
  return buf[i * lonCells + j]
}

export function normalisedSurfaceSample(
  latRad: number,
  lonRad: number,
): { lat: number; lon: number } {
  return {
    lat: latRad / Math.PI + 0.5,
    lon: lonRad / (2 * Math.PI) + 0.5,
  }
}

function quantile(arr: Float32Array, q: number): number {
  if (arr.length === 0) return 0
  const sorted = Array.from(arr).sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length))
  return sorted[idx]
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

function mod(x: number, m: number): number {
  return ((x % m) + m) % m
}

function clamp255(x: number): number {
  return Math.max(0, Math.min(255, x | 0))
}
