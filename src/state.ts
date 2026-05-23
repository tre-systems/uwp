import { signal } from '@preact/signals'
import { defaultParams, randomizeParams, type Params } from './params'
import { defaultUwp, randomUwpDigits, type UwpDigits, uwpToCode } from './uwp'
import { parseUwpDigits } from './uwp'
import { paramsPatchFromUwp } from './uwpVisualMapping'

export * from './params'
export * from './uwp'
export * from './uwpDescriptions'
export { paramsPatchFromUwp }

export type ViewMode = 'detail' | 'system'

export const errorMessage = signal<string | null>(null)
export const panelOpen = signal(false)
export const uwp = signal<UwpDigits>({ ...defaultUwp })
export const params = signal<Params>({ ...defaultParams })
export const viewMode = signal<ViewMode>('detail')

export function updateParams(patch: Partial<Params>) {
  params.value = { ...params.value, ...patch }
}

export function reset() {
  params.value = { ...defaultParams }
}

export function applyUwp(code: string): boolean {
  const patch = paramsPatchFromUwp(code)
  if (!patch) return false
  updateParams(patch)
  return true
}

// Mutate a single UWP digit and immediately re-apply to renderer params.
export function setUwpField<K extends keyof UwpDigits>(field: K, value: UwpDigits[K]) {
  uwp.value = { ...uwp.value, [field]: value }
  applyUwp(uwpToCode(uwp.value))
}

// Update from text field — accepts any partial code, snaps to digit state.
export function setUwpFromCode(code: string): boolean {
  const parsed = parseUwpDigits(code)
  if (!parsed) return false
  uwp.value = parsed
  applyUwp(uwpToCode(parsed))
  return true
}

// Roll a random UWP. Keeps biases mild — most worlds are mid-range, not edge
// cases — so randomize doesn't constantly serve up asteroids or uninhabited gas giants.
export function randomizeUwp() {
  uwp.value = randomUwpDigits()
  applyUwp(uwpToCode(uwp.value))
}

export function resetUwp() {
  uwp.value = { ...defaultUwp }
  applyUwp(uwpToCode(uwp.value))
}

// Picks a new seed and randomizes the climate-y dials so each press feels different.
// Palette colors are left alone — the user usually wants those stable.
export function randomize() {
  params.value = randomizeParams(params.value)
}
