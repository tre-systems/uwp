// One-shot GPU capability probe.
//
// The browser's WebGPU intentionally hides whether an adapter is discrete or
// integrated, so we infer capability from the adapter's reported ceilings: a
// capable desktop GPU (discrete, or Apple Silicon) reports a large texture and
// buffer limit and is not a software fallback. A weak integrated chip or a
// headless software renderer (SwiftShader/lavapipe) does not. Combined with the
// desktop render profile (HIGH), this is what gates the ULTRA tier — so it can
// only ever upgrade hardware that already looks like a real desktop GPU.

export interface GpuReport {
  capable: boolean
  vendor?: string
  architecture?: string
  isFallback: boolean
  maxTextureDimension2D: number
  maxBufferSize: number
}

// Minimal structural types so this file doesn't depend on @webgpu/types.
interface ProbeAdapterInfo {
  vendor?: string
  architecture?: string
}
interface ProbeAdapter {
  readonly isFallbackAdapter?: boolean
  readonly info?: ProbeAdapterInfo
  readonly limits?: { maxTextureDimension2D?: number; maxBufferSize?: number }
  requestAdapterInfo?: () => Promise<ProbeAdapterInfo>
}
interface ProbeGpu {
  requestAdapter(options?: { powerPreference?: string }): Promise<ProbeAdapter | null>
}

const FALLBACK: GpuReport = {
  capable: false,
  isFallback: true,
  maxTextureDimension2D: 0,
  maxBufferSize: 0,
}

let cached: Promise<GpuReport> | null = null

/** Probe the GPU once and cache the result for the session. */
export function probeGpu(): Promise<GpuReport> {
  if (!cached) cached = runProbe()
  return cached
}

async function runProbe(): Promise<GpuReport> {
  try {
    const gpu = (navigator as Navigator & { gpu?: ProbeGpu }).gpu
    if (!gpu) return FALLBACK
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) return FALLBACK
    const info = adapter.info ?? (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {})
    const isFallback = adapter.isFallbackAdapter === true
    const maxTextureDimension2D = adapter.limits?.maxTextureDimension2D ?? 0
    const maxBufferSize = Number(adapter.limits?.maxBufferSize ?? 0)
    const capable = !isFallback && maxTextureDimension2D >= 16384 && maxBufferSize >= 1_000_000_000
    return {
      capable,
      vendor: info.vendor,
      architecture: info.architecture,
      isFallback,
      maxTextureDimension2D,
      maxBufferSize,
    }
  } catch {
    return FALLBACK
  }
}
