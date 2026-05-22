import { signal } from '@preact/signals'

export const errorMessage = signal<string | null>(null)
export const panelOpen = signal(false)
export const uwpInput = signal('A867974-D')

export interface Params {
  seed: number
  sea_level: number
  mountain_height: number
  noise_frequency: number
  noise_octaves: number
  atmosphere_density: number
  atmosphere_color: [number, number, number]
  ocean_color: [number, number, number]
  land_color: [number, number, number]
  mountain_color: [number, number, number]
  sand_color: [number, number, number]
  snow_color: [number, number, number]
  ice_latitude: number
  sun_angle: number
  auto_rotate: number
  cloud_coverage: number
  crater_density: number
  population_intensity: number
  vegetation_richness: number
  surface_age: number
}

export const defaultParams: Params = {
  seed: 1337,
  sea_level: 0.52,
  mountain_height: 0.05,
  noise_frequency: 1.5,
  noise_octaves: 7,
  atmosphere_density: 0.45,
  atmosphere_color: [0.46, 0.68, 1.0],
  ocean_color: [0.03, 0.15, 0.42],
  land_color: [0.18, 0.55, 0.20],
  mountain_color: [0.40, 0.32, 0.24],
  sand_color: [0.86, 0.76, 0.52],
  snow_color: [0.97, 0.98, 1.0],
  ice_latitude: 0.82,
  sun_angle: 0.55,
  auto_rotate: 0.05,
  cloud_coverage: 0.22,
  crater_density: 0.0,
  population_intensity: 0.0,
  vegetation_richness: 0.65,
  surface_age: 0.5,
}

export const params = signal<Params>({ ...defaultParams })

export function updateParams(patch: Partial<Params>) {
  params.value = { ...params.value, ...patch }
}

export function reset() {
  params.value = { ...defaultParams }
}

// ---------- Cepheus / legacy 2d6 UWP integration ----------
// A UWP code like "A867974-D" describes a world. Visually we care about three
// digits after the (optional) starport letter: Size, Atmosphere, Hydrographics.
// See memory/reference_cepheus_uwp.md for the full tables.

export interface UwpVisual {
  size: number       // 0..15 (cap A)
  atm: number        // 0..15
  hydro: number      // 0..10 (cap A)
}

function hex(c: string): number {
  const n = parseInt(c, 16)
  return Number.isFinite(n) ? n : -1
}

export interface UwpVisualExt {
  size: number
  atm: number
  hydro: number
  pop: number     // 0..15 (cap A in Cepheus, but allow higher)
}

export function parseUwp(code: string): UwpVisualExt | null {
  const cleaned = code.toUpperCase().replace(/\s+/g, '')
  const main = cleaned.split('-')[0]
  // Accept either "A867974" (with starport) or "867974" (without)
  let body = main
  if (main.length >= 7) body = main.slice(1)
  if (body.length < 3) return null
  const size = hex(body[0])
  const atm = hex(body[1])
  const hydro = hex(body[2])
  // Population is position 4 (0-indexed: 3). May not be present in short codes.
  const pop = body.length > 3 ? hex(body[3]) : 0
  if (size < 0 || atm < 0 || hydro < 0) return null
  return {
    size,
    atm,
    hydro: Math.min(hydro, 10),
    pop: Math.max(0, pop),
  }
}

interface AtmoConfig {
  density: number
  color: [number, number, number]
  cloud_coverage: number
}

interface SurfacePalette {
  land_color: [number, number, number]
  mountain_color: [number, number, number]
  sand_color: [number, number, number]
  snow_color: [number, number, number]
  ocean_color: [number, number, number]
}

