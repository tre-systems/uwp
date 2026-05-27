import { signal } from '@preact/signals'
import { defaultParams, randomizeParams, type Params } from '../params'
import {
  defaultUwp,
  parseUwpDigits,
  randomUwpDigits,
  reconcileUwpDigits,
  type UwpDigits,
  uwpToCode,
} from '../uwp'
import { paramsPatchFromUwp, paramsPatchFromUwpDigits } from '../uwpVisualMapping'
import type { Planet, SolarSystem, SystemBodyTarget } from '../domain/system'
import {
  applySubsectorOverrides,
  routeOverrideKey,
  subsectorOverrideKey,
  type HexCoord,
  type JumpRoute,
  type Subsector,
  type SubsectorHexOverride,
  type SubsectorRouteOverride,
  type SubsectorRouteOverrides,
  type SubsectorOverrides,
  type SubsectorUwp,
} from '../domain/subsector'
import type { SurfaceHex, SurfaceHexCoord, SurfaceMap } from '../domain/surfaceMap'
import type { RenderProfileName } from '../renderProfile'
import {
  isMainWorldTarget,
  paramsPatchForSystemTarget,
  targetExists,
} from '../systemVisualMapping'

export * from '../params'
export * from '../domain/cepheus'
export { paramsPatchFromUwp, paramsPatchFromUwpDigits }

export type ViewMode = 'subsector' | 'system' | 'detail' | 'surface'
export type RenderQualityMode = 'auto' | RenderProfileName

export interface RenderPerformanceSnapshot {
  mode: RenderQualityMode
  profile: RenderProfileName
  fps: number
  frameMs: number
  targetFps: number
  shaderQuality: number
  pixelWidth: number
  pixelHeight: number
}

export interface SurfacePrebake {
  lon_cells: number
  lat_cells: number
  heightmap: Float32Array | number[]
  /** Per-cell canonical biome id (matches Rust BiomeId enum). Present
   *  when the renderer client wrapped a fresh prebake. */
  biome_id?: Uint8Array | number[]
  sea_level_threshold?: number
}

export interface RendererControls {
  rerollPlanet(index: number, seed?: number): void
  getSystem(): SolarSystem | null
  setParams(params: Params): void
  /**
   * Ray-pick the system view. Coordinates are CSS pixels relative to the
   * canvas origin. Returns the 0-based planet index or `null` on miss.
   */
  pickSystemPlanet(canvasX: number, canvasY: number, timeMs: number): number | null
  pickSystemBody(canvasX: number, canvasY: number, timeMs: number): SystemBodyTarget | null
  /** Generate a Cepheus hex world map for a planet in the current system. */
  getSurfaceMap(planetIndex?: number | null): SurfaceMap | null
  /** Generate the Rust-side surface pre-bake (plate-tectonics +
   *  multi-octave noise heightmap) for a planet in the current system. Used by
   *  the Surface view to paint a rendered globe-like background under
   *  the hex grid. */
  getSurfacePrebake(planetIndex?: number | null): SurfacePrebake | null
  /** Rotate the detail-view globe to face a surface (lat, lon) in degrees. */
  pointAtSurface(latDeg: number, lonDeg: number): void
}

/** Hovered-body snapshot consumed by tooltips. Stays null when nothing
 *  is under the pointer or when we're not in system view. */
export interface HoverTarget {
  kind: SystemBodyTarget['kind']
  index: number
  /** Canvas-relative pixel position so the tooltip can anchor near the
   *  cursor without re-running the pick. */
  x: number
  y: number
}

// Lifecycle of the renderer pipeline. `idle` is the very first frame before
// the canvas mounts, `loading` covers WASM + GPU pipeline init, `ready` once
// the first frame has rendered, and `unsupported` / `error` for terminal
// failures we want to present as a card rather than a toast.
export type RendererStatus = 'idle' | 'loading' | 'ready' | 'unsupported' | 'error'

