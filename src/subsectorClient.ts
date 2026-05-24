import { effect } from '@preact/signals'
import init, { generateSubsector } from '../pkg/planet_render'
import {
  setSelectedHex,
  setSubsector,
  subsectorDensity,
  subsectorSeed,
} from './appState'
import type { Subsector } from './domain/subsector'

// Subsector generation is independent of the GPU renderer (no shader,
// no canvas, just deterministic data). We still need the WASM module
// loaded because the generator lives in Rust. This module:
//   - ensures the wasm module is initialised once
//   - subscribes to `subsectorSeed` and `subsectorDensity` and refreshes
//     `currentSubsector` whenever either changes
//   - clears the selected hex when the underlying grid changes so a
//     stale selection doesn't point at a now-empty cell

let initialized = false
let initPromise: Promise<void> | null = null

function ensureInit(): Promise<void> {
  if (initialized) return Promise.resolve()
  if (!initPromise) initPromise = init().then(() => { initialized = true })
  return initPromise
}

async function refresh(): Promise<void> {
  await ensureInit()
  const sub = generateSubsector(subsectorSeed.value, subsectorDensity.value) as Subsector
  setSubsector(sub)
  setSelectedHex(null)
}

let disposer: (() => void) | null = null

export function installSubsectorPipeline(): void {
  if (disposer) return
  // Initial generation kicks off as soon as the wasm module is ready;
  // subsequent (seed, density) changes also trigger a regen.
  disposer = effect(() => {
    // Touch both signals so the effect re-runs when either changes.
    const seed = subsectorSeed.value
    const density = subsectorDensity.value
    void seed
    void density
    void refresh()
  })
}

export function disposeSubsectorPipeline(): void {
  disposer?.()
  disposer = null
}
