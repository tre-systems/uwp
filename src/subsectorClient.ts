import { effect } from '@preact/signals'
import {
  createSubsectorBuilder,
  finishSubsectorBuilder,
  generateSubsector,
  stepSubsectorBuilder,
} from '../pkg/planet_render'
import {
  currentSubsector,
  selectedHex,
  setSelectedHex,
  setSubsector,
  subsectorDensity,
  subsectorSeed,
  syncUwpFromSelectedHex,
} from './appState'
import { withChartWork, yieldToPaint } from './appState/chartWork'
import type { Subsector } from './domain/subsector'
import { generateSubsectorInWorker, wasmComputeAvailable } from './wasmCompute'
import { ensureWasmReady } from './wasm'

// Subsector generation is independent of the GPU renderer (no shader,
// no canvas, just deterministic data). We still need the WASM module
// loaded because the generator lives in Rust.

let refreshGeneration = 0
let densityDebounceTimer: ReturnType<typeof setTimeout> | null = null
let lastRefreshSeed = subsectorSeed.value

function applySubsector(sub: Subsector, selected: typeof selectedHex.value): void {
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
}

async function refreshOnMainThread(generation: number): Promise<void> {
  await ensureWasmReady()
  if (generation !== refreshGeneration) return

  const selected = selectedHex.value
  const seed = subsectorSeed.value
  const density = subsectorDensity.value

  if (wasmComputeAvailable()) {
    try {
      const sub = await generateSubsectorInWorker(seed, density, 4)
      if (generation !== refreshGeneration) return
      applySubsector(sub, selected)
      return
    } catch (err) {
      console.warn('subsector worker failed, falling back to main thread', err)
    }
  }

  const builder = createSubsectorBuilder(seed >>> 0, density)
  const cellsPerStep = 4
  while (!stepSubsectorBuilder(builder, cellsPerStep)) {
    await yieldToPaint()
    if (generation !== refreshGeneration) return
  }
  const sub = finishSubsectorBuilder(builder) as Subsector
  if (generation !== refreshGeneration) return
  applySubsector(sub, selected)
}

async function refresh(): Promise<void> {
  const generation = ++refreshGeneration
  await withChartWork('Generating region map…', async () => {
    await refreshOnMainThread(generation)
  })
}

/** Fast path when workers are unavailable (tests, very old browsers). */
async function refreshSyncFallback(generation: number): Promise<void> {
  await ensureWasmReady()
  if (generation !== refreshGeneration) return
  const sub = generateSubsector(subsectorSeed.value, subsectorDensity.value) as Subsector
  if (generation !== refreshGeneration) return
  applySubsector(sub, selectedHex.value)
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

/** Test-only synchronous regen when workers are not used. */
export async function refreshSubsectorForTests(): Promise<void> {
  const generation = ++refreshGeneration
  await withChartWork('Generating region map…', async () => {
    if (wasmComputeAvailable()) {
      await refreshOnMainThread(generation)
    } else {
      await refreshSyncFallback(generation)
    }
  })
}
