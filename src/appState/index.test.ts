import { describe, expect, it } from 'vitest'
import {
  params,
  pointAtSurface,
  renderPerformance,
  renderQualityMode,
  registerRendererControls,
  refreshSurfaceMap,
  rerollPlanet,
  clearSubsectorHexOverride,
  clearSubsectorRouteOverride,
  currentSubsector,
  currentSurfaceMap,
  currentSystem,
  generatedSubsectorHex,
  getSubsectorHexOverride,
  getSubsectorRouteOverride,
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
  setSubsectorHexOverride,
  setSubsectorOverrides,
  setSubsectorRouteOverride,
  setSubsectorRouteOverrides,
  setRenderPerformanceSnapshot,
  setRenderQualityMode,
  setParamsSnapshot,
  setSurfaceMap,
  setSystemSnapshot,
  setViewMode,
  setUwpField,
  setUwpFromCode,
  detailTarget,
  focusMainWorldDetail,
  focusSystemTarget,
  systemSeed,
  updateParams,
  uwp,
  viewMode,
  type RenderPerformanceSnapshot,
  type Params,
} from './index'
import type { BodyType, Planet, SolarSystem } from '../domain/system'
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
      pickSystemBody: () => null,
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
      pickSystemBody: () => null,
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

  it('derives non-main planet detail params from the selected system body', () => {
    const initialParams = { ...params.value }
    const initialView = viewMode.value
    const system = {
      ...fakeSystem(),
      main_world: 0,
      planets: [
        fakePlanet({ seed: 100, body_type: 'Terrestrial', radius_earth: 1, mean_surface_temp_k: 288 }),
        fakePlanet({ seed: 200, body_type: 'GasGiant', radius_earth: 11, mass_earth: 318, mean_surface_temp_k: 145 }),
      ],
    }
    let received: Params | null = null
    setSystemSnapshot(system)
    registerRendererControls({
      rerollPlanet: () => undefined,
      getSystem: () => system,
      setParams: (nextParams) => {
        received = nextParams
        setParamsSnapshot(nextParams)
      },
      pickSystemPlanet: () => null,
      pickSystemBody: () => ({ kind: 'planet', index: 1 }),
      getSurfaceMap: () => null,
      getSurfacePrebake: () => null,
      pointAtSurface: () => undefined,
    })

    focusSystemTarget({ kind: 'planet', index: 1 })

    expect(detailTarget.value).toEqual({ kind: 'planet', index: 1 })
    expect(viewMode.value).toBe('detail')
    expect(received).toMatchObject({
      seed: 200,
      body_visual_mode: 1,
      mountain_height: 0,
      planet_radius: 1.65,
      cloud_coverage: 0.98,
    })

    focusMainWorldDetail()
    expect(detailTarget.value).toBeNull()
    expect(params.value.body_visual_mode).toBe(0)

    registerRendererControls(null)
    setSystemSnapshot(null)
    setParamsSnapshot(initialParams)
    viewMode.value = initialView
  })

  it('keeps Surface mode focused on the selected planet instead of snapping to the main world', () => {
    const initialParams = { ...params.value }
    const initialView = viewMode.value
    const system = {
      ...fakeSystem(),
      main_world: 0,
      planets: [
        fakePlanet({ seed: 100, body_type: 'Terrestrial', radius_earth: 1, mean_surface_temp_k: 288 }),
        fakePlanet({ seed: 200, body_type: 'Frozen', radius_earth: 0.65, mean_surface_temp_k: 190 }),
      ],
    }
    setSystemSnapshot(system)
    registerRendererControls({
      rerollPlanet: () => undefined,
      getSystem: () => system,
      setParams: (nextParams) => setParamsSnapshot(nextParams),
      pickSystemPlanet: () => null,
      pickSystemBody: () => null,
      getSurfaceMap: () => null,
      getSurfacePrebake: () => null,
      pointAtSurface: () => undefined,
    })

    focusSystemTarget({ kind: 'planet', index: 1 })
    setViewMode('surface')

    expect(detailTarget.value).toEqual({ kind: 'planet', index: 1 })
    expect(viewMode.value).toBe('surface')
    expect(params.value.seed).toBe(200)

    registerRendererControls(null)
    setSystemSnapshot(null)
    setParamsSnapshot(initialParams)
    detailTarget.value = null
    viewMode.value = initialView
  })

  it('requests surface maps for the selected planet index', () => {
    const initialView = viewMode.value
    const system = {
      ...fakeSystem(),
      main_world: 0,
      planets: [
        fakePlanet({ seed: 100, body_type: 'Terrestrial', radius_earth: 1, mean_surface_temp_k: 288 }),
        fakePlanet({ seed: 200, body_type: 'SuperEarth', radius_earth: 1.4, mean_surface_temp_k: 255 }),
      ],
    }
    const map = {
      seed: 200,
      ocean_fraction: 0.4,
      hexes: [],
      starport: null,
      cities: [],
    }
    let requestedIndex: number | null | undefined = undefined

    setSystemSnapshot(system)
    detailTarget.value = { kind: 'planet', index: 1 }
    registerRendererControls({
      rerollPlanet: () => undefined,
      getSystem: () => system,
      setParams: () => undefined,
      pickSystemPlanet: () => null,
      pickSystemBody: () => null,
      getSurfaceMap: (planetIndex) => {
        requestedIndex = planetIndex
        return map
      },
      getSurfacePrebake: () => null,
      pointAtSurface: () => undefined,
    })

    refreshSurfaceMap()

    expect(requestedIndex).toBe(1)
    expect(currentSurfaceMap.value).toBe(map)

    registerRendererControls(null)
    setSystemSnapshot(null)
    setSurfaceMap(null)
    detailTarget.value = null
    viewMode.value = initialView
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
      pickSystemBody: () => null,
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
      pickSystemBody: () => null,
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
      pickSystemBody: () => null,
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

  it('reconciles direct UWP entry into continuous renderer params', () => {
    const initialParams = { ...params.value }
    const initialUwp = { ...uwp.value }

    expect(setUwpFromCode('A867974-D')).toBe(true)

    expect(uwp.value).toMatchObject({
      starport: 'A',
      size: 8,
      atm: 6,
      hydro: 7,
      pop: 9,
      gov: 7,
      law: 4,
      tech: 13,
    })
    expect(params.value).toMatchObject({
      planet_radius: 1,
      atmosphere_density: 0.45,
      sea_level: 0.7,
      vegetation_richness: 1,
    })

    const afterValidUwp = { ...uwp.value }
    const afterValidParams = { ...params.value }

    expect(setUwpFromCode('Z867974-D')).toBe(false)
    expect(uwp.value).toEqual(afterValidUwp)
    expect(params.value).toEqual(afterValidParams)

    expect(setUwpFromCode('A0AA999-F')).toBe(true)
    expect(uwp.value).toMatchObject({
      size: 0,
      atm: 0,
      hydro: 0,
      pop: 9,
      gov: 9,
      law: 9,
      tech: 15,
    })
    expect(params.value).toMatchObject({
      planet_radius: 0.18,
      atmosphere_density: 0,
      sea_level: 0,
      vegetation_richness: 0,
    })

    uwp.value = initialUwp
    setParamsSnapshot(initialParams)
  })

  it('keeps slider-edited values continuous while params use rounded game buckets where needed', () => {
    const initialParams = { ...params.value }
    const initialUwp = { ...uwp.value }

    uwp.value = {
      starport: 'A',
      size: 8,
      atm: 6,
      hydro: 7,
      pop: 8,
      gov: 7,
      law: 4,
      tech: 12,
    }

    setUwpField('hydro', 7.5)
    setUwpField('size', 8.4)
    setUwpField('pop', 8.5)

    expect(uwp.value.hydro).toBe(7.5)
    expect(uwp.value.size).toBe(8.4)
    expect(uwp.value.pop).toBe(8.5)
    expect(params.value.sea_level).toBeCloseTo(0.75)
    expect(params.value.planet_radius).toBeCloseTo(1.05)
    expect(params.value.population_intensity).toBeCloseTo(0.5)

    uwp.value = initialUwp
    setParamsSnapshot(initialParams)
  })

  it('applies referee overrides as an effective subsector and can reset to generated facts', () => {
    const sub = fakeSubsector()
    setSubsectorOverrides({})
    setSubsector(sub)

    setSubsectorHexOverride({ col: 16, row: 10 }, {
      travel_zone: 'Red',
      allegiance: 'Na',
      bases: { naval: true, scout: false, research: true, Aid: false },
    })

    expect(getSubsectorHexOverride(99, { col: 16, row: 10 })).toMatchObject({
      system_seed: 0x12345678,
      travel_zone: 'Red',
    })
    expect(generatedSubsectorHex({ col: 16, row: 10 })).toMatchObject({
      travel_zone: 'Green',
      bases: { naval: false, scout: true, research: false, Aid: false },
    })
    expect(currentSubsector.value?.hexes[0]).toMatchObject({
      travel_zone: 'Red',
      bases: { naval: true, scout: false, research: true, Aid: false },
    })

    clearSubsectorHexOverride({ col: 16, row: 10 })

    expect(getSubsectorHexOverride(99, { col: 16, row: 10 })).toBeNull()
    expect(currentSubsector.value?.hexes[0]).toMatchObject({
      travel_zone: 'Green',
      bases: { naval: false, scout: true, research: false, Aid: false },
    })

    setSubsector(null)
  })

  it('keeps overrides across regeneration for the same world but ignores stale system seeds', () => {
    const sub = fakeSubsector()
    setSubsectorOverrides({})
    setSubsector(sub)

    setSubsectorHexOverride({ col: 16, row: 10 }, { travel_zone: 'Amber' })
    setSubsector(fakeSubsector())
    expect(currentSubsector.value?.hexes[0].travel_zone).toBe('Amber')

    setSubsector({
      ...fakeSubsector(),
      hexes: [{
        ...fakeSubsector().hexes[0],
        system_seed: 0x87654321,
      }],
    })

    expect(currentSubsector.value?.hexes[0].travel_zone).toBe('Green')

    setSubsector(null)
    setSubsectorOverrides({})
  })

  it('applies and clears route metadata overrides on the effective subsector', () => {
    const sub: Subsector = {
      ...fakeSubsector(),
      hexes: [
        fakeSubsector().hexes[0],
        {
          ...fakeSubsector().hexes[0],
          coord: { col: 16, row: 9 },
          system_seed: 0x11111111,
        },
      ],
      jump_routes: [{
        from: { col: 16, row: 9 },
        to: { col: 16, row: 10 },
        jump: 1,
        communication: true,
        trade: true,
        trade_score: 7,
      }],
    }
    const route = sub.jump_routes[0]
    setSubsectorOverrides({})
    setSubsectorRouteOverrides({})
    setSubsector(sub)

    setSubsectorRouteOverride(route, {
      visible: false,
      communication: false,
      trade: true,
      trade_score: 12,
    })

    expect(getSubsectorRouteOverride(99, route)).toMatchObject({
      from_system_seed: 0x11111111,
      to_system_seed: 0x12345678,
      visible: false,
      communication: false,
      trade_score: 12,
    })
    expect(currentSubsector.value?.jump_routes[0]).toMatchObject({
      visible: false,
      communication: false,
      trade: true,
      trade_score: 9,
    })

    clearSubsectorRouteOverride(route)

    expect(getSubsectorRouteOverride(99, route)).toBeNull()
    expect(currentSubsector.value?.jump_routes[0]).toMatchObject({
      communication: true,
      trade: true,
      trade_score: 7,
    })

    setSubsector(null)
    setSubsectorRouteOverrides({})
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

function fakePlanet(overrides: {
  seed: number
  body_type: BodyType
  radius_earth: number
  mass_earth?: number
  mean_surface_temp_k: number
}): Planet {
  const mass = overrides.mass_earth ?? overrides.radius_earth
  return {
    orbit_au: 1,
    eccentricity: 0.01,
    inclination_deg: 0,
    radius_earth: overrides.radius_earth,
    mass_earth: mass,
    temperature_k: overrides.mean_surface_temp_k,
    body_type: overrides.body_type,
    phase_rad: 0,
    day_seconds: 86_400,
    in_habitable_zone: overrides.body_type === 'Terrestrial',
    moons: [],
    seed: overrides.seed,
    climate: {
      mean_surface_temp_k: overrides.mean_surface_temp_k,
      min_surface_temp_k: overrides.mean_surface_temp_k - 20,
      max_surface_temp_k: overrides.mean_surface_temp_k + 20,
      greenhouse_k: 12,
      liquid_water_fraction: overrides.body_type === 'Terrestrial' ? 0.5 : 0,
      ice_fraction: overrides.body_type === 'Frozen' ? 0.7 : 0.1,
      aridity: 0.3,
      habitability: overrides.body_type === 'Terrestrial' ? 0.7 : 0,
      thermal_inertia: 0.5,
      mean_rainfall_mm: 700,
    },
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