// Pick a surface palette that suits an atm+hydro combo. Visual variety here is
// what makes "this is a Mars" vs "this is Earth" vs "this is a Venusian rock"
// land instantly even before you read the UWP. The user can still override any
// colour afterwards in the palette section.
function paletteForUwp(atm: number, hydro: number): SurfacePalette {
  // True vacuum — lunar gray (Moon, Mercury, asteroid)
  if (atm === 0) {
    return {
      land_color: [0.46, 0.43, 0.39],
      mountain_color: [0.30, 0.28, 0.25],
      sand_color: [0.58, 0.54, 0.48],
      snow_color: [0.86, 0.84, 0.80],
      ocean_color: [0.10, 0.10, 0.10],
    }
  }
  // Trace / very-thin / thin + dry — Mars-like rust (Mars has trace atmosphere
  // but iconic rust-coloured surface, so trace+dry maps here rather than airless)
  if (atm <= 5 && hydro <= 2) {
    return {
      land_color: [0.56, 0.28, 0.16],
      mountain_color: [0.32, 0.20, 0.14],
      sand_color: [0.78, 0.46, 0.22],
      snow_color: [0.92, 0.88, 0.82],
      ocean_color: [0.20, 0.12, 0.08],
    }
  }
  // Tainted / dense tainted — sulfur-yellow rocks
  if (atm === 7 || atm === 9) {
    return {
      land_color: [0.50, 0.42, 0.18],
      mountain_color: [0.38, 0.28, 0.15],
      sand_color: [0.78, 0.62, 0.30],
      snow_color: [0.84, 0.78, 0.60],
      ocean_color: [0.18, 0.16, 0.08],
    }
  }
  // Corrosive / Insidious — surface mostly hidden by acid clouds, palette
  // matches the muted oxidised rock you'd see through the gaps.
  if (atm === 11 || atm === 12) {
    return {
      land_color: [0.48, 0.32, 0.18],
      mountain_color: [0.30, 0.22, 0.14],
      sand_color: [0.72, 0.55, 0.28],
      snow_color: [0.78, 0.66, 0.40],
      ocean_color: [0.30, 0.22, 0.10],
    }
  }
  // Exotic — non-toxic but alien; lean teal/violet
  if (atm === 10) {
    return {
      land_color: [0.28, 0.42, 0.54],
      mountain_color: [0.22, 0.25, 0.36],
      sand_color: [0.58, 0.48, 0.68],
      snow_color: [0.86, 0.88, 0.96],
      ocean_color: [0.10, 0.18, 0.30],
    }
  }
  // Unusual (F) — leans warm/stormy
  if (atm === 15) {
    return {
      land_color: [0.58, 0.40, 0.22],
      mountain_color: [0.34, 0.26, 0.16],
      sand_color: [0.82, 0.60, 0.32],
      snow_color: [0.92, 0.84, 0.66],
      ocean_color: [0.20, 0.14, 0.08],
    }
  }
  // Default Earth-like
  return {
    land_color: [0.18, 0.55, 0.20],
    mountain_color: [0.40, 0.32, 0.24],
    sand_color: [0.86, 0.76, 0.52],
    snow_color: [0.97, 0.98, 1.00],
    ocean_color: [0.03, 0.15, 0.42],
  }
}

// Map Cepheus atmosphere digit (0-F) to renderer dials. The colors are chosen to
// echo the SRD descriptions: tainted (2/4/7/9) reads as a sandy yellow haze,
// exotic (A) is unusual (here pinkish-violet), corrosive (B) is sulfur yellow,
// insidious (C) is opaque tobacco orange, dense high (D) is thick blue, thin
// low (E) is thin blue, unusual (F) leans warm/stormy.
function atmoConfig(atm: number): AtmoConfig {
  switch (atm) {
    case 0:  return { density: 0.00, color: [0.30, 0.30, 0.30], cloud_coverage: 0.00 }
    case 1:  return { density: 0.06, color: [0.40, 0.50, 0.70], cloud_coverage: 0.02 }
    case 2:  return { density: 0.18, color: [0.75, 0.58, 0.32], cloud_coverage: 0.08 }
    case 3:  return { density: 0.18, color: [0.42, 0.62, 0.95], cloud_coverage: 0.10 }
    case 4:  return { density: 0.32, color: [0.72, 0.55, 0.30], cloud_coverage: 0.15 }
    case 5:  return { density: 0.32, color: [0.42, 0.65, 1.00], cloud_coverage: 0.18 }
    case 6:  return { density: 0.45, color: [0.46, 0.68, 1.00], cloud_coverage: 0.22 }
    case 7:  return { density: 0.45, color: [0.74, 0.60, 0.32], cloud_coverage: 0.30 }
    case 8:  return { density: 0.78, color: [0.40, 0.62, 0.95], cloud_coverage: 0.45 }
    case 9:  return { density: 0.78, color: [0.78, 0.60, 0.30], cloud_coverage: 0.55 }
    case 10: return { density: 0.65, color: [0.62, 0.45, 0.85], cloud_coverage: 0.35 } // exotic
    case 11: return { density: 1.00, color: [0.88, 0.78, 0.34], cloud_coverage: 0.85 } // corrosive
    case 12: return { density: 1.20, color: [0.78, 0.52, 0.22], cloud_coverage: 0.92 } // insidious
    case 13: return { density: 1.15, color: [0.40, 0.60, 0.92], cloud_coverage: 0.55 } // dense high
    case 14: return { density: 0.20, color: [0.42, 0.65, 1.00], cloud_coverage: 0.10 } // thin low
    case 15: return { density: 0.70, color: [0.82, 0.55, 0.32], cloud_coverage: 0.75 } // unusual
    default: return { density: 0.45, color: [0.46, 0.68, 1.00], cloud_coverage: 0.22 }
  }
}

