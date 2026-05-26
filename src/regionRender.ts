// Procedural Canvas2D landscape renderer for the "Region" view.
//
// Given a single surface hex (terrain type + latitude + temperature +
// elevation), draw a painterly topographic scene inside it:
//
//   - FBM noise heightmap, sampled per-pixel into a high-res grid
//   - Terrain colour ramp by elevation + biome (cool/dry/hot palettes)
//   - Hillshade overlay (Lambert dot product against a sun direction)
//     so ridges and valleys read
//   - Rivers traced by gradient descent from local high points, stroked
//     in deep-blue with feathered banks
//   - Forest stipples / tundra dots / dune curves layered for biome flavour
//   - Coastline at the elevation 'sea level' threshold for shoreline hexes
//   - Settlements: small filled circles with halo + name label
//
// All deterministic from (worldSeed, hex.col, hex.row) — same hex always
// paints the same scene.
//
// Output: scenes paint into a CanvasRenderingContext2D in client coords.
// Caller decides the size. We use a 512×448 internal pixel buffer for
// per-pixel work, then upscale via drawImage.

import type { SurfaceHex, Terrain } from './domain/surfaceMap'
import {
  biomeColorLinear,
  linearToSrgb8,
  TERRAIN_TO_BIOME,
  type PaletteBaseColors,
} from './domain/surfaceMap/biomePalette'

export interface RegionRenderInput {
  hex: SurfaceHex
  worldSeed: number
  /** UWP digits or other planet metadata. Currently we only need the
   *  hydrographics digit for sea-level threshold tuning, but the broader
   *  set is here for future per-biome decisions (atm haze, vegetation
   *  richness, etc.). */
  authoredHydroFraction: number
  /** Tier 0..3 city positions inside the hex, in [0..1] x/y coords. */
  settlements?: ReadonlyArray<{ name: string; tier: number; x: number; y: number }>
  starport?: { name: string; x: number; y: number } | null
  /** Pixel size of the output canvas. */
  width: number
  height: number
  /** Shared biome palette base colours. When present, the region paints
   *  with the canonical biome palette so colours match the globe and
   *  surface map. When absent, the legacy temperate / hot / cold
   *  hard-coded ramps are used. */
  paletteBase?: PaletteBaseColors
}

export interface RegionLabel {
  /** Screen-space position (in target canvas coordinates). */
  x: number
  y: number
  text: string
  tier: number
  kind: 'city' | 'starport' | 'feature'
}

export interface RegionRenderResult {
  /** Labels the caller should overlay (HTML / SVG) so they remain crisp. */
  labels: RegionLabel[]
}

// Two quality presets so the caller can paint a fast preview first
// (snappy modal open) and then a crisp pass on the next frame. Each
// preset trades heightmap resolution and noise octaves against render
// cost. The progressive pass disables imageSmoothing so the ridges
// read sharp instead of blurring through the 6x upscale that was
// killing image quality.
export type RegionQuality = 'preview' | 'final'

interface QualityProfile {
  noiseRes: number
  fbmOctaves: number
  ridgeOctaves: number
  /** Add a fine high-frequency tint per output pixel for organic feel.
   *  Cheap to compute - one valueNoise call per pixel. */
  fineDetail: boolean
}

const QUALITY_PROFILES: Record<RegionQuality, QualityProfile> = {
  preview: { noiseRes: 144, fbmOctaves: 5, ridgeOctaves: 3, fineDetail: false },
  final: { noiseRes: 384, fbmOctaves: 6, ridgeOctaves: 4, fineDetail: true },
}

