import { describe, expect, it } from 'vitest'
import { mainWorldModelToUwp, mainWorldSummary, uwpToMainWorldModel } from './model'

describe('main world model', () => {
  it('keeps UWP as a rounded projection of continuous values', () => {
    const model = uwpToMainWorldModel({
      starport: 'A',
      size: 8,
      atm: 6,
      hydro: 7,
      pop: 9,
      gov: 7,
      law: 4,
      tech: 13,
    })

    expect(model.radiusEarth).toBe(1)
    expect(model.hydrographicsPercent).toBe(70)
    expect(mainWorldModelToUwp({ ...model, radiusEarth: 1.06, techLevel: 12.6 })).toMatchObject({
      size: 8,
      tech: 13,
    })
  })

  it('summarizes the generated physical main world without needing UI state', () => {
    expect(
      mainWorldSummary({
        seed: 1,
        star: {
          spectral: 'G',
          mass_solar: 1,
          luminosity_solar: 1,
          radius_solar: 1,
          temperature_k: 5772,
          color: [1, 0.95, 0.9],
        },
        companion: null,
        planets: [
          {
            orbit_au: 1,
            eccentricity: 0,
            inclination_deg: 0,
            radius_earth: 1,
            mass_earth: 1,
            temperature_k: 288,
            body_type: 'Terrestrial',
            phase_rad: 0,
            day_seconds: 86400,
            in_habitable_zone: true,
            moons: [],
            seed: 99,
            climate: {
              mean_surface_temp_k: 288,
              min_surface_temp_k: 260,
              max_surface_temp_k: 305,
              greenhouse_k: 33,
              liquid_water_fraction: 0.7,
              ice_fraction: 0.1,
              aridity: 0.3,
              habitability: 0.9,
            },
          },
        ],
        belts: [],
        hz_inner_au: 0.95,
        hz_outer_au: 1.4,
        snow_line_au: 2.7,
        age_gyr: 4.5,
        main_world: 0,
      }),
    ).toMatchObject({ planetIndex: 0, bodyType: 'Terrestrial' })
  })
})
