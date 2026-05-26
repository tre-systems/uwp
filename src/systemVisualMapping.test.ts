import { describe, expect, it } from 'vitest'
import type { BodyType, Planet, SolarSystem } from './domain/system'
import { paramsPatchForSystemTarget } from './systemVisualMapping'

describe('paramsPatchForSystemTarget', () => {
  it('maps gas giants to the fluid-band detail renderer', () => {
    const system = fakeSystem([
      fakePlanet({ seed: 1, body_type: 'GasGiant', radius_earth: 11, mass_earth: 318, temp: 145 }),
    ])

    expect(paramsPatchForSystemTarget(system, { kind: 'planet', index: 0 })).toMatchObject({
      body_visual_mode: 1,
      seed: 1,
      mountain_height: 0,
      cloud_coverage: 0.98,
      atm_banding: 1,
      planet_radius: 1.65,
    })
  })

  it('maps stars and asteroid belts to dedicated detail modes', () => {
    const system = {
      ...fakeSystem([]),
      belts: [{ inner_au: 2.0, outer_au: 2.7, density: 0.8 }],
    }

    expect(paramsPatchForSystemTarget(system, { kind: 'star', index: 0 })).toMatchObject({
      body_visual_mode: 2,
      surface_temp_k: 5772,
      planet_radius: 1,
    })
    expect(paramsPatchForSystemTarget(system, { kind: 'belt', index: 0 })).toMatchObject({
      body_visual_mode: 3,
      crater_density: 1,
      atmosphere_density: 0,
    })
  })

  it('keeps terrestrial worlds in terrain-atlas mode with their own climate', () => {
    const system = fakeSystem([
      fakePlanet({ seed: 42, body_type: 'Terrestrial', radius_earth: 1, mass_earth: 1, temp: 289 }),
    ])

    const patch = paramsPatchForSystemTarget(system, { kind: 'planet', index: 0 })
    expect(patch).toMatchObject({
      body_visual_mode: 0,
      seed: 42,
      surface_temp_k: 289,
      sea_level: 0.52,
    })
    expect(patch?.vegetation_richness).toBeCloseTo(0.805)
  })

  it('keeps very cold super-earths icy and low-atmosphere instead of oceanic', () => {
    const system = fakeSystem([
      fakePlanet({ seed: 77, body_type: 'SuperEarth', radius_earth: 1.4, mass_earth: 5, temp: 90 }),
    ])

    const patch = paramsPatchForSystemTarget(system, { kind: 'planet', index: 0 })
    expect(patch).toMatchObject({
      body_visual_mode: 0,
      seed: 77,
      surface_temp_k: 90,
      atmosphere_density: 0.08,
      cloud_coverage: 0.04,
      crater_density: 0.48,
      land_color: [0.48, 0.50, 0.52],
    })
    expect(patch?.sea_level).toBe(0)
    expect(patch?.vegetation_richness).toBe(0)
  })
})

function fakeSystem(planets: Planet[]): SolarSystem {
  return {
    seed: 99,
    star: {
      spectral: 'G',
      mass_solar: 1,
      luminosity_solar: 1,
      radius_solar: 1,
      temperature_k: 5772,
      color: [1, 0.95, 0.9],
    },
    companion: null,
    planets,
    belts: [],
    hz_inner_au: 0.95,
    hz_outer_au: 1.4,
    snow_line_au: 2.7,
    age_gyr: 4.5,
    main_world: planets.length ? 0 : -1,
  }
}

function fakePlanet(args: {
  seed: number
  body_type: BodyType
  radius_earth: number
  mass_earth: number
  temp: number
}): Planet {
  return {
    orbit_au: 1,
    eccentricity: 0.01,
    inclination_deg: 0,
    radius_earth: args.radius_earth,
    mass_earth: args.mass_earth,
    temperature_k: args.temp,
    body_type: args.body_type,
    phase_rad: 0,
    day_seconds: 86_400,
    in_habitable_zone: args.body_type === 'Terrestrial',
    moons: [],
    seed: args.seed,
    climate: {
      mean_surface_temp_k: args.temp,
      min_surface_temp_k: args.temp - 20,
      max_surface_temp_k: args.temp + 20,
      greenhouse_k: 12,
      liquid_water_fraction: args.body_type === 'Terrestrial' ? 0.52 : 0,
      ice_fraction: 0.1,
      aridity: 0.3,
      habitability: args.body_type === 'Terrestrial' ? 0.7 : 0,
      thermal_inertia: 0.5,
      mean_rainfall_mm: 700,
    },
  }
}