export function renderRegion(
  ctx: CanvasRenderingContext2D,
  input: RegionRenderInput,
  quality: RegionQuality = 'final',
): RegionRenderResult {
  const { hex, worldSeed, width, height } = input
  const profile = QUALITY_PROFILES[quality]

  // Per-pixel internal heightmap. The 'final' pass renders at 384
  // wide, which is about a 2x upscale to the modal frame instead of
  // 6x - that single change is the biggest legibility win.
  const map = buildHeightmap(hex, worldSeed, profile)

  // The terrain-driven sea-level threshold drives both the coastline
  // and the ocean shading. For ocean hexes everything is below water;
  // for ice hexes we use a high threshold so most of the map is "ice
  // plain"; for shoreline ~ half the map is wet.
  const seaLevel = seaLevelForTerrain(hex.terrain, input.authoredHydroFraction)

  // Light direction in screen space - matches the planet shader's
  // convention so the hex landscape feels lit from the same direction
  // as the globe view.
  const sunDir = [-0.55, -0.55, 0.62] as const

  // Paint into an offscreen ImageData at the profile's resolution,
  // then upscale crisply (no smoothing - the 2x scale plus a per-pixel
  // fine-detail jitter keeps ridges sharp).
  const off = document.createElement('canvas')
  off.width = profile.noiseRes
  off.height = Math.round(profile.noiseRes * (height / width))
  const offCtx = off.getContext('2d')!
  const img = offCtx.createImageData(off.width, off.height)
  const data = img.data

  const palette = input.paletteBase
    ? paletteForBiome(hex.terrain, input.paletteBase)
    : paletteForTerrain(hex.terrain, hex.temperature_k)
  // Pre-sample elevation + slope on the offscreen grid so the per-pixel
  // loop is just an array lookup + colour math. Five-fold faster than
  // calling sampleHeight from inside the pixel loop.
  const elev = new Float32Array(off.width * off.height)
  const slopeX = new Float32Array(off.width * off.height)
  const slopeY = new Float32Array(off.width * off.height)
  for (let py = 0; py < off.height; py++) {
    for (let px = 0; px < off.width; px++) {
      const u = px / (off.width - 1)
      const v = py / (off.height - 1)
      elev[py * off.width + px] = sampleHeight(map, u, v)
    }
  }
  for (let py = 0; py < off.height; py++) {
    for (let px = 0; px < off.width; px++) {
      const idx = py * off.width + px
      const xm = px > 0 ? idx - 1 : idx
      const xp = px < off.width - 1 ? idx + 1 : idx
      const ym = py > 0 ? idx - off.width : idx
      const yp = py < off.height - 1 ? idx + off.width : idx
      slopeX[idx] = elev[xp] - elev[xm]
      slopeY[idx] = elev[yp] - elev[ym]
    }
  }
  // Slope amplifier scales with resolution so the hillshade reads at
  // the same visual intensity regardless of the noise grid size.
  const slopeScale = profile.noiseRes / 32
  const detailSeed = mix32(worldSeed, 0xA5A55A5A) >>> 0
  for (let py = 0; py < off.height; py++) {
    for (let px = 0; px < off.width; px++) {
      const idx = py * off.width + px
      const h = elev[idx]
      const isWater = h < seaLevel
      // Hillshade: lambert against a fake surface normal derived from
      // the gradient. Slope vectors get scaled into world units so the
      // relief reads at the resolution we're sampling.
      const nx = -slopeX[idx] * slopeScale
      const ny = -slopeY[idx] * slopeScale
      const nz = 1.0
      const nl = Math.hypot(nx, ny, nz)
      const lamb = Math.max(0, (nx * sunDir[0] + ny * sunDir[1] + nz * sunDir[2]) / nl)
      const shade = 0.55 + lamb * 0.55

      let [r, g, b] = isWater
        ? oceanColor(h / seaLevel)
        : terrainColor(palette, (h - seaLevel) / (1 - seaLevel))

      // Soft shoreline gradient where water meets land.
      const coastBand = Math.abs(h - seaLevel)
      if (coastBand < 0.025) {
        const t = 1 - coastBand / 0.025
        r = r * (1 - t * 0.4) + 220 * t * 0.4
        g = g * (1 - t * 0.4) + 200 * t * 0.4
        b = b * (1 - t * 0.4) + 160 * t * 0.4
      }

      // Apply hillshade only to land - water keeps its own gradient.
      if (!isWater) {
        r *= shade
        g *= shade
        b *= shade
      }

      // High-frequency colour jitter on the final pass: one octave of
      // value noise tints each pixel by +-6%, which breaks up the
      // smooth interpolation that otherwise reads as plastic.
      if (profile.fineDetail && !isWater) {
        const j = valueNoise(px * 0.7, py * 0.7, detailSeed) // [-1, 1]
        const k = 1 + j * 0.06
        r *= k; g *= k; b *= k
      }

      const di = idx * 4
      data[di] = clamp255(r)
      data[di + 1] = clamp255(g)
      data[di + 2] = clamp255(b)
      data[di + 3] = 255
    }
  }
  offCtx.putImageData(img, 0, 0)

  // Crisp upscale. The 'high' smoothing setting was washing the
  // ridges into a soft blur; bilinear (the default) at a 2x ratio
  // gives a much sharper result while still avoiding aliasing.
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = quality === 'final' ? 'medium' : 'low'
  ctx.drawImage(off, 0, 0, width, height)

  // ---- Rivers ----
  drawRivers(ctx, map, seaLevel, width, height, hex.terrain)

  // ---- Biome stipples (forests / dunes / ice cracks) ----
  drawBiomeFlourish(ctx, map, seaLevel, width, height, hex.terrain, worldSeed, hex.coord.col, hex.coord.row)

  // ---- Settlements ----
  const labels: RegionLabel[] = []
  if (input.starport) {
    drawStarport(ctx, input.starport.x * width, input.starport.y * height)
    labels.push({
      x: input.starport.x * width,
      y: input.starport.y * height + 16,
      text: input.starport.name,
      tier: 3,
      kind: 'starport',
    })
  }
  if (input.settlements) {
    for (const s of input.settlements) {
      drawCity(ctx, s.x * width, s.y * height, s.tier)
      labels.push({
        x: s.x * width,
        y: s.y * height - 8,
        text: s.name,
        tier: s.tier,
        kind: 'city',
      })
    }
  }

  return { labels }
}

