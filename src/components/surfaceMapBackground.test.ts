import { describe, expect, it } from 'vitest'
import { normalisedSurfaceSample } from './surfaceMapBackground'

describe('normalisedSurfaceSample', () => {
  it('maps projection radians into the pre-bake sampler range', () => {
    expect(normalisedSurfaceSample(-Math.PI / 2, -Math.PI)).toEqual({ lat: 0, lon: 0 })
    expect(normalisedSurfaceSample(0, 0)).toEqual({ lat: 0.5, lon: 0.5 })
    expect(normalisedSurfaceSample(Math.PI / 2, Math.PI)).toEqual({ lat: 1, lon: 1 })
  })
})
