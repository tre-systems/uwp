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
import type { RenderProfileName } from '../renderProfile'

export * from '../params'
export * from '../domain/cepheus'
export { paramsPatchFromUwp, paramsPatchFromUwpDigits }

export type ViewMode = 'subsector' | 'system' | 'detail'
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
