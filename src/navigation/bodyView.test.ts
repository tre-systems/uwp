import { describe, expect, it } from 'vitest'
import { defaultParams } from '../params'
import type { BodyType, Planet, SolarSystem } from '../domain/system'
import { formatBodyViewLabel, resolvedDetailTarget } from './bodyView'

function fakePlanet(overrides: {
  seed: number
  body_type: BodyType
}): Planet {
  return {
    orbit_au: 1,
    eccentricity: 0.01,
    inclination_deg: 0,
    radius_earth: 1,
    mass_earth: 1,
    temperature_k: 288,
    body_type: overrides.body_type,
    phase_rad: 0,
    day_seconds: 86_400,
    in_habitable_zone: true,
    moons: [],
    seed: overrides.seed,
    climate: {
      mean_surface_temp_k: 288,
      min_surface_temp_k: 268,
      max_surface_temp_k: 308,
      greenhouse_k: 12,
      liquid_water_fraction: 0.5,
      ice_fraction: 0.1,
      aridity: 0.3,
      habitability: 0.7,
      thermal_inertia: 0.5,
      mean_rainfall_mm: 700,
    },
  }
}

function fakeSystem(): SolarSystem {
  return {
    seed: 0xBEEF,
    star: {
      mass_solar: 1,
      radius_solar: 1,
      temperature_k: 5800,
      luminosity_solar: 1,
      spectral: 'G',
      color: [1, 1, 1],
    },
    companion: null,
    planets: [
      fakePlanet({ seed: 0x1111, body_type: 'Terrestrial' }),
      fakePlanet({ seed: 0x2222, body_type: 'GasGiant' }),
    ],
    belts: [],
    hz_inner_au: 0.95,
    hz_outer_au: 1.4,
    snow_line_au: 2.7,
    age_gyr: 4.5,
    main_world: 0,
  }
}

describe('resolvedDetailTarget', () => {
  it('uses detailTarget when set', () => {
    const system = fakeSystem()
    expect(resolvedDetailTarget(system, { kind: 'planet', index: 1 }, defaultParams)).toEqual({ kind: 'planet', index: 1 })
  })

  it('infers the focused planet from params.seed when detailTarget is cleared', () => {
    const system = fakeSystem()
    expect(resolvedDetailTarget(system, null, { ...defaultParams, seed: 0x2222 })).toEqual({ kind: 'planet', index: 1 })
  })

  it('prefers the main world when appearance seed matches the system seed', () => {
    const system = fakeSystem()
    expect(resolvedDetailTarget(system, null, { ...defaultParams, seed: system.seed >>> 0 })).toEqual({ kind: 'planet', index: 0 })
  })
})

describe('formatBodyViewLabel', () => {
  it('names the main world by seed-derived name', () => {
    const system = fakeSystem()
    expect(formatBodyViewLabel(system, { kind: 'planet', index: 0 })).not.toBe('Main World')
  })

  it('includes body class for non-main planets', () => {
    const system = fakeSystem()
    const label = formatBodyViewLabel(system, { kind: 'planet', index: 1 })
    expect(label).toContain('Gas Giant')
    expect(label).toContain('2')
  })
})
