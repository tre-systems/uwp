import { describe, expect, it } from 'vitest'
import { paramsPatchFromUwp } from './uwpVisualMapping'

describe('paramsPatchFromUwp', () => {
  it('maps an Earth-like UWP to habitable renderer params', () => {
    const patch = paramsPatchFromUwp('A867974-D')

    expect(patch).toMatchObject({
      sea_level: 0.68,
      atmosphere_density: 0.45,
      cloud_coverage: 0.22,
      vegetation_richness: 1,
      atm_banding: 0.5,
      planet_radius: 1,
      land_color: [0.18, 0.55, 0.20],
    })
    expect(patch?.population_intensity).toBeCloseTo(4 / 7)
  })

  it('maps airless dry worlds to cratered barren bodies', () => {
    expect(paramsPatchFromUwp('A000000-0')).toMatchObject({
      sea_level: 0.05,
      atmosphere_density: 0,
      cloud_coverage: 0,
      crater_density: 1,
      vegetation_richness: 0,
      population_intensity: 0,
      planet_radius: 0.18,
      land_color: [0.46, 0.43, 0.39],
    })
  })

  it('does not emit city lights for corrosive worlds even with high population and tech', () => {
    expect(paramsPatchFromUwp('A8B9C00-F')).toMatchObject({
      atmosphere_density: 1,
      cloud_coverage: 0.85,
      population_intensity: 0,
    })
  })

  it('returns null for invalid UWP input', () => {
    expect(paramsPatchFromUwp('??')).toBeNull()
    expect(paramsPatchFromUwp('Z867974-D')).toBeNull()
  })
})