// ---------- noise ----------

interface Heightmap {
  width: number
  height: number
  /** Row-major elevation in [-1, 1]. */
  data: Float32Array
}

function buildHeightmap(hex: SurfaceHex, worldSeed: number, profile: QualityProfile): Heightmap {
  const w = profile.noiseRes
  const h = profile.noiseRes
  const data = new Float32Array(w * h)
  // Per-hex seed so each hex paints a different terrain.
  const seed = mix32(worldSeed, (hex.coord.col << 16) ^ hex.coord.row)
  // Base elevation bias from the surface hex's elevation field.
  const baseBias = (hex.elevation - 0.5) * 0.6
  // Mountain hexes get tall sharp peaks, plains get gentle rolls, etc.
  const ridge = ridgeMixForTerrain(hex.terrain)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w
      const v = y / h
      const fbm = fbm2(u * 4, v * 4, seed, profile.fbmOctaves)
      const ridged = 1 - Math.abs(fbm2(u * 6, v * 6, seed + 1357, profile.ridgeOctaves))
      const e = baseBias + fbm * 0.55 + ridged * ridge
      data[y * w + x] = clamp(e, -1, 1)
    }
  }
  return { width: w, height: h, data }
}

function sampleHeight(map: Heightmap, u: number, v: number): number {
  const x = clamp(u * (map.width - 1), 0, map.width - 1)
  const y = clamp(v * (map.height - 1), 0, map.height - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(x0 + 1, map.width - 1)
  const y1 = Math.min(y0 + 1, map.height - 1)
  const fx = x - x0
  const fy = y - y0
  const v00 = map.data[y0 * map.width + x0]
  const v10 = map.data[y0 * map.width + x1]
  const v01 = map.data[y1 * map.width + x0]
  const v11 = map.data[y1 * map.width + x1]
  return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy
}

function sampleSlope(map: Heightmap, u: number, v: number): { dx: number; dy: number } {
  const du = 1 / map.width
  const dv = 1 / map.height
  const dx = sampleHeight(map, Math.min(u + du, 1), v) - sampleHeight(map, Math.max(u - du, 0), v)
  const dy = sampleHeight(map, u, Math.min(v + dv, 1)) - sampleHeight(map, u, Math.max(v - dv, 0))
  return { dx, dy }
}

function fbm2(x: number, y: number, seed: number, octaves: number): number {
  let amp = 1
  let freq = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq, seed + i * 311) * amp
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const a = hash2(xi, yi, seed)
  const b = hash2(xi + 1, yi, seed)
  const c = hash2(xi, yi + 1, seed)
  const d = hash2(xi + 1, yi + 1, seed)
  // smoothstep
  const sx = xf * xf * (3 - 2 * xf)
  const sy = yf * yf * (3 - 2 * yf)
  const ab = a + (b - a) * sx
  const cd = c + (d - c) * sx
  return (ab + (cd - ab) * sy) * 2 - 1
}

function hash2(x: number, y: number, seed: number): number {
  let h = ((x | 0) * 374761393) ^ ((y | 0) * 668265263) ^ (seed | 0)
  h = (h ^ (h >>> 13)) * 1274126177
  h = h ^ (h >>> 16)
  return ((h >>> 0) % 65536) / 65536
}

