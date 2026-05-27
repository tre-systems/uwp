import { describe, expect, it } from 'vitest'
import { detailTarget, params, setParamsSnapshot } from '../appState'
import type { SolarSystem } from '../domain/system'
import { formatBodyViewLabel, resolvedDetailTarget } from './bodyView'

function fakeSystem(): SolarSystem {
  return {
    seed: 0xBEEF,
    star: {
      mass_solar: 1,
      radius_solar: 1,
      temperature_k: 5800,
      luminosity_solar: 1,
      spectral: 'G2V',
      color_srgb: [1, 1, 1],
    },
    companion: null,
    planets: [
      {
        seed: 0x1111,
        body_type: 'Rocky',
        orbit_au: 1,
        mass_earth: 1,
        radius_earth: 1,
        temperature_k: 288,
        day_seconds: 86400,
        eccentricity: 0,
        inclination_deg: 0,
        climate: {
          mean_surface_temp_k: 288,
          liquid_water_fraction: 0.5,
          habitability: 0.7,
          ice_fraction: 0.1,
          aridity: 0.3,
        },
        moons: [],
      },
      {
        seed: 0x2222,
        body_type: 'GasGiant',
        orbit_au: 5,
        mass_earth: 300,
        radius_earth: 11,
        temperature_k: 150,
        day_seconds: 36000,
        eccentricity: 0.01,
        inclination_deg: 0.5,
        climate: {
          mean_surface_temp_k: 150,
          liquid_water_fraction: 0,
          habitability: 0,
          ice_fraction: 0,
          aridity: 1,
        },
        moons: [],
      },
    ],
    belts: [],
    main_world: 0,
  }
}

describe('resolvedDetailTarget', () => {
  it('uses detailTarget when set', () => {
    const system = fakeSystem()
    detailTarget.value = { kind: 'planet', index: 1 }
    expect(resolvedDetailTarget(system)).toEqual({ kind: 'planet', index: 1 })
    detailTarget.value = null
  })

  it('infers the focused planet from params.seed when detailTarget is cleared', () => {
    const system = fakeSystem()
    const initial = { ...params.value }
    detailTarget.value = null
    setParamsSnapshot({ ...initial, seed: 0x2222 })
    expect(resolvedDetailTarget(system)).toEqual({ kind: 'planet', index: 1 })
    setParamsSnapshot(initial)
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