// Apply a UWP code to the renderer params. Returns true if the code parsed.
// Drives sea_level (hydro), atmosphere density/colour + cloud cover (atm), a
// sensible surface palette (atm+hydro), and the "world features" knobs
// (cratering, vegetation, city lights). User can still override any slider or
// colour afterwards.
export function applyUwp(code: string): boolean {
  const parsed = parseUwp(code)
  if (!parsed) return false
  const { atm, hydro, pop } = parsed
  const atmo = atmoConfig(atm)
  const palette = paletteForUwp(atm, hydro)
  // Hydrographics digit (0-A) -> sea_level. 0=desert, A=almost all water.
  const sea_level = 0.05 + (Math.min(hydro, 10) / 10) * 0.90

  // Cratering: heavy on airless/trace bodies (no weather to erode), tapers off
  // as atmospheres get thicker. Wet worlds also wash away craters.
  const atmCrater = atm <= 1 ? 1.0 : atm <= 3 ? 0.6 : atm <= 5 ? 0.25 : 0.0
  const hydroCrater = hydro <= 1 ? 1.0 : hydro <= 3 ? 0.6 : 0.2
  const crater_density = Math.min(1, atmCrater * hydroCrater)

  // Vegetation: needs breathable atm + water. Tainted atmospheres support life
  // but with reduced biomass; corrosive/exotic kill it.
  const atmVeg = atm >= 4 && atm <= 9 ? 1.0 : atm === 3 || atm === 13 ? 0.4 : 0
  const hydroVeg = hydro >= 3 && hydro <= 8 ? 1.0 : hydro >= 2 ? 0.6 : 0.0
  const vegetation_richness = atmVeg * hydroVeg

  // Population intensity (city lights). Pop digit 0=none through C=billions.
  // Need a vaguely habitable atmosphere — corrosive/insidious worlds don't get
  // bright surface lights even if technically populated.
  const popDigit = pop
  const habitableAtm = atm >= 2 && atm <= 9 && atm !== 11 && atm !== 12
  const population_intensity = habitableAtm ? Math.max(0, popDigit - 5) / 7 : 0

  // Older surfaces (long since cooled) have more craters and more weathering.
  // We approximate with the atm/water inputs we already have.
  const surface_age = (1 - atmVeg) * 0.5 + (atm <= 1 ? 0.5 : 0)

  params.value = {
    ...params.value,
    sea_level,
    atmosphere_density: atmo.density,
    atmosphere_color: atmo.color,
    cloud_coverage: atmo.cloud_coverage,
    crater_density,
    vegetation_richness,
    population_intensity,
    surface_age,
    ...palette,
  }
  return true
}

// Picks a new seed and randomizes the climate-y dials so each press feels different.
// Palette colors are left alone — the user usually wants those stable.
// Sun angle is kept in a range that mostly faces the default camera so randomize
// shows a lit hemisphere; drag the camera to explore the dark side intentionally.
export function randomize() {
  const rand = (a: number, b: number) => a + Math.random() * (b - a)
  params.value = {
    ...params.value,
    seed: Math.floor(Math.random() * 0xFFFFFFFF),
    sea_level: rand(0.35, 0.7),
    mountain_height: rand(0.03, 0.12),
    noise_frequency: rand(1.2, 2.6),
    noise_octaves: Math.floor(rand(5, 9)),
    cloud_coverage: rand(0.15, 0.7),
    ice_latitude: rand(0.65, 0.92),
    atmosphere_density: rand(0.35, 0.85),
    sun_angle: rand(0.42, 0.68),
  }
}
