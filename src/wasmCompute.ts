import type { Subsector } from './domain/subsector'
import type { SurfaceMap } from './domain/surfaceMap'
import type { Planet } from './domain/system'
import type { SurfacePrebake } from './appState'

type Pending<T> = {
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

let worker: Worker | null = null
let nextJobId = 1
const pending = new Map<number, Pending<unknown>>()
let workerFailed = false

function supportsWorkers(): boolean {
  return typeof Worker !== 'undefined' && typeof window !== 'undefined'
}

function getWorker(): Worker | null {
  if (workerFailed || !supportsWorkers()) return null
  if (!worker) {
    worker = new Worker(new URL('./wasmComputeWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const msg = event.data
      const job = pending.get(msg.id)
      if (!job) return
      pending.delete(msg.id)
      if (msg.ok) job.resolve(msg.result)
      else job.reject(new Error(msg.error ?? 'wasm worker failed'))
    }
    worker.onerror = () => {
      workerFailed = true
      for (const job of pending.values()) {
        job.reject(new Error('wasm compute worker crashed'))
      }
      pending.clear()
    }
  }
  return worker
}

function runJob<T>(build: (id: number) => unknown): Promise<T> {
  const w = getWorker()
  if (!w) {
    return Promise.reject(new Error('wasm compute worker unavailable'))
  }
  const id = nextJobId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    w.postMessage(build(id))
  })
}

export function wasmComputeAvailable(): boolean {
  return supportsWorkers() && !workerFailed
}

export function generateSubsectorInWorker(
  seed: number,
  density: number,
  cellsPerStep = 4,
): Promise<Subsector> {
  return runJob<Subsector>((id) => ({
    id,
    kind: 'subsector',
    seed: seed >>> 0,
    density,
    cellsPerStep,
  }))
}

export function generateSurfacePrebakeFullInWorker(
  seed: number,
  waterFraction: number,
  iceLatitude: number,
  meanTempK: number,
  vegetationRichness: number,
): Promise<SurfacePrebake> {
  return runJob<SurfacePrebake>((id) => ({
    id,
    kind: 'surfacePrebakeFull',
    seed: seed >>> 0,
    waterFraction,
    iceLatitude,
    meanTempK,
    vegetationRichness,
  }))
}

export function generateSurfaceMapInWorker(
  planet: Planet,
  seed: number,
  seaLevel: number,
  iceLatitude: number,
  vegetationRichness: number,
  populationIntensity: number,
): Promise<SurfaceMap> {
  return runJob<SurfaceMap>((id) => ({
    id,
    kind: 'surfaceMap',
    planet,
    seed: seed >>> 0,
    seaLevel,
    iceLatitude,
    vegetationRichness,
    populationIntensity,
  }))
}

/** Reset worker failure flag (unit tests). */
export function resetWasmComputeForTests(): void {
  worker?.terminate()
  worker = null
  workerFailed = false
  pending.clear()
}