function mix32(a: number, b: number): number {
  let h = ((a >>> 0) * 0x9e3779b9 + (b >>> 0)) >>> 0
  h = ((h ^ (h >>> 16)) * 0x85ebca6b) >>> 0
  h = ((h ^ (h >>> 13)) * 0xc2b2ae35) >>> 0
  return h ^ (h >>> 16)
}

// ---------- terrain styling ----------

interface Palette {
  /** Land elevation 0..1 -> RGB ramp control points. */
  low: [number, number, number]
  mid: [number, number, number]
  high: [number, number, number]
  peak: [number, number, number]
}

function paletteForTerrain(t: Terrain, tempK: number): Palette {
  // Climate biases the ramp toward green / tan / white.
  const cold = tempK < 250
  const hot = tempK > 305
  switch (t) {
    case 'Ocean': return { low: [12, 42, 92], mid: [22, 70, 130], high: [40, 110, 170], peak: [60, 140, 200] }
    case 'Shoreline': return cold
      ? { low: [70, 90, 110], mid: [120, 140, 150], high: [200, 215, 220], peak: [240, 246, 250] }
      : { low: [186, 168, 110], mid: [180, 175, 130], high: [130, 145, 100], peak: [80, 110, 70] }
    case 'Plain': return hot
      ? { low: [200, 175, 110], mid: [188, 170, 100], high: [160, 140, 80], peak: [115, 100, 60] }
      : { low: [150, 165, 105], mid: [130, 155, 90], high: [110, 135, 80], peak: [90, 110, 70] }
    case 'Forest': return cold
      ? { low: [70, 95, 75], mid: [55, 85, 60], high: [70, 95, 70], peak: [180, 200, 200] }
      : { low: [50, 90, 50], mid: [40, 80, 40], high: [70, 100, 55], peak: [120, 140, 90] }
    case 'Hill': return { low: [150, 130, 90], mid: [130, 110, 80], high: [110, 95, 75], peak: [90, 80, 70] }
    case 'Mountain': return { low: [120, 105, 90], mid: [105, 90, 80], high: [130, 125, 130], peak: [240, 244, 250] }
    case 'Desert': return { low: [220, 180, 95], mid: [200, 165, 85], high: [180, 145, 75], peak: [150, 115, 60] }
    case 'Tundra': return { low: [165, 175, 165], mid: [150, 165, 160], high: [170, 180, 175], peak: [220, 230, 230] }
    case 'Ice': return { low: [220, 230, 240], mid: [200, 215, 230], high: [180, 200, 220], peak: [240, 248, 255] }
    case 'Volcanic': return { low: [110, 60, 50], mid: [90, 45, 40], high: [120, 75, 55], peak: [230, 90, 50] }
  }
}

// Build a 4-stop elevation ramp anchored on the shared biome palette:
// low altitude reads as a slightly darker biome colour, mid is the
// biome itself, high blends toward mountain rock, peak picks up snow.
// Used when the caller hands in PaletteBaseColors — keeps the region
// view's elevation richness while making the COLOUR FAMILY identical
// to the globe and surface map.
function paletteForBiome(terrain: Terrain, base: PaletteBaseColors): Palette {
  const biomeId = TERRAIN_TO_BIOME[terrain] ?? 3
  const main = toSrgb(biomeColorLinear(biomeId, base))
  const mountain = toSrgb(biomeColorLinear(9, base))
  const snow = toSrgb(biomeColorLinear(11, base))
  const ocean = toSrgb(biomeColorLinear(0, base))
  if (terrain === 'Ocean') {
    const deep = ocean
    const mid = toSrgb(biomeColorLinear(1, base))
    return { low: deep, mid, high: mid, peak: scaleColor(mid, 1.15) }
  }
  if (terrain === 'Ice' || terrain === 'Tundra') {
    return {
      low: scaleColor(main, 0.85),
      mid: main,
      high: main,
      peak: snow,
    }
  }
  return {
    low: scaleColor(main, 0.82),
    mid: main,
    high: mixColor(main, mountain, 0.55),
    peak: terrain === 'Mountain' ? snow : mixColor(mountain, snow, 0.5),
  }
}

function toSrgb(linear: readonly [number, number, number]): [number, number, number] {
  return [linearToSrgb8(linear[0]), linearToSrgb8(linear[1]), linearToSrgb8(linear[2])]
}

