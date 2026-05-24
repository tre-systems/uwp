import { signal } from '@preact/signals'
import { defaultParams, randomizeParams, type Params } from '../params'
import {
  defaultUwp,
  parseUwpDigits,
  randomUwpDigits,
  type UwpDigits,
  uwpToCode,
} from '../uwp'
import { paramsPatchFromUwp, paramsPatchFromUwpDigits } from '../uwpVisualMapping'
import type { SolarSystem } from '../domain/system'
import type { HexCoord, Subsector } from '../domain/subsector'
import type { SurfaceHexCoord, SurfaceMap } from '../domain/surfaceMap'
import type { RenderProfileName } from '../renderProfile'

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

export interface RendererControls {
  rerollPlanet(index: number, seed?: number): void
  getSystem(): SolarSystem | null
  setParams(params: Params): void
  /**
   * Ray-pick the system view. Coordinates are CSS pixels relative to the
   * canvas origin. Returns the 0-based planet index or `null` on miss.
   */
  pickSystemPlanet(canvasX: number, canvasY: number, timeMs: number): number | null
  /** Generate a Cepheus hex world map for the current main world. */
  getSurfaceMap(): SurfaceMap | null
  /** Rotate the detail-view globe to face a surface (lat, lon) in degrees. */
  pointAtSurface(latDeg: number, lonDeg: number): void
}

/** Hovered-body snapshot consumed by tooltips. Stays null when nothing
 *  is under the pointer or when we're not in system view. */
export interface HoverTarget {
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
export const currentSubsector = signal<Subsector | null>(null)
export const selectedHex = signal<HexCoord | null>(null)
export const showJumpRoutes = signal<boolean>(true)
export const hoverTarget = signal<HoverTarget | null>(null)
export const currentSurfaceMap = signal<SurfaceMap | null>(null)
export const selectedSurfaceHex = signal<SurfaceHexCoord | null>(null)
/** When non-null, the RegionView modal renders the procedural landscape
 *  inside this surface hex. Set via openRegionView; cleared by Escape /
 *  backdrop / explicit close. */
export const regionHex = signal<SurfaceHexCoord | null>(null)
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
  viewMode.value = mode
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
  systemSeed.value = seed
}

export function rerollSystemSeed() {
  setSystemSeed(Math.floor(Math.random() * 0xffffffff))
}

export function setSystemSnapshot(system: SolarSystem | null) {
  currentSystem.value = system
}

export function setParamsSnapshot(nextParams: Params) {
  params.value = nextParams
}

export function rerollPlanet(index: number) {
  rendererControls?.rerollPlanet(index)
  currentSystem.value = rendererControls?.getSystem() ?? currentSystem.value
}

export function setSubsector(sub: Subsector | null) {
  currentSubsector.value = sub
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

export function setHoverTarget(target: HoverTarget | null) {
  hoverTarget.value = target
}

export function pickSystemPlanet(
  canvasX: number,
  canvasY: number,
  timeMs: number,
): number | null {
  return rendererControls?.pickSystemPlanet(canvasX, canvasY, timeMs) ?? null
}

export function setSurfaceMap(map: SurfaceMap | null) {
  currentSurfaceMap.value = map
}

export function setSelectedSurfaceHex(coord: SurfaceHexCoord | null) {
  selectedSurfaceHex.value = coord
}

/** Refresh the surface map from the current main world's climate. Cheap. */
export function refreshSurfaceMap(): void {
  const map = rendererControls?.getSurfaceMap() ?? null
  currentSurfaceMap.value = map
  selectedSurfaceHex.value = null
}

/** Rotate the detail-view globe to face a surface (lat, lon). */
export function pointAtSurface(latDeg: number, lonDeg: number): void {
  rendererControls?.pointAtSurface(latDeg, lonDeg)
}

/**
 * Pick a surface hex and rotate the globe to face it. If the user then
 * switches to Main World view the rendered globe is already aimed at
 * the chosen hex.
 */
export function selectAndFocusSurfaceHex(coord: SurfaceHexCoord): void {
  setSelectedSurfaceHex(coord)
  const map = currentSurfaceMap.value
  if (!map) return
  const hex = map.hexes.find((h) => h.coord.col === coord.col && h.coord.row === coord.row)
  if (!hex) return
  pointAtSurface(hex.latitude_deg, hex.longitude_deg)
}

/** Open the procedural Region detail modal for a surface hex. */
export function openRegionView(coord: SurfaceHexCoord): void {
  regionHex.value = coord
}

export function closeRegionView(): void {
  regionHex.value = null
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
  setSystemSeed(hex.system_seed)
  setViewMode('system')
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
  uwp.value = { ...uwp.value, [field]: value }
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
