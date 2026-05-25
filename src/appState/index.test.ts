import { describe, expect, it } from 'vitest'
import {
  params,
  pointAtSurface,
  renderPerformance,
  renderQualityMode,
  registerRendererControls,
  rerollPlanet,
  currentSystem,
  closeRegionView,
  openRegionView,
  regionHex,
  regionSurfaceCell,
  selectHex,
  selectAndFocusSurfaceHex,
  selectedHex,
  selectedSurfaceCell,
  selectedSurfaceHex,
  setSubsector,
  setRenderPerformanceSnapshot,
  setRenderQualityMode,
  setParamsSnapshot,
  setSurfaceMap,
  setSystemSnapshot,
  systemSeed,
  updateParams,
  uwp,
  viewMode,
  type RenderPerformanceSnapshot,
  type Params,
} from './index'
import type { SolarSystem } from '../domain/system'
import type { Subsector } from '../domain/subsector'

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

  it('keeps exact visual surface cells for focus and region drill-down', () => {
    const initial = { ...params.value }
    const cell = {
      coord: { col: 4, row: 5 },
      terrain: 'Shoreline' as const,
      latitude_deg: 12.25,
      longitude_deg: -87.5,
      temperature_k: 291,
      elevation: 0.52,
    }
    const coarseCell = {
      ...cell,
      latitude_deg: 1,
      longitude_deg: 2,
    }
    const focused: Array<[number, number]> = []

    setSurfaceMap({
      seed: 42,
      ocean_fraction: 0.25,
      hexes: [coarseCell],
      starport: null,
      cities: [],
    })
    registerRendererControls({
      rerollPlanet: () => undefined,
      getSystem: () => null,
      setParams: (nextParams) => setParamsSnapshot(nextParams),
      pickSystemPlanet: () => null,
      getSurfaceMap: () => null,
      getSurfacePrebake: () => null,
      pointAtSurface: (latDeg, lonDeg) => {
        focused.push([latDeg, lonDeg])
      },
    })

    selectAndFocusSurfaceHex(cell.coord, cell)
    openRegionView(cell.coord, cell)

    expect(selectedSurfaceHex.value).toEqual(cell.coord)
    expect(selectedSurfaceCell.value).toBe(cell)
    expect(regionHex.value).toEqual(cell.coord)
    expect(regionSurfaceCell.value).toBe(cell)
    expect(focused).toEqual([[12.25, -87.5]])

    closeRegionView()
    registerRendererControls(null)
    setSurfaceMap(null)
    setParamsSnapshot(initial)
  })

  it('applies the selected subsector hex UWP to the main world controls', () => {
    const initialParams = { ...params.value }
    const initialUwp = { ...uwp.value }
    const initialSeed = systemSeed.value
    const initialView = viewMode.value
    const sub = fakeSubsector()
    let received: Params | null = null

    setSubsector(sub)
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

    selectHex({ col: 16, row: 10 })

    expect(selectedHex.value).toEqual({ col: 16, row: 10 })
    expect(systemSeed.value).toBe(0x12345678)
    expect(viewMode.value).toBe('system')
    expect(uwp.value).toMatchObject({
      starport: 'C',
      size: 4,
      atm: 3,
      hydro: 2,
      pop: 9,
      gov: 6,
      law: 7,
      tech: 8,
    })
    expect(received).toMatchObject({
      seed: 0x12345678,
      planet_radius: 0.5,
      atmosphere_density: 0.18,
      sea_level: 0.2,
    })

    registerRendererControls(null)
    setSubsector(null)
    setParamsSnapshot(initialParams)
    uwp.value = initialUwp
    systemSeed.value = initialSeed
    viewMode.value = initialView
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

function fakeSubsector(): Subsector {
  return {
    seed: 99,
    density: 0.5,
    columns: 16,
    rows: 10,
    allegiance: 'Na',
    allegiances: [
      { code: 'Na', name: 'Neutral Border', capital: { col: 8, row: 5 }, color_index: 2 },
    ],
    hexes: [
      {
        coord: { col: 16, row: 10 },
        system_seed: 0x12345678,
        uwp: {
          starport: 'C',
          size: 4,
          atm: 3,
          hydro: 2,
          pop: 9,
          gov: 6,
          law: 7,
          tech: 8,
        },
        bases: {
          naval: false,
          scout: true,
          research: false,
          Aid: false,
        },
        travel_zone: 'Green',
        allegiance: 'Na',
        gas_giant: true,
        belts: false,
        population: 9_000_000_000,
        pbg: {
          population_multiplier: 9,
          belts: 0,
          gas_giants: 1,
        },
        name: 'Test',
      },
    ],
    jump_routes: [],
  }
}