function scaleColor(c: [number, number, number], k: number): [number, number, number] {
  return [
    Math.max(0, Math.min(255, Math.round(c[0] * k))),
    Math.max(0, Math.min(255, Math.round(c[1] * k))),
    Math.max(0, Math.min(255, Math.round(c[2] * k))),
  ]
}

function terrainColor(p: Palette, t01: number): [number, number, number] {
  const t = clamp(t01, 0, 1)
  if (t < 0.35) {
    const k = t / 0.35
    return mixColor(p.low, p.mid, k)
  } else if (t < 0.7) {
    const k = (t - 0.35) / 0.35
    return mixColor(p.mid, p.high, k)
  }
  const k = (t - 0.7) / 0.3
  return mixColor(p.high, p.peak, k)
}

function oceanColor(t01: number): [number, number, number] {
  const t = clamp(t01, 0, 1)
  return mixColor([12, 30, 70], [40, 90, 150], 1 - Math.abs(0.5 - t) * 1.6)
}

function mixColor(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function seaLevelForTerrain(t: Terrain, hydroFraction: number): number {
  switch (t) {
    case 'Ocean': return 1.0  // all water
    case 'Shoreline': return 0.0
    case 'Ice': return -1.0   // no surface water (frozen)
    case 'Mountain': case 'Hill': case 'Desert': case 'Tundra': case 'Volcanic': return -1.0
    case 'Plain': case 'Forest':
      // Slight ponds/lakes biased by world hydrographics.
      return clamp(-0.6 + hydroFraction * 0.4, -1.0, 0.2)
  }
}

function ridgeMixForTerrain(t: Terrain): number {
  switch (t) {
    case 'Mountain': return 0.55
    case 'Hill': return 0.30
    case 'Volcanic': return 0.40
    case 'Forest': return 0.18
    case 'Desert': return 0.20
    case 'Plain': return 0.10
    case 'Shoreline': return 0.12
    case 'Tundra': return 0.18
    case 'Ice': return 0.15
    case 'Ocean': return 0.05
  }
}

// ---------- rivers ----------

function drawRivers(
  ctx: CanvasRenderingContext2D,
  map: Heightmap,
  seaLevel: number,
  width: number,
  height: number,
  terrain: Terrain,
) {
  if (terrain === 'Ocean' || terrain === 'Desert' || terrain === 'Ice') return
  // Pick a handful of high-elevation start points, walk down-gradient.
  const starts: Array<[number, number]> = []
  const cells = 6
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const u = (cx + 0.5) / cells
      const v = (cy + 0.5) / cells
      const h = sampleHeight(map, u, v)
      if (h > Math.max(seaLevel + 0.18, 0.15)) {
        starts.push([u, v])
      }
    }
  }
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const [u0, v0] of starts) {
    let u = u0
    let v = v0
    const path: Array<[number, number]> = [[u, v]]
    for (let step = 0; step < 80; step++) {
      const slope = sampleSlope(map, u, v)
      const len = Math.hypot(slope.dx, slope.dy)
      if (len < 1e-4) break
      // River walk step is in heightmap-fraction units; using the
      // actual map width keeps the same physical stride regardless of
      // which quality preset built the map.
      const step2 = 2 / map.width
      u = clamp(u - (slope.dx / len) * step2, 0, 1)
      v = clamp(v - (slope.dy / len) * step2, 0, 1)
      path.push([u, v])
      if (sampleHeight(map, u, v) < seaLevel) break
    }
    if (path.length < 5) continue
    // Stroke the path widening as it descends.
    for (let i = 1; i < path.length; i++) {
      const [pu1, pv1] = path[i - 1]
      const [pu2, pv2] = path[i]
      const w = 0.6 + i / path.length * 1.6
      ctx.strokeStyle = 'rgba(60, 110, 170, 0.85)'
      ctx.lineWidth = w
      ctx.beginPath()
      ctx.moveTo(pu1 * width, pv1 * height)
      ctx.lineTo(pu2 * width, pv2 * height)
      ctx.stroke()
    }
  }
  ctx.restore()
}

// ---------- biome flourishes ----------

