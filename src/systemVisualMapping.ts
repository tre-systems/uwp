import type { Params, RGB } from './params'
import type { AsteroidBelt, BodyType, Planet, SolarSystem, Star, SystemBodyTarget } from './domain/system'

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function scaleColor(color: RGB, factor: number): RGB {
  return color.map((c) => clamp(c * factor, 0, 1.4)) as RGB
}

function mixColor(a: RGB, b: RGB, t: number): RGB {
  const k = clamp(t, 0, 1)
  return [
    a[0] * (1 - k) + b[0] * k,
    a[1] * (1 - k) + b[1] * k,
    a[2] * (1 - k) + b[2] * k,
  ]
}

function radiusForPlanet(planet: Planet): number {
  return clamp(planet.radius_earth, 0.18, 1.65)
}

function waterFractionFor(planet: Planet): number {
  if (planet.body_type === 'Rocky' || planet.body_type === 'Inferno') return 0
  if (planet.body_type === 'Frozen') return clamp(planet.climate.liquid_water_fraction * 0.35, 0, 0.25)
  return clamp(planet.climate.liquid_water_fraction, 0, 1)
}

function atmosphereFor(planet: Planet): { density: number; color: RGB; cloud: number; banding: number } {
  const temp = planet.climate.mean_surface_temp_k || planet.temperature_k
  switch (planet.body_type) {
    case 'GasGiant':
      return { density: 1.45, color: [0.95, 0.78, 0.48], cloud: 0.98, banding: 1.0 }
    case 'IceGiant':
      return { density: 1.15, color: [0.52, 0.80, 1.0], cloud: 0.92, banding: 0.92 }
    case 'MiniNeptune':
      return { density: 1.05, color: [0.48, 0.72, 0.95], cloud: 0.86, banding: 0.82 }
    case 'Inferno':
      return { density: 0.95, color: [1.0, 0.58, 0.26], cloud: 0.34, banding: 0.55 }
    case 'Frozen':
      return { density: 0.12, color: [0.62, 0.78, 1.0], cloud: 0.12, banding: 0.12 }
    case 'Rocky':
      return { density: 0.02, color: [0.54, 0.55, 0.58], cloud: 0.01, banding: 0.0 }
    case 'SuperEarth':
      if (temp < 180) {
        return { density: 0.08, color: [0.60, 0.70, 0.82], cloud: 0.04, banding: 0.08 }
      }
      return {
        density: temp > 330 ? 0.75 : 0.55,
        color: temp > 330 ? [0.92, 0.62, 0.34] : [0.48, 0.68, 0.98],
        cloud: clamp(planet.climate.liquid_water_fraction * 0.45 + 0.12, 0.08, 0.65),
        banding: 0.35,
      }
    case 'Terrestrial':
    default:
      if (temp < 180) {
        return { density: 0.06, color: [0.58, 0.68, 0.82], cloud: 0.03, banding: 0.04 }
      }
      return {
        density: temp > 320 ? 0.58 : 0.42,
        color: temp > 320 ? [0.88, 0.62, 0.36] : [0.46, 0.68, 1.0],
        cloud: clamp(planet.climate.liquid_water_fraction * 0.42 + 0.08, 0.04, 0.58),
        banding: 0.28,
      }
  }
}