export const rendererStatus = signal<RendererStatus>('idle')
export const errorMessage = signal<string | null>(null)
export const panelOpen = signal(false)
export const uwp = signal<UwpDigits>({ ...defaultUwp })
export const params = signal<Params>({ ...defaultParams })
export const viewMode = signal<ViewMode>('detail')
export const systemSeed = signal<number>(1337)
export const currentSystem = signal<SolarSystem | null>(null)
export const subsectorSeed = signal<number>(0xC0FFEE)
export const subsectorDensity = signal<number>(0.5)
const generatedSubsector = signal<Subsector | null>(null)
export const currentSubsector = signal<Subsector | null>(null)
export const selectedHex = signal<HexCoord | null>(null)
export const showJumpRoutes = signal<boolean>(true)
export const subsectorOverrides = signal<SubsectorOverrides>({})
export const subsectorRouteOverrides = signal<SubsectorRouteOverrides>({})
export const hoverTarget = signal<HoverTarget | null>(null)
export const detailTarget = signal<SystemBodyTarget | null>(null)
export const currentSurfaceMap = signal<SurfaceMap | null>(null)
export const selectedSurfaceHex = signal<SurfaceHexCoord | null>(null)
export const selectedSurfaceCell = signal<SurfaceHex | null>(null)
/** When non-null, the RegionView modal renders the procedural landscape
 *  inside this surface hex. Set via openRegionView; cleared by Escape /
 *  backdrop / explicit close. */
export const regionHex = signal<SurfaceHexCoord | null>(null)
export const regionSurfaceCell = signal<SurfaceHex | null>(null)
/** Time-scale multiplier for the System scene's orbital animation.
 *  0 = paused. 1 = real-time (a planet's orbital period maps to its
 *  Kepler year). 5×/20× let the user watch a system evolve quickly.
 *  Only consulted while viewMode === 'system'; detail-view scenes
 *  always advance at 1× so clouds and waves never freeze. */
export const systemTimeSpeed = signal<number>(1)
export const renderQualityMode = signal<RenderQualityMode>('auto')
export const renderPerformance = signal<RenderPerformanceSnapshot>({
  mode: 'auto',
  profile: 'high',
  fps: 0,
  frameMs: 0,
  targetFps: 60,
  shaderQuality: 1,
  pixelWidth: 0,
  pixelHeight: 0,
})

let rendererControls: RendererControls | null = null

export function registerRendererControls(controls: RendererControls | null) {
  rendererControls = controls
}

export function setErrorMessage(message: string | null) {
  errorMessage.value = message
}

export function setRendererStatus(status: RendererStatus) {
  rendererStatus.value = status
}

export function setPanelOpen(open: boolean) {
  panelOpen.value = open
}

export function togglePanel() {
  panelOpen.value = !panelOpen.value
}

export function setViewMode(mode: ViewMode) {
  if (mode === 'surface' && selectedSurfacePlanetIndex() == null) {
    if (!currentSystem.value) {
      viewMode.value = mode
      return
    }
    currentSurfaceMap.value = null
    return
  }
  viewMode.value = mode
}

export function selectedSurfacePlanetIndex(
  system: SolarSystem | null = currentSystem.value,
  target: SystemBodyTarget | null = detailTarget.value,
): number | null {
  if (!system || system.planets.length === 0) return null
  if (target) {
    if (target.kind !== 'planet') return null
    return system.planets[target.index] ? target.index : null
  }
  const mainIndex = system.main_world >= 0 ? system.main_world : -1
  return system.planets[mainIndex] ? mainIndex : null
}

export function selectedSurfacePlanet(): Planet | null {
  const system = currentSystem.value
  const index = selectedSurfacePlanetIndex(system)
  return index == null ? null : system?.planets[index] ?? null
}

export function selectedSurfaceTargetLabel(): string {
  const system = currentSystem.value
  const index = selectedSurfacePlanetIndex(system)
  if (index == null) return 'No planet selected'
  return system?.main_world === index ? 'Main World' : `Planet ${index + 1}`
}

