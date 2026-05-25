import { describe, expect, it } from 'vitest'
import {
  params,
  pointAtSurface,
  renderPerformance,
  renderQualityMode,
  registerRendererControls,
  rerollPlanet,
  currentSystem,
  setRenderPerformanceSnapshot,
  setRenderQualityMode,
  setParamsSnapshot,
  setSystemSnapshot,
  updateParams,
  type RenderPerformanceSnapshot,
  type Params,
} from './index'
import type { SolarSystem } from '../domain/system'

describe('appState renderer command boundary', () => {
  it('delegates param updates to renderer controls when they are registered', () => {
    const initial = { ...params.value }
    let received: Params | null = null

    registerRendererControls({
      rerollPlanet: () => undefined,
      getSystem: () => null,
      setParams: (nextParams) => {
        received = nextParams
        setParamsSnapshot(nextParams)
      },
      pickSystemPlanet: () => null,
      getSurfaceMap: () => null,
      getSurfacePrebake: () => null,
      pointAtSurface: () => undefined,
    })

    updateParams({ sun_angle: 0.25 })

    expect(received).toMatchObject({ sun_angle: 0.25 })
    expect(params.value.sun_angle).toBe(0.25)

    registerRendererControls(null)
    setParamsSnapshot(initial)
  })

  it('refreshes the system snapshot after a planet reroll command', () => {
    const system = fakeSystem()
    let rerolled = -1
    registerRendererControls({
      rerollPlanet: (index) => {
        rerolled = index
      },
      getSystem: () => system,
      setParams: () => undefined,
      pickSystemPlanet: () => null,
      getSurfaceMap: () => null,
      getSurfacePrebake: () => null,
      pointAtSurface: () => undefined,
    })

    rerollPlanet(2)

    expect(rerolled).toBe(2)
    expect(currentSystem.value).toBe(system)

    registerRendererControls(null)
    setSystemSnapshot(null)
  })

  it('keeps the params snapshot aligned when focusing a surface point', () => {
    const initial = { ...params.value }
    const focused: Array<[number, number]> = []
    let received: Params | null = null

    setParamsSnapshot({ ...initial, auto_rotate: 0.75 })
    registerRendererControls({
      rerollPlanet: () => undefined,
      getSystem: () => null,
      setParams: (nextParams) => {
        received = nextParams
        setParamsSnapshot(nextParams)
      },
      pickSystemPlanet: () => null,
      getSurfaceMap: () => null,
      getSurfacePrebake: () => null,
      pointAtSurface: (latDeg, lonDeg) => {
        focused.push([latDeg, lonDeg])
      },
    })

    pointAtSurface(12.5, -45.25)

    expect(focused).toEqual([[12.5, -45.25]])
    expect(received).toMatchObject({ auto_rotate: 0 })
    expect(params.value.auto_rotate).toBe(0)

    registerRendererControls(null)
    setParamsSnapshot(initial)
  })

  it('stores render quality mode changes as app state', () => {
    const original = renderQualityMode.value

    setRenderQualityMode('low')

    expect(renderQualityMode.value).toBe('low')

    setRenderQualityMode(original)
  })

  it('publishes render performance snapshots for the panel', () => {
    const original = renderPerformance.value
    const snapshot: RenderPerformanceSnapshot = {
      mode: 'balanced',
      profile: 'balanced',
      fps: 44.5,
      frameMs: 22.5,
      targetFps: 45,
      shaderQuality: 0.68,
      pixelWidth: 1280,
      pixelHeight: 720,
    }

    setRenderPerformanceSnapshot(snapshot)

    expect(renderPerformance.value).toEqual(snapshot)

    setRenderPerformanceSnapshot(original)
  })
})

function fakeSystem(): SolarSystem {
  return {
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
    planets: [],
    belts: [],
    hz_inner_au: 0.95,
    hz_outer_au: 1.4,
    snow_line_au: 2.7,
    age_gyr: 4.5,
    main_world: 0,
  }
}
