import init from '../pkg/planet_render'

let wasmReady: Promise<void> | null = null

export function ensureWasmReady(): Promise<void> {
  if (!wasmReady) {
    wasmReady = init().then(() => undefined)
  }
  return wasmReady
}
