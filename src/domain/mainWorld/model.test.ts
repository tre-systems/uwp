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

  it('clamps invalid and extreme continuous values at the UWP boundary', () => {
    expect(
      mainWorldModelToUwp({
        radiusEarth: -1,
        gravityEarth: -1,
        atmosphereCode: 99,
        hydrographicsPercent: 140,
        population: -20,
        governmentCode: -5,
        lawLevel: 22,
        techLevel: 30,
        starportQuality: -1,
      }),
    ).toEqual({
      starport: 'X',
      size: 0,
      atm: 0,
      hydro: 0,
      pop: 0,
      gov: 0,
      law: 0,
      tech: 0,
    })
  })

  it('projects population from lower-bound exponents rather than rounded UI state', () => {
    const sparse = mainWorldModelToUwp(uwpToMainWorldModel({
      starport: 'C',
      size: 4,
      atm: 5,
      hydro: 3,
      pop: 0,
      gov: 0,
      law: 0,
      tech: 7,
    }))
    const millionScale = mainWorldModelToUwp({
      ...uwpToMainWorldModel({
        starport: 'B',
        size: 8,
        atm: 6,
        hydro: 7,
        pop: 6,
        gov: 7,
        law: 4,
        tech: 10,
      }),
      population: 3.2e6,
    })

    expect(sparse.pop).toBe(0)
    expect(millionScale.pop).toBe(6)
  })

  it('uses Cepheus hydrographics buckets and physical zero-world constraints', () => {
    const base = uwpToMainWorldModel({
      starport: 'B',
      size: 8,
      atm: 6,
      hydro: 5,
      pop: 6,
      gov: 7,
      law: 4,
      tech: 10,
    })

    expect(mainWorldModelToUwp({ ...base, hydrographicsPercent: 0 }).hydro).toBe(0)
    expect(mainWorldModelToUwp({ ...base, hydrographicsPercent: 5 }).hydro).toBe(0)
    expect(mainWorldModelToUwp({ ...base, hydrographicsPercent: 6 }).hydro).toBe(1)
    expect(mainWorldModelToUwp({ ...base, hydrographicsPercent: 15 }).hydro).toBe(1)
    expect(mainWorldModelToUwp({ ...base, hydrographicsPercent: 16 }).hydro).toBe(2)
    expect(mainWorldModelToUwp({ ...base, hydrographicsPercent: 95 }).hydro).toBe(9)
    expect(mainWorldModelToUwp({ ...base, hydrographicsPercent: 96 }).hydro).toBe(10)
    expect(mainWorldModelToUwp({ ...base, hydrographicsPercent: 100 }).hydro).toBe(10)

    expect(mainWorldModelToUwp({ ...base, radiusEarth: 0.12, hydrographicsPercent: 95 }).hydro).toBe(0)
  })

  it('forces government law and tech to zero for uninhabited worlds', () => {
    expect(
      mainWorldModelToUwp({
        radiusEarth: 1,
        gravityEarth: 1,
        atmosphereCode: 6,
        hydrographicsPercent: 70,
        population: 0,
        governmentCode: 12,
        lawLevel: 12,
        techLevel: 12,
        starportQuality: 0.5,
      }),
    ).toMatchObject({
      pop: 0,
      gov: 0,
      law: 0,
      tech: 0,
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
              thermal_inertia: 0.4,
              mean_rainfall_mm: 900,
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