export function setSystemTimeSpeed(speed: number) {
  // Clamp negatives to 0 so the renderer's dt stays non-negative;
  // reverse-time would require flipping each scene's phase advance
  // which isn't worth the extra plumbing.
  systemTimeSpeed.value = Math.max(0, speed)
}

export function setRenderQualityMode(mode: RenderQualityMode) {
  renderQualityMode.value = mode
}

export function setRenderPerformanceSnapshot(snapshot: RenderPerformanceSnapshot) {
  renderPerformance.value = snapshot
}

export function setSystemSeed(seed: number) {
  detailTarget.value = null
  systemSeed.value = seed
}

export function rerollSystemSeed() {
  setSystemSeed(Math.floor(Math.random() * 0xffffffff))
}

export function setSystemSnapshot(system: SolarSystem | null) {
  currentSystem.value = system
  if (!targetExists(system, detailTarget.value)) {
    detailTarget.value = null
  }
}

export function setParamsSnapshot(nextParams: Params) {
  params.value = nextParams
}

export function rerollPlanet(index: number) {
  rendererControls?.rerollPlanet(index)
  currentSystem.value = rendererControls?.getSystem() ?? currentSystem.value
}

export function setSubsector(sub: Subsector | null) {
  generatedSubsector.value = sub
  currentSubsector.value = sub
    ? applySubsectorOverrides(sub, subsectorOverrides.value, subsectorRouteOverrides.value)
    : null
}

export function setSubsectorSeed(seed: number) {
  subsectorSeed.value = seed
}

export function setSubsectorDensity(density: number) {
  subsectorDensity.value = Math.max(0, Math.min(1, density))
}

export function rerollSubsectorSeed() {
  setSubsectorSeed(Math.floor(Math.random() * 0xffffffff))
}

export function setSelectedHex(coord: HexCoord | null) {
  selectedHex.value = coord
}

export function setShowJumpRoutes(visible: boolean) {
  showJumpRoutes.value = visible
}

export function setSubsectorOverrides(overrides: SubsectorOverrides) {
  subsectorOverrides.value = overrides
  const sub = generatedSubsector.value
  currentSubsector.value = sub
    ? applySubsectorOverrides(sub, overrides, subsectorRouteOverrides.value)
    : null
}

export function setSubsectorRouteOverrides(overrides: SubsectorRouteOverrides) {
  subsectorRouteOverrides.value = overrides
  const sub = generatedSubsector.value
  currentSubsector.value = sub
    ? applySubsectorOverrides(sub, subsectorOverrides.value, overrides)
    : null
}

export function setSubsectorHexOverride(coord: HexCoord, patch: SubsectorHexOverride) {
  const sub = generatedSubsector.value ?? currentSubsector.value
  if (!sub) return
  const generatedHex = sub.hexes.find((h) => h.coord.col === coord.col && h.coord.row === coord.row)
  if (!generatedHex) return
  const key = subsectorOverrideKey(sub.seed, coord)
  const previous = subsectorOverrides.value[key] ?? {}
  const next: SubsectorHexOverride = {
    ...previous,
    system_seed: generatedHex.system_seed,
    ...patch,
    bases: patch.bases ? { ...patch.bases } : previous.bases,
  }
  setSubsectorOverrides({
    ...subsectorOverrides.value,
    [key]: next,
  })
}

export function clearSubsectorHexOverride(coord: HexCoord) {
  const sub = generatedSubsector.value ?? currentSubsector.value
  if (!sub) return
  const key = subsectorOverrideKey(sub.seed, coord)
  if (!subsectorOverrides.value[key]) return
  const next = { ...subsectorOverrides.value }
  delete next[key]
  setSubsectorOverrides(next)
}

export function getSubsectorHexOverride(seed: number, coord: HexCoord): SubsectorHexOverride | null {
  return subsectorOverrides.value[subsectorOverrideKey(seed, coord)] ?? null
}