function drawBiomeFlourish(
  ctx: CanvasRenderingContext2D,
  map: Heightmap,
  seaLevel: number,
  width: number,
  height: number,
  terrain: Terrain,
  worldSeed: number,
  col: number,
  row: number,
) {
  ctx.save()
  const seed = mix32(worldSeed + 7919, mix32(col, row))
  const rng = makeRng(seed)
  if (terrain === 'Forest') {
    ctx.fillStyle = 'rgba(20, 50, 25, 0.55)'
    const trees = 240
    for (let i = 0; i < trees; i++) {
      const u = rng()
      const v = rng()
      if (sampleHeight(map, u, v) < seaLevel) continue
      const r = 1.6 + rng() * 1.2
      ctx.beginPath()
      ctx.arc(u * width, v * height, r, 0, Math.PI * 2)
      ctx.fill()
    }
  } else if (terrain === 'Mountain' || terrain === 'Hill') {
    // Contour-like lines at fixed elevations.
    ctx.strokeStyle = 'rgba(40, 35, 30, 0.18)'
    ctx.lineWidth = 0.6
    for (let band = 0; band < 6; band++) {
      const target = -0.5 + band * 0.22
      for (let i = 0; i < 90; i++) {
        const u = rng()
        const v = rng()
        const h = sampleHeight(map, u, v)
        if (Math.abs(h - target) < 0.02) {
          const sx = sampleSlope(map, u, v)
          const len = Math.hypot(sx.dx, sx.dy) + 1e-4
          const tx = -sx.dy / len
          const ty = sx.dx / len
          const x0 = u * width
          const y0 = v * height
          ctx.beginPath()
          ctx.moveTo(x0 - tx * 3, y0 - ty * 3)
          ctx.lineTo(x0 + tx * 3, y0 + ty * 3)
          ctx.stroke()
        }
      }
    }
  } else if (terrain === 'Desert') {
    // Dune curves: shallow arcs aligned to the dominant gradient.
    ctx.strokeStyle = 'rgba(170, 130, 70, 0.35)'
    ctx.lineWidth = 0.7
    const dunes = 60
    for (let i = 0; i < dunes; i++) {
      const u = rng()
      const v = rng()
      const sl = sampleSlope(map, u, v)
      const len = Math.hypot(sl.dx, sl.dy) + 1e-4
      const tx = -sl.dy / len
      const ty = sl.dx / len
      const x0 = u * width
      const y0 = v * height
      ctx.beginPath()
      ctx.moveTo(x0 - tx * 8, y0 - ty * 8)
      ctx.quadraticCurveTo(x0 + sl.dx * 30, y0 + sl.dy * 30, x0 + tx * 8, y0 + ty * 8)
      ctx.stroke()
    }
  } else if (terrain === 'Ice') {
    // Crack fractures
    ctx.strokeStyle = 'rgba(80, 110, 140, 0.32)'
    ctx.lineWidth = 0.6
    const cracks = 20
    for (let i = 0; i < cracks; i++) {
      const x0 = rng() * width
      const y0 = rng() * height
      let x = x0
      let y = y0
      const a = rng() * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(x, y)
      for (let s = 0; s < 12; s++) {
        x += Math.cos(a + (rng() - 0.5) * 0.5) * 6
        y += Math.sin(a + (rng() - 0.5) * 0.5) * 6
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }
  ctx.restore()
}

// ---------- settlements ----------

function drawCity(ctx: CanvasRenderingContext2D, x: number, y: number, tier: number) {
  ctx.save()
  // Halo for legibility on any terrain.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.beginPath()
  ctx.arc(x, y, 6 + tier, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = tier >= 2 ? '#ffe680' : '#ffffff'
  ctx.beginPath()
  ctx.arc(x, y, 3 + tier * 0.7, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawStarport(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save()
  // Five-pointed star.
  ctx.translate(x, y)
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 9 : 4
    const a = (Math.PI / 2) + i * (Math.PI / 5)
    const px = Math.cos(a) * r
    const py = Math.sin(a) * r
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fillStyle = '#ffe680'
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)'
  ctx.lineWidth = 1.4
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

// ---------- helpers ----------

function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x9e3779b9) >>> 0
    let z = s
    z = ((z ^ (z >>> 16)) * 0x85ebca6b) >>> 0
    z = ((z ^ (z >>> 13)) * 0xc2b2ae35) >>> 0
    return ((z ^ (z >>> 16)) >>> 0) / 4294967296
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

function clamp255(x: number): number {
  return Math.max(0, Math.min(255, x | 0))
}
