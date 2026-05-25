import type { UwpDigits } from '../../uwp'
import type { MainWorldSummary, SolarSystem } from '../system'

export interface MainWorldModel {
  radiusEarth: number
  gravityEarth: number
  atmosphereCode: number
  hydrographicsPercent: number
  population: number
  governmentCode: number
  lawLevel: number
  techLevel: number
  starportQuality: number
}

const STARPORT_QUALITY: Record<string, number> = {
  A: 1,
  B: 0.82,
  C: 0.62,
  D: 0.42,
  E: 0.24,
  X: 0,
}

const STARPORT_BY_QUALITY = [
  { min: 0.9, value: 'A' },
  { min: 0.72, value: 'B' },
  { min: 0.52, value: 'C' },
  { min: 0.32, value: 'D' },
  { min: 0.1, value: 'E' },
]

export function uwpToMainWorldModel(uwp: UwpDigits): MainWorldModel {
  const radiusEarth = uwp.size <= 0 ? 0 : uwp.size / 8
  return {
    radiusEarth,
    gravityEarth: Math.max(0, radiusEarth),
    atmosphereCode: uwp.atm,
    hydrographicsPercent: uwp.hydro * 10,
    population: uwp.pop <= 0 ? 0 : 10 ** uwp.pop,
    governmentCode: uwp.gov,
    lawLevel: uwp.law,
    techLevel: uwp.tech,
    starportQuality: STARPORT_QUALITY[uwp.starport] ?? 0,
  }
}

export function mainWorldModelToUwp(model: MainWorldModel): UwpDigits {
  const size = clampRound(model.radiusEarth * 8, 0, 10)
  const pop = populationExponent(model.population)
  const atm = size === 0 ? 0 : clampRound(model.atmosphereCode, 0, 15)
  const hydro = size <= 1 ? 0 : hydrographicsCode(model.hydrographicsPercent)
  const gov = pop === 0 ? 0 : clampRound(model.governmentCode, 0, 15)
  const law = gov === 0 ? 0 : clampRound(model.lawLevel, 0, 15)
  const tech = pop === 0 ? 0 : clampRound(model.techLevel, 0, 15)
  return {
    starport: starportFromQuality(model.starportQuality),
    size,
    atm,
    hydro,
    pop,
    gov,
    law,
    tech,
  }
}

export function mainWorldSummary(system: SolarSystem | null): MainWorldSummary | null {
  if (!system) return null
  const planet = system.planets[system.main_world]
  if (!planet) return null
  return {
    planetIndex: system.main_world,
    orbitAu: planet.orbit_au,
    radiusEarth: planet.radius_earth,
    massEarth: planet.mass_earth,
    temperatureK: planet.temperature_k,
    bodyType: planet.body_type,
    moonCount: planet.moons.length,
  }
}

function clampRound(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}

function populationExponent(population: number) {
  if (!Number.isFinite(population) || population <= 0) return 0
  return Math.max(0, Math.min(10, Math.floor(Math.log10(population))))
}

function hydrographicsCode(percent: number) {
  if (!Number.isFinite(percent)) return 0
  const pct = Math.max(0, Math.min(100, percent))
  if (pct <= 5) return 0
  return Math.max(0, Math.min(10, Math.floor((pct + 4) / 10)))
}

function starportFromQuality(quality: number) {
  const match = STARPORT_BY_QUALITY.find((entry) => quality >= entry.min)
  return match?.value ?? 'X'
}
