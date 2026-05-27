import { effect } from '@preact/signals'
import { generateSubsector } from '../pkg/planet_render'
import {
  currentSubsector,
  selectedHex,
  setSelectedHex,
  setSubsector,
  subsectorDensity,
  subsectorSeed,
  syncUwpFromSelectedHex,
} from './appState'
import { withChartWork } from './appState/chartWork'
import type { Subsector } from './domain/subsector'
import { ensureWasmReady } from './wasm'

// Subsector generation is independent of the GPU renderer (no shader,
// no canvas, just deterministic data). We still need the WASM module
// loaded because the generator lives in Rust. This module:
//   - ensures the wasm module is initialised once
//   - subscribes to `subsectorSeed` and `subsectorDensity` and refreshes
//     `currentSubsector` whenever either changes
//   - clears the selected hex when the underlying grid changes so a
//     stale selection doesn't point at a now-empty cell

let refreshGeneration = 0
let densityDebounceTimer: ReturnType<typeof setTimeout> | null = null
let lastRefreshSeed = subsectorSeed.value

async function refresh(): Promise<void> {
  const generation = ++refreshGeneration
  await withChartWork('Generating region map…', async () => {
    await ensureWasmReady()
    if (generation !== refreshGeneration) return
    const sub = generateSubsector(subsectorSeed.value, subsectorDensity.value) as Subsector
    if (generation !== refreshGeneration) return
    const selected = selectedHex.value
    const previousSelected = selected
      ? currentSubsector.value?.hexes.find((h) => h.coord.col === selected.col && h.coord.row === selected.row)
      : null
    setSubsector(sub)
    const nextSelected = selected
      ? sub.hexes.find((h) => h.coord.col === selected.col && h.coord.row === selected.row)
      : null
    if (selected && (!nextSelected || (previousSelected && previousSelected.system_seed !== nextSelected.system_seed))) {
      setSelectedHex(null)
    } else if (nextSelected) {
      syncUwpFromSelectedHex()
    }
  })
}

function scheduleRefresh(immediate: boolean): void {
  if (densityDebounceTimer != null) {
    clearTimeout(densityDebounceTimer)
    densityDebounceTimer = null
  }
  if (immediate) {
    void refresh()
    return
  }
  densityDebounceTimer = setTimeout(() => {
    densityDebounceTimer = null
    void refresh()
  }, 280)
}

let disposer: (() => void) | null = null

export function installSubsectorPipeline(): void {
  if (disposer) return
  // Initial generation kicks off as soon as the wasm module is ready;
  // subsequent (seed, density) changes also trigger a regen.
  disposer = effect(() => {
    const seed = subsectorSeed.value
    const density = subsectorDensity.value
    void density
    const seedChanged = seed !== lastRefreshSeed
    lastRefreshSeed = seed
    scheduleRefresh(seedChanged)
  })
}

export function disposeSubsectorPipeline(): void {
  disposer?.()
  disposer = null
  if (densityDebounceTimer != null) {
    clearTimeout(densityDebounceTimer)
    densityDebounceTimer = null
  }
}
