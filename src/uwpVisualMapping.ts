import type { Params, RGB } from './params'
import { parseUwpDigits, type UwpDigits } from './uwp'

interface AtmoConfig {
  density: number
  color: RGB
  cloud_coverage: number
}

interface SurfacePalette {
  land_color: RGB
  mountain_color: RGB
  sand_color: RGB
  snow_color: RGB
  ocean_color: RGB
}

// Pick a surface palette that suits an atm+hydro combo. Visual variety here is
// what makes "this is a Mars" vs "this is Earth" vs "this is a Venusian rock"
// land instantly even before you read the UWP.
function paletteForUwp(atm: number, hydro: number): SurfacePalette {
  if (atm === 0) {
    return {
      land_color: [0.46, 0.43, 0.39],
      mountain_color: [0.30, 0.28, 0.25],
      sand_color: [0.58, 0.54, 0.48],
      snow_color: [0.86, 0.84, 0.80],
      ocean_color: [0.10, 0.10, 0.10],
    }
  }
  if (atm <= 5 && hydro <= 2) {
    return {
      land_color: [0.56, 0.28, 0.16],
      mountain_color: [0.32, 0.20, 0.14],
      sand_color: [0.78, 0.46, 0.22],
      snow_color: [0.92, 0.88, 0.82],
      ocean_color: [0.20, 0.12, 0.08],
    }
  }
  if (atm === 7 || atm === 9) {
    return {
      land_color: [0.50, 0.42, 0.18],
      mountain_color: [0.38, 0.28, 0.15],
      sand_color: [0.78, 0.62, 0.30],
      snow_color: [0.84, 0.78, 0.60],
      ocean_color: [0.18, 0.16, 0.08],
    }
  }
  if (atm === 11 || atm === 12) {
    return {
      land_color: [0.48, 0.32, 0.18],
      mountain_color: [0.30, 0.22, 0.14],
      sand_color: [0.72, 0.55, 0.28],
      snow_color: [0.78, 0.66, 0.40],
      ocean_color: [0.30, 0.22, 0.10],
    }
  }
  if (atm === 10) {
    return {
      land_color: [0.28, 0.42, 0.54],
      mountain_color: [0.22, 0.25, 0.36],
      sand_color: [0.58, 0.48, 0.68],
      snow_color: [0.86, 0.88, 0.96],
      ocean_color: [0.10, 0.18, 0.30],
    }
  }
  if (atm === 15) {
    return {
      land_color: [0.58, 0.40, 0.22],
      mountain_color: [0.34, 0.26, 0.16],
      sand_color: [0.82, 0.60, 0.32],
      snow_color: [0.92, 0.84, 0.66],
      ocean_color: [0.20, 0.14, 0.08],
    }
  }
  return {
    land_color: [0.18, 0.55, 0.20],
    mountain_color: [0.40, 0.32, 0.24],
    sand_color: [0.86, 0.76, 0.52],
    snow_color: [0.97, 0.98, 1.00],
    ocean_color: [0.03, 0.15, 0.42],
  }
}

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
    case 10: return { density: 0.65, color: [0.62, 0.45, 0.85], cloud_coverage: 0.35 }
    case 11: return { density: 1.00, color: [0.88, 0.78, 0.34], cloud_coverage: 0.85 }
    case 12: return { density: 1.20, color: [0.78, 0.52, 0.22], cloud_coverage: 0.92 }
    case 13: return { density: 1.15, color: [0.40, 0.60, 0.92], cloud_coverage: 0.55 }
    case 14: return { density: 0.20, color: [0.42, 0.65, 1.00], cloud_coverage: 0.10 }
    case 15: return { density: 0.70, color: [0.82, 0.55, 0.32], cloud_coverage: 0.75 }
    default: return { density: 0.45, color: [0.46, 0.68, 1.00], cloud_coverage: 0.22 }
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function roundedCode(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max))
}

export function paramsPatchFromUwp(code: string): Partial<Params> | null {
  const parsed = parseUwpDigits(code)
  if (!parsed) return null
  return paramsPatchFromUwpDigits(parsed)
}

export function paramsPatchFromUwpDigits(uwp: UwpDigits): Partial<Params> {
  const { size, atm, hydro, pop, tech } = uwp
  const sizeCode = roundedCode(size, 0, 10)
  const atmCode = sizeCode === 0 ? 0 : roundedCode(atm, 0, 15)
  const hydroCode = sizeCode <= 1 ? 0 : roundedCode(hydro, 0, 10)
  const atmo = atmoConfig(atmCode)
  const palette = paletteForUwp(atmCode, hydroCode)

  // Treat the continuous hydrographics slider as the authored target water
  // fraction. The renderer converts this to a terrain quantile, so 25% really
  // reads as roughly one quarter ocean instead of waiting for a hidden height
  // threshold to cross the generated terrain distribution.
  const sea_level = clamp(sizeCode <= 1 ? 0 : hydro, 0, 10) / 10
  const atmCrater = atmCode <= 1 ? 1.0 : atmCode <= 3 ? 0.6 : atmCode <= 5 ? 0.25 : 0.0
  const hydroCrater = hydroCode <= 1 ? 1.0 : hydroCode <= 3 ? 0.6 : 0.2
  const crater_density = Math.min(1, atmCrater * hydroCrater)
  const atmVeg = atmCode >= 4 && atmCode <= 9 ? 1.0 : atmCode === 3 || atmCode === 13 ? 0.4 : 0
  const hydroVeg = hydroCode >= 3 && hydroCode <= 8 ? 1.0 : hydroCode >= 2 ? 0.6 : 0.0
  const vegetation_richness = atmVeg * hydroVeg
  const ice_latitude =
    hydroCode <= 1 && atmCode <= 3 ? 0.94 :
    hydroCode <= 2 ? 0.90 :
    hydroCode >= 9 ? 0.78 :
    0.82
  const habitableAtm = atmCode >= 2 && atmCode <= 9 && atmCode !== 11 && atmCode !== 12
  const tech_factor = clamp((tech - 2) / 5, 0, 1)
  const population_intensity = habitableAtm
    ? clamp((pop - 5) / 7, 0, 1) * tech_factor
    : 0
  const planet_radius = Math.max(0.18, clamp(size, 0, 10) / 8)
  const atm_banding =
    atmCode === 15 ? 1.0 :
    atmCode === 11 || atmCode === 12 ? 0.75 :
    atmCode >= 8 ? 0.55 :
    atmCode >= 4 ? 0.50 :
    atmCode >= 2 ? 0.30 :
    0.0

  return {
    sea_level,
    atmosphere_density: atmo.density,
    atmosphere_color: atmo.color,
    cloud_coverage: atmo.cloud_coverage,
    ice_latitude,
    crater_density,
    vegetation_richness,
    population_intensity,
    atm_banding,
    body_visual_mode: 0,
    surface_temp_k: 0,
    planet_radius,
    ...palette,
  }
}