function paletteForPlanet(planet: Planet): Pick<Params, 'ocean_color' | 'land_color' | 'mountain_color' | 'sand_color' | 'snow_color'> {
  const temp = planet.climate.mean_surface_temp_k || planet.temperature_k
  if ((planet.body_type === 'SuperEarth' || planet.body_type === 'Terrestrial') && temp < 180) {
    return {
      ocean_color: [0.03, 0.08, 0.15],
      land_color: [0.48, 0.50, 0.52],
      mountain_color: [0.30, 0.31, 0.34],
      sand_color: [0.60, 0.58, 0.54],
      snow_color: [0.88, 0.93, 0.98],
    }
  }
  switch (planet.body_type) {
    case 'Inferno':
      return {
        ocean_color: [0.18, 0.07, 0.02],
        land_color: [0.64, 0.24, 0.11],
        mountain_color: [0.22, 0.12, 0.09],
        sand_color: [0.92, 0.46, 0.18],
        snow_color: [1.0, 0.78, 0.48],
      }
    case 'Frozen':
      return {
        ocean_color: [0.04, 0.10, 0.20],
        land_color: [0.54, 0.58, 0.60],
        mountain_color: [0.36, 0.38, 0.42],
        sand_color: [0.70, 0.68, 0.60],
        snow_color: [0.92, 0.97, 1.0],
      }
    case 'Rocky':
      return {
        ocean_color: [0.08, 0.08, 0.08],
        land_color: [0.50, 0.43, 0.36],
        mountain_color: [0.30, 0.27, 0.24],
        sand_color: [0.68, 0.56, 0.42],
        snow_color: [0.78, 0.76, 0.72],
      }
    case 'SuperEarth':
    case 'Terrestrial':
    default:
      return {
        ocean_color: [0.03, 0.15, 0.42],
        land_color: planet.climate.liquid_water_fraction > 0.18 ? [0.18, 0.55, 0.20] : [0.58, 0.38, 0.20],
        mountain_color: [0.40, 0.32, 0.24],
        sand_color: [0.86, 0.76, 0.52],
        snow_color: [0.97, 0.98, 1.0],
      }
  }
}

function gasPalette(body: BodyType, seed: number): Pick<Params, 'ocean_color' | 'land_color' | 'mountain_color' | 'sand_color' | 'snow_color'> {
  const wobble = ((Math.sin(seed * 0.000013) + 1) * 0.5) * 0.16
  if (body === 'IceGiant') {
    return {
      ocean_color: [0.05, 0.18, 0.42],
      land_color: [0.34, 0.68, 0.92],
      mountain_color: [0.10, 0.30, 0.62],
      sand_color: [0.66, 0.92, 1.0],
      snow_color: [0.90, 1.0, 1.0],
    }
  }
  if (body === 'MiniNeptune') {
    return {
      ocean_color: [0.06, 0.16, 0.28],
      land_color: [0.36, 0.58, 0.78],
      mountain_color: [0.18, 0.32, 0.54],
      sand_color: [0.60, 0.78, 0.88],
      snow_color: [0.86, 0.95, 1.0],
    }
  }
  return {
    ocean_color: mixColor([0.24, 0.13, 0.07], [0.40, 0.28, 0.16], wobble),
    land_color: mixColor([0.74, 0.52, 0.30], [0.86, 0.70, 0.45], wobble),
    mountain_color: [0.46, 0.28, 0.16],
    sand_color: [0.98, 0.83, 0.55],
    snow_color: [1.0, 0.95, 0.82],
  }
}

function planetPatch(planet: Planet): Partial<Params> {
  const atmo = atmosphereFor(planet)
  const fluid = planet.body_type === 'GasGiant' || planet.body_type === 'IceGiant' || planet.body_type === 'MiniNeptune'
  const fluidMode =
    planet.body_type === 'GasGiant'
      ? 1.0
      : planet.body_type === 'IceGiant'
        ? 1.16
        : planet.body_type === 'MiniNeptune'
          ? 1.32
          : 0
  const meanTempK = planet.climate.mean_surface_temp_k > 0 ? planet.climate.mean_surface_temp_k : planet.temperature_k
  const water = fluid ? 0 : waterFractionFor(planet)
  const palette = fluid ? gasPalette(planet.body_type, planet.seed) : paletteForPlanet(planet)
  const iceLatitude = fluid
    ? 0.98
    : clamp(0.94 - planet.climate.ice_fraction * 0.35, 0.52, 0.96)
  return {
    seed: planet.seed >>> 0,
    sea_level: water,
    mountain_height: fluid ? 0 : planet.body_type === 'Rocky' ? 0.10 : 0.06,
    atmosphere_density: atmo.density,
    atmosphere_color: atmo.color,
    cloud_coverage: atmo.cloud,
    crater_density: fluid ? 0 : planet.body_type === 'Rocky' ? 1.0 : planet.body_type === 'Frozen' ? 0.70 : meanTempK < 180 ? 0.48 : 0.22,
    population_intensity: 0,
    vegetation_richness: fluid ? 0 : clamp(planet.climate.habitability * 1.15, 0, 1),
    atm_banding: atmo.banding,
    body_visual_mode: fluid ? fluidMode : 0,
    surface_temp_k: meanTempK,
    planet_radius: radiusForPlanet(planet),
    ...palette,
    ice_latitude: iceLatitude,
  }
}