export function setSubsectorRouteOverride(route: JumpRoute, patch: SubsectorRouteOverride) {
  const sub = generatedSubsector.value ?? currentSubsector.value
  if (!sub) return
  const key = routeOverrideKey(sub.seed, route.from, route.to)
  const previous = subsectorRouteOverrides.value[key] ?? {}
  const fromHex = sub.hexes.find((h) => h.coord.col === route.from.col && h.coord.row === route.from.row)
  const toHex = sub.hexes.find((h) => h.coord.col === route.to.col && h.coord.row === route.to.row)
  const next: SubsectorRouteOverride = {
    ...previous,
    from_system_seed: fromHex?.system_seed,
    to_system_seed: toHex?.system_seed,
    ...patch,
  }
  setSubsectorRouteOverrides({
    ...subsectorRouteOverrides.value,
    [key]: next,
  })
}

export function clearSubsectorRouteOverride(route: JumpRoute) {
  const sub = generatedSubsector.value ?? currentSubsector.value
  if (!sub) return
  const key = routeOverrideKey(sub.seed, route.from, route.to)
  if (!subsectorRouteOverrides.value[key]) return
  const next = { ...subsectorRouteOverrides.value }
  delete next[key]
  setSubsectorRouteOverrides(next)
}

export function getSubsectorRouteOverride(seed: number, route: JumpRoute): SubsectorRouteOverride | null {
  return subsectorRouteOverrides.value[routeOverrideKey(seed, route.from, route.to)] ?? null
}

export function generatedSubsectorHex(coord: HexCoord) {
  const sub = generatedSubsector.value
  return sub?.hexes.find((h) => h.coord.col === coord.col && h.coord.row === coord.row) ?? null
}

export function setHoverTarget(target: HoverTarget | null) {
  hoverTarget.value = target
}

export function setDetailTarget(target: SystemBodyTarget | null) {
  detailTarget.value = target
}

export function pickSystemPlanet(
  canvasX: number,
  canvasY: number,
  timeMs: number,
): number | null {
  return rendererControls?.pickSystemPlanet(canvasX, canvasY, timeMs) ?? null
}

export function pickSystemBody(
  canvasX: number,
  canvasY: number,
  timeMs: number,
): SystemBodyTarget | null {
  return rendererControls?.pickSystemBody(canvasX, canvasY, timeMs) ?? null
}

export function focusMainWorldDetail(): void {
  const sys = currentSystem.value
  const main = sys && sys.main_world >= 0 ? sys.planets[sys.main_world] ?? null : null
  detailTarget.value = null
  updateParams({
    ...paramsPatchFromUwpDigits(uwp.value),
    seed: main?.seed ?? params.value.seed,
    surface_temp_k: main?.climate.mean_surface_temp_k ?? 0,
  })
  setViewMode('detail')
}

export function focusSystemTarget(target: SystemBodyTarget): void {
  const sys = currentSystem.value
  if (!sys) return
  if (isMainWorldTarget(sys, target)) {
    focusMainWorldDetail()
    return
  }
  const patch = paramsPatchForSystemTarget(sys, target)
  if (!patch) return
  detailTarget.value = target
  updateParams(patch)
  setViewMode('detail')
}

export function setSurfaceMap(map: SurfaceMap | null) {
  currentSurfaceMap.value = map
}

export function setSelectedSurfaceHex(coord: SurfaceHexCoord | null, cell: SurfaceHex | null = null) {
  selectedSurfaceHex.value = coord
  selectedSurfaceCell.value = cell
}

/** Refresh the surface map from the selected planet's climate.
 *  This can trigger Rust surface pre-bake work, so callers should prefer
 *  doing it on Surface-view entry or when the Surface view is already visible. */
export function refreshSurfaceMap(): void {
  const planetIndex = selectedSurfacePlanetIndex()
  const map = planetIndex == null ? null : rendererControls?.getSurfaceMap(planetIndex) ?? null
  currentSurfaceMap.value = map
  selectedSurfaceHex.value = null
  selectedSurfaceCell.value = null
}

/** Fetch the Rust pre-bake heightmap for the selected planet (used
 *  to paint the Surface view's rendered background). */
