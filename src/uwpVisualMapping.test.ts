import { describe, expect, it } from 'vitest'
import { paramsPatchFromUwp, paramsPatchFromUwpDigits } from './uwpVisualMapping'

describe('paramsPatchFromUwp', () => {
  it('maps an Earth-like UWP to habitable renderer params', () => {
    const patch = paramsPatchFromUwp('A867974-D')

    expect(patch).toMatchObject({
      sea_level: 0.7,
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
      sea_level: 0,
      atmosphere_density: 0,
      cloud_coverage: 0,
      crater_density: 1,
      vegetation_richness: 0,
      population_intensity: 0,
      planet_radius: 0.18,
      land_color: [0.46, 0.43, 0.39],
    })
  })

  it('reconciles impossible tiny-world UWP values into plausible visuals', () => {
    expect(paramsPatchFromUwp('A0AA999-F')).toMatchObject({
      sea_level: 0,
      atmosphere_density: 0,
      cloud_coverage: 0,
      crater_density: 1,
      vegetation_richness: 0,
      planet_radius: 0.18,
    })

    expect(paramsPatchFromUwp('A1A9999-F')).toMatchObject({
      sea_level: 0,
      atmosphere_density: 0.65,
      planet_radius: 0.18,
    })
  })

  it('does not emit city lights for corrosive worlds even with high population and tech', () => {
    expect(paramsPatchFromUwp('A8B9C00-F')).toMatchObject({
      atmosphere_density: 1,
      cloud_coverage: 0.85,
      population_intensity: 0,
    })
  })

  it('uses continuous slider values for visual params while UWP codes stay rounded', () => {
    const patch = paramsPatchFromUwpDigits({
      starport: 'A',
      size: 8.4,
      atm: 6.2,
      hydro: 7.5,
      pop: 8.5,
      gov: 7,
      law: 4,
      tech: 12.5,
    })

    expect(patch.sea_level).toBeCloseTo(0.75)
    expect(patch.planet_radius).toBeCloseTo(1.05)
    expect(patch.population_intensity).toBeCloseTo(0.5)
    expect(patch.atmosphere_density).toBe(0.45)
  })

  it('returns null for invalid UWP input', () => {
    expect(paramsPatchFromUwp('??')).toBeNull()
    expect(paramsPatchFromUwp('Z867974-D')).toBeNull()
  })

  it('sanitizes non-finite direct digit values before producing renderer params', () => {
    const patch = paramsPatchFromUwpDigits({
      starport: 'A',
      size: Number.NaN,
      atm: Number.POSITIVE_INFINITY,
      hydro: Number.NEGATIVE_INFINITY,
      pop: Number.NaN,
      gov: Number.POSITIVE_INFINITY,
      law: Number.NaN,
      tech: Number.POSITIVE_INFINITY,
    })

    expect(patch).toMatchObject({
      sea_level: 0,
      atmosphere_density: 0,
      cloud_coverage: 0,
      crater_density: 1,
      vegetation_richness: 0,
      population_intensity: 0,
      planet_radius: 0.18,
    })
    expect(Object.values(patch).flat().every((value) => Number.isFinite(value))).toBe(true)
  })
})