function starPatch(star: Star, seed: number): Partial<Params> {
  const base = star.color.map((c) => clamp(c, 0.05, 1.2)) as RGB
  const visualRadius = clamp(Math.pow(Math.max(star.radius_solar, 0.08), 0.62), 0.35, 2.4)
  return {
    seed: seed >>> 0,
    sea_level: 0,
    mountain_height: 0,
    atmosphere_density: 0,
    cloud_coverage: 0,
    crater_density: 0,
    population_intensity: 0,
    vegetation_richness: 0,
    atm_banding: 0,
    body_visual_mode: 2,
    surface_temp_k: star.temperature_k,
    planet_radius: visualRadius,
    ocean_color: scaleColor(base, 0.30),
    land_color: base,
    mountain_color: scaleColor(base, 0.62),
    sand_color: scaleColor(mixColor(base, [1.0, 0.88, 0.60], 0.30), 1.05),
    snow_color: scaleColor(base, 1.18),
    atmosphere_color: base,
    ice_latitude: 0.99,
  }
}

function beltPatch(system: SolarSystem, belt: AsteroidBelt, index: number): Partial<Params> {
  const seed = (system.seed ^ ((index + 1) * 0x9E3779B1)) >>> 0
  const dense = clamp(belt.density, 0, 1)
  return {
    seed,
    sea_level: 0,
    mountain_height: 0,
    atmosphere_density: 0,
    cloud_coverage: 0,
    crater_density: 1,
    population_intensity: 0,
    vegetation_richness: 0,
    atm_banding: 0,
    body_visual_mode: 3,
    surface_temp_k: 0,
    planet_radius: clamp(0.34 + dense * 0.20, 0.28, 0.62),
    ocean_color: [0.07, 0.07, 0.07],
    land_color: [0.46, 0.42, 0.36],
    mountain_color: [0.25, 0.23, 0.21],
    sand_color: [0.62, 0.54, 0.44],
    snow_color: [0.76, 0.74, 0.70],
    atmosphere_color: [0.22, 0.22, 0.24],
    ice_latitude: 0.98,
  }
}

export function paramsPatchForSystemTarget(
  system: SolarSystem,
  target: SystemBodyTarget,
): Partial<Params> | null {
  if (target.kind === 'planet') {
    const planet = system.planets[target.index]
    return planet ? planetPatch(planet) : null
  }
  if (target.kind === 'star') {
    if (target.index === 0) return starPatch(system.star, system.seed)
    const companion = system.companion
    return companion ? starPatch(companion.star, (system.seed ^ 0xA51CE5ED) >>> 0) : null
  }
  const belt = system.belts[target.index]
  return belt ? beltPatch(system, belt, target.index) : null
}

export function isMainWorldTarget(system: SolarSystem | null, target: SystemBodyTarget | null): boolean {
  return !!system && !!target && target.kind === 'planet' && target.index === system.main_world
}

export function targetExists(system: SolarSystem | null, target: SystemBodyTarget | null): boolean {
  if (!system || !target) return false
  if (target.kind === 'planet') return target.index >= 0 && target.index < system.planets.length
  if (target.kind === 'star') return target.index === 0 || (target.index === 1 && !!system.companion)
  return target.index >= 0 && target.index < system.belts.length
}