export function getSurfacePrebake(): SurfacePrebake | null {
  const planetIndex = selectedSurfacePlanetIndex()
  return planetIndex == null ? null : rendererControls?.getSurfacePrebake(planetIndex) ?? null
}

/** Rotate the detail-view globe to face a surface (lat, lon). */
export function pointAtSurface(latDeg: number, lonDeg: number): void {
  rendererControls?.pointAtSurface(latDeg, lonDeg)
  if (params.value.auto_rotate !== 0) {
    setParams({ ...params.value, auto_rotate: 0 })
  }
}

/**
 * Pick a surface hex and rotate the globe to face it. If the user then
 * switches to Main World view the rendered globe is already aimed at
 * the chosen hex.
 */
export function selectAndFocusSurfaceHex(coord: SurfaceHexCoord, cell: SurfaceHex | null = null): void {
  setSelectedSurfaceHex(coord, cell)
  const map = currentSurfaceMap.value
  const hex = cell ?? map?.hexes.find((h) => h.coord.col === coord.col && h.coord.row === coord.row)
  if (!hex) return
  pointAtSurface(hex.latitude_deg, hex.longitude_deg)
}

/** Open the procedural Region detail modal for a surface hex. */
export function openRegionView(coord: SurfaceHexCoord, cell: SurfaceHex | null = null): void {
  regionHex.value = coord
  regionSurfaceCell.value = cell
}

export function closeRegionView(): void {
  regionHex.value = null
  regionSurfaceCell.value = null
}

/**
 * Pick a hex: store the selection, hand its system seed to the existing
 * system pipeline, and snap the view to detail so the user lands inside
 * the chosen system.
 */
export function selectHex(coord: HexCoord): void {
  const sub = currentSubsector.value
  if (!sub) return
  const hex = sub.hexes.find((h) => h.coord.col === coord.col && h.coord.row === coord.row)
  if (!hex) return
  setSelectedHex(coord)
  detailTarget.value = null
  applySubsectorUwp(hex.uwp, hex.system_seed)
  setSystemSeed(hex.system_seed)
  setViewMode('system')
}

function applySubsectorUwp(hexUwp: SubsectorUwp, seed: number): void {
  const nextUwp = reconcileUwpDigits({
    starport: hexUwp.starport,
    size: hexUwp.size,
    atm: hexUwp.atm,
    hydro: hexUwp.hydro,
    pop: hexUwp.pop,
    gov: hexUwp.gov,
    law: hexUwp.law,
    tech: hexUwp.tech,
  })
  uwp.value = nextUwp
  setParams({ ...params.value, ...paramsPatchFromUwpDigits(nextUwp), seed })
}

export function updateParams(patch: Partial<Params>) {
  setParams({ ...params.value, ...patch })
}

export function reset() {
  setParams({ ...defaultParams })
}

export function applyUwp(code: string): boolean {
  const patch = paramsPatchFromUwp(code)
  if (!patch) return false
  updateParams(patch)
  return true
}

export function setUwpField<K extends keyof UwpDigits>(field: K, value: UwpDigits[K]) {
  uwp.value = reconcileUwpDigits({ ...uwp.value, [field]: value })
  updateParams(paramsPatchFromUwpDigits(uwp.value))
}

export function setUwpFromCode(code: string): boolean {
  const parsed = parseUwpDigits(code)
  if (!parsed) return false
  uwp.value = parsed
  applyUwp(uwpToCode(parsed))
  return true
}

export function randomizeUwp() {
  uwp.value = randomUwpDigits()
  applyUwp(uwpToCode(uwp.value))
}

export function resetUwp() {
  uwp.value = { ...defaultUwp }
  applyUwp(uwpToCode(uwp.value))
}

export function randomize() {
  setParams(randomizeParams(params.value))
}

function setParams(nextParams: Params) {
  if (rendererControls) {
    rendererControls.setParams(nextParams)
  } else {
    setParamsSnapshot(nextParams)
  }
}
