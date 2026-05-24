// Rendered-map background for the Surface view.
//
// The Rust side already produces a 192x96 plate-tectonics + value-noise
// heightmap (`generateSurfacePrebake`); this function turns that heightmap
// into an equirectangular RGBA image - ocean depth shaded by elevation,
// land coloured by elevation + latitude, polar caps near the poles, and a
// cheap hillshade so continents read with relief. Returned as a data URL
// so it can sit in an SVG `<image>` element and ride the SVG's pan / zoom
// gestures without separate transform plumbing.

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
  /** Output image size. The heightmap is bilinearly sampled. */
  width: number
  height: number
}

export function renderSurfaceBackground(prebake: PreBake, opts: RenderOptions): string {
  const { width, height } = opts
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

  // Hillshade direction matches the planet shader convention so the
  // map looks lit from the same side as the globe.
  const sunDir: [number, number, number] = [-0.55, -0.55, 0.62]

  const lonCells = prebake.lon_cells
  const latCells = prebake.lat_cells

  // Cache sampling - we sample at the output resolution but read from
  // the 192x96 source via bilinear. Precompute lat/lon for each row /
  // column to avoid repeating the trig.
  const lonAt = new Float32Array(width)
  for (let x = 0; x < width; x++) lonAt[x] = x / width
  const latAt = new Float32Array(height)
  for (let y = 0; y < height; y++) latAt[y] = y / Math.max(1, height - 1)

  // Pre-sample the heightmap onto the output grid in one pass so the
  // shading loop can read neighbours cheaply for hillshade.
  const elev = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    const v = latAt[y]
    for (let x = 0; x < width; x++) {
      elev[y * width + x] = sampleBilinear(heightmap, lonCells, latCells, latAt[y], lonAt[x])
      void v
    }
  }

  const hot = opts.meanTempK > 305
  const cold = opts.meanTempK < 255

  for (let y = 0; y < height; y++) {
    const latNorm = latAt[y]
    // latNorm runs 0 at north pole → 1 at south pole. Absolute
    // latitude in degrees:
    const latDeg = (1 - 2 * latNorm) * 90
    const absLat = Math.abs(latDeg)
    const iceWeight = smoothstep(opts.iceLatitudeDeg - 8, opts.iceLatitudeDeg + 2, absLat)

    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const h = elev[idx]
      const isWater = h <= seaLevel

      // Slope for hillshade. Wrap in longitude (sphere), clamp in
      // latitude (poles).
      const xL = (x - 1 + width) % width
      const xR = (x + 1) % width
      const yU = Math.max(0, y - 1)
      const yD = Math.min(height - 1, y + 1)
      const dx = elev[y * width + xR] - elev[y * width + xL]
      const dy = elev[yD * width + x] - elev[yU * width + x]
      // Slope amp scales with grid resolution; tuned empirically so the
      // continents have ~20% intensity variation across mid-elevation.
      const nx = -dx * 60
      const ny = -dy * 60
      const nz = 1
      const nl = Math.hypot(nx, ny, nz)
      const lamb = Math.max(0, (nx * sunDir[0] + ny * sunDir[1] + nz * sunDir[2]) / nl)
      const shade = 0.6 + lamb * 0.55

      let r: number, g: number, b: number
      if (isWater) {
        // Depth: 0 = at sea level, 1 = deepest point in this bake.
        const depthMin = -1
        const depth = clamp((seaLevel - h) / Math.max(0.0001, seaLevel - depthMin), 0, 1)
        ;[r, g, b] = oceanColor(depth, cold)
      } else {
        // Land: relative elevation above sea level, mapped through a
        // latitude-aware palette.
        const elevMax = 1
        const land = clamp((h - seaLevel) / Math.max(0.0001, elevMax - seaLevel), 0, 1)
        ;[r, g, b] = landColor(land, absLat, hot, cold)
        // Hillshade only on land - oceans keep their depth gradient.
        r *= shade
        g *= shade
        b *= shade
      }

      // Polar ice caps: gradually replace whatever we'd draw with a
      // bright tundra / ice tone above the ice latitude.
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
  const lat = clamp(latNorm, 0, 1) * (latCells - 1)
  const lon = ((lonNorm % 1) + 1) % 1 * lonCells
  const i0 = Math.floor(lat)
  const i1 = Math.min(i0 + 1, latCells - 1)
  const j0 = Math.floor(lon) % lonCells
  const j1 = (j0 + 1) % lonCells
  const fi = lat - i0
  const fj = lon - Math.floor(lon)
  const h00 = heightmap[i0 * lonCells + j0]
  const h01 = heightmap[i0 * lonCells + j1]
  const h10 = heightmap[i1 * lonCells + j0]
  const h11 = heightmap[i1 * lonCells + j1]
  const h0 = h00 * (1 - fj) + h01 * fj
  const h1 = h10 * (1 - fj) + h11 * fj
  return h0 * (1 - fi) + h1 * fi
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

function clamp255(x: number): number {
  return Math.max(0, Math.min(255, x | 0))
}
