// Rendered-map background for the Surface view, projected through
// the same 20-face icosahedral net the hex grid sits on.
//
// For each pixel in the output canvas we map (x, y) → barycentric in
// the containing triangle → 3D point on the unit sphere → (lat, lon)
// → sample the Rust pre-bake. Pixels outside the net stay transparent
// so the canvas itself reads as an "unfolded icosahedron." Because
// every adjacent pair of flat triangles shares its edge on the
// icosahedron, continents flow continuously across fold lines.

import { netToSphere, NET_WIDTH, NET_HEIGHT } from '../domain/icosahedron'

export interface PreBake {
  lon_cells: number
  lat_cells: number
  heightmap: number[] | Float32Array
}

interface RenderOptions {
  /** Fraction of cells classed as ocean. The bake's sea level is the
   *  elevation at this quantile of the heightmap. */
  waterFraction: number
  /** Latitude-derived ice cap onset, in degrees. Lower = caps reach
   *  closer to the equator. */
  iceLatitudeDeg: number
  /** Mean equilibrium temperature in Kelvin; shifts the land palette
   *  toward hot / temperate / cold biomes. */
  meanTempK: number
  /** Output image size. The icosahedral net is rendered into a canvas
   *  matching the connected strip's aspect ratio (11 : 3√3 ≈ 2.12).
   *  Width controls the resolution. */
  width: number
}

export function renderSurfaceBackground(prebake: PreBake, opts: RenderOptions): string {
  // Map the icosahedral net's intrinsic dimensions (NET_WIDTH ×
  // NET_HEIGHT in pixels) to the caller's canvas resolution.
  const width = opts.width
  const height = Math.round(width * NET_HEIGHT / NET_WIDTH)
  const scaleNetToPx = width / NET_WIDTH

  const heightmap = prebake.heightmap instanceof Float32Array
    ? prebake.heightmap
    : Float32Array.from(prebake.heightmap)
  const seaLevel = quantile(heightmap, clamp(opts.waterFraction, 0, 1))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(width, height)
  const data = img.data

  const sunDir: [number, number, number] = [-0.55, -0.55, 0.62]

  // First pass: project every pixel and sample the heightmap. We
  // capture the sphere coords so the hillshade pass can read
  // neighbours along the spherical surface instead of the flat
  // canvas grid (where adjacent pixels can belong to different
  // icosahedral faces).
  const elev = new Float32Array(width * height)
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
    }
  }

  const hot = opts.meanTempK > 305
  const cold = opts.meanTempK < 255

  // Second pass: shade. Hillshade uses local flat-canvas gradients
  // (cheap, slightly wrong across fold lines but visually fine since
  // both sides of a fold are still elevation samples from the same
  // sphere).
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (!inside[idx]) {
        data[idx * 4 + 3] = 0
        continue
      }
      const h = elev[idx]
      const isWater = h <= seaLevel
      const latRad = latArr[idx]
      const absLat = Math.abs(latRad) * 180 / Math.PI
      const iceWeight = smoothstep(opts.iceLatitudeDeg - 8, opts.iceLatitudeDeg + 2, absLat)

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
      const shade = 0.6 + lamb * 0.55

      let r: number, g: number, b: number
      if (isWater) {
        const depth = clamp((seaLevel - h) / Math.max(0.0001, seaLevel + 1), 0, 1)
        ;[r, g, b] = oceanColor(depth, cold)
      } else {
        const land = clamp((h - seaLevel) / Math.max(0.0001, 1 - seaLevel), 0, 1)
        ;[r, g, b] = landColor(land, absLat, hot, cold)
        r *= shade; g *= shade; b *= shade
      }
      if (iceWeight > 0) {
        const [ir, ig, ib] = isWater ? [200, 220, 235] : [220, 230, 240]
        r = r * (1 - iceWeight) + ir * iceWeight
        g = g * (1 - iceWeight) + ig * iceWeight
        b = b * (1 - iceWeight) + ib * iceWeight
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

// ---------- palette ----------

function oceanColor(depth01: number, cold: boolean): [number, number, number] {
  // Lerp from a shallow shore tint to deep abyssal blue.
  const shallow: [number, number, number] = cold ? [80, 120, 150] : [70, 130, 180]
  const deep: [number, number, number] = cold ? [10, 30, 60] : [10, 40, 95]
  return mix(shallow, deep, depth01)
}

function landColor(elev01: number, absLat: number, hot: boolean, cold: boolean): [number, number, number] {
  // Base ramp: shore → plain → forest → hill → mountain → snow cap.
  // Latitude tugs the ramp warmer (desert beige) near hot/arid bands or
  // cooler (tundra) toward the poles.
  const tropic = absLat < 30
  const temperate = absLat >= 30 && absLat < 55
  const subarctic = absLat >= 55

  let palette: [number, number, number][]
  if (cold || subarctic) {
    palette = [
      [180, 180, 165],
      [150, 160, 145],
      [130, 140, 130],
      [115, 110, 100],
      [140, 135, 130],
      [240, 245, 250],
    ]
  } else if (hot || tropic) {
    palette = [
      [200, 180, 130],
      [180, 165, 105],
      [140, 150, 85],
      [150, 125, 80],
      [125, 100, 70],
      [240, 235, 220],
    ]
  } else {
    // Temperate default
    palette = [
      [165, 175, 130],
      [120, 150, 95],
      [80, 130, 80],
      [115, 100, 80],
      [110, 95, 80],
      [235, 240, 245],
    ]
    void temperate
  }
  return ramp(palette, elev01)
}

function ramp(stops: [number, number, number][], t: number): [number, number, number] {
  const n = stops.length - 1
  const i = Math.min(n - 1, Math.floor(t * n))
  const f = t * n - i
  return mix(stops[i], stops[i + 1], f)
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
  const lon = ((lonNorm % 1) + 1) % 1 * lonCells - 0.5
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

export function normalisedSurfaceSample(latRad: number, lonRad: number): { lat: number; lon: number } {
  return {
    lat: latRad / Math.PI + 0.5,
    lon: lonRad / (2 * Math.PI) + 0.5,
  }
}

function quantile(arr: Float32Array, q: number): number {
  if (arr.length === 0) return 0
  // Copy then sort for the quantile; O(n log n) is fine for 18k cells.
  const sorted = Array.from(arr).sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length))
  return sorted[idx]
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
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
