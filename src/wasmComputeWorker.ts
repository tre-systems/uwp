/// <reference lib="webworker" />
import init, {
  createSubsectorBuilder,
  finishSubsectorBuilder,
  generateSurfaceMapFromPlanet,
  generateSurfacePrebakeFull,
  stepSubsectorBuilder,
} from '../pkg/planet_render'
import type { Subsector } from './domain/subsector'
import type { SurfaceMap } from './domain/surfaceMap'
import type { Planet } from './domain/system'

type WorkerRequest =
  | {
      id: number
      kind: 'subsector'
      seed: number
      density: number
      cellsPerStep: number
    }
  | {
      id: number
      kind: 'surfacePrebakeFull'
      seed: number
      waterFraction: number
      iceLatitude: number
      meanTempK: number
      vegetationRichness: number
    }
  | {
      id: number
      kind: 'surfaceMap'
      planet: Planet
      seed: number
      seaLevel: number
      iceLatitude: number
      vegetationRichness: number
      populationIntensity: number
    }

type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }

let wasmBoot: Promise<void> | null = null

function ensureWasm(): Promise<void> {
  if (!wasmBoot) {
    wasmBoot = init().then(() => undefined)
  }
  return wasmBoot
}

async function runSubsector(
  seed: number,
  density: number,
  cellsPerStep: number,
): Promise<Subsector> {
  const builder = createSubsectorBuilder(seed >>> 0, density)
  const step = Math.max(1, cellsPerStep | 0)
  while (!stepSubsectorBuilder(builder, step)) {
    // keep stepping until the grid scan completes
  }
  return finishSubsectorBuilder(builder) as Subsector
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data
  void (async () => {
    try {
      await ensureWasm()
      let result: unknown
      switch (msg.kind) {
        case 'subsector':
          result = await runSubsector(msg.seed, msg.density, msg.cellsPerStep)
          break
        case 'surfacePrebakeFull':
          result = generateSurfacePrebakeFull(
            msg.seed >>> 0,
            msg.waterFraction,
            msg.iceLatitude,
            msg.meanTempK,
            msg.vegetationRichness,
          )
          break
        case 'surfaceMap':
          result = generateSurfaceMapFromPlanet(
            msg.planet,
            msg.seed >>> 0,
            msg.seaLevel,
            msg.iceLatitude,
            msg.vegetationRichness,
            msg.populationIntensity,
          ) as SurfaceMap
          break
        default:
          throw new Error('unknown worker job')
      }
      const reply: WorkerResponse = { id: msg.id, ok: true, result }
      self.postMessage(reply)
    } catch (err) {
      const reply: WorkerResponse = {
        id: msg.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
      self.postMessage(reply)
    }
  })()
}
