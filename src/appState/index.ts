import { signal } from '@preact/signals'
import { defaultParams, randomizeParams, type Params } from '../params'
import {
  defaultUwp,
  parseUwpDigits,
  randomUwpDigits,
  type UwpDigits,
  uwpToCode,
} from '../uwp'
import { paramsPatchFromUwp } from '../uwpVisualMapping'
import type { SolarSystem } from '../domain/system'

export * from '../params'
export * from '../domain/cepheus'
export { paramsPatchFromUwp }

export type ViewMode = 'detail' | 'system'

export interface RendererControls {
  rerollPlanet(index: number, seed?: number): void
  getSystem(): SolarSystem | null
  setParams(params: Params): void
}

export const errorMessage = signal<string | null>(null)
export const panelOpen = signal(false)
export const uwp = signal<UwpDigits>({ ...defaultUwp })
export const params = signal<Params>({ ...defaultParams })
export const viewMode = signal<ViewMode>('detail')
export const systemSeed = signal<number>(1337)
export const currentSystem = signal<SolarSystem | null>(null)

let rendererControls: RendererControls | null = null

export function registerRendererControls(controls: RendererControls | null) {
  rendererControls = controls
}

export function setErrorMessage(message: string | null) {
  errorMessage.value = message
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
  applyUwp(uwpToCode(uwp.value))
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
