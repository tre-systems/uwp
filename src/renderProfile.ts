export type RenderProfileName = 'high' | 'balanced' | 'low' | 'minimum'

export interface RenderProfile {
  name: RenderProfileName
  dprCap: number
  maxPixels: number
  targetFps: number
  shaderQuality: number
  meshQuality: number
}

export interface RenderProfileHints {
  width: number
  height: number
  devicePixelRatio: number
  hardwareConcurrency?: number
  deviceMemory?: number
  maxTouchPoints?: number
  coarsePointer?: boolean
  userAgent?: string
}

export interface FrameTimeDownshiftState {
  profile: RenderProfile
  observedFrames: number
  slowFrames: number
}

export interface FrameTimeDownshiftOptions {
  warmupFrames?: number
  consecutiveSlowFrames?: number
  slowFrameBudgetMultiplier?: number
}

export interface FrameTimeDownshiftResult {
  state: FrameTimeDownshiftState
  changed: boolean
}

const HIGH: RenderProfile = {
  name: 'high',
  dprCap: 2,
  maxPixels: 3_700_000,
  targetFps: 60,
  shaderQuality: 1,
  meshQuality: 1,
}

const BALANCED: RenderProfile = {
  name: 'balanced',
  dprCap: 1.35,
  maxPixels: 1_600_000,
  targetFps: 60,
  shaderQuality: 0.68,
  meshQuality: 0.72,
}

const LOW: RenderProfile = {
  name: 'low',
  dprCap: 1,
  maxPixels: 1_000_000,
  targetFps: 30,
  shaderQuality: 0.55,
  // Keep geometry crisp even when pixels/shader work downshift.
  // Coarse mesh LOD creates visible rectangular patches when users zoom
  // into the globe on tablets, which is more objectionable than the
  // modest vertex cost saved by the old 0.45 setting. This tier targets
  // low-end tablets — phones use MINIMUM, which decouples the mesh budget.
  meshQuality: 1,
}

// Phone-class floor. The globe mesh is the dominant cost on a small DPR-1
// screen, so this tier cuts it hard (detail.rs maps meshQuality < 0.45 to a
// fixed 192-res cubesphere with no zoom-rebuild) while keeping relief normals
// (shaderQuality > 0.45) so continents still read in 3D. Also the target of
// the frame-time downshifter when LOW is still too slow.
const MINIMUM: RenderProfile = {
  name: 'minimum',
  dprCap: 1,
  maxPixels: 800_000,
  targetFps: 30,
  shaderQuality: 0.5,
  meshQuality: 0.4,
}

const PROFILES: Record<RenderProfileName, RenderProfile> = {
  high: HIGH,
  balanced: BALANCED,
  low: LOW,
  minimum: MINIMUM,
}

const DEFAULT_DOWNSHIFT_OPTIONS: Required<FrameTimeDownshiftOptions> = {
  warmupFrames: 30,
  consecutiveSlowFrames: 8,
  slowFrameBudgetMultiplier: 1.8,
}

export function detectRenderProfile(hints = browserRenderHints()): RenderProfile {
  const minSide = Math.min(hints.width, hints.height)
  const touch = (hints.maxTouchPoints ?? 0) > 0 || hints.coarsePointer === true
  const ua = hints.userAgent ?? ''
  const isiPhone = /iPhone|iPod/i.test(ua)
  const isiPad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && (hints.maxTouchPoints ?? 0) > 1)
  const largeTouchTablet = touch && !isiPhone && minSide >= 700

  if (largeTouchTablet) {
    let tabletPressure = 1
    // Safari can privacy-cap hardwareConcurrency on even high-end iPads,
    // so don't treat a reported 4-core tablet as phone-class hardware.
    if (hints.hardwareConcurrency !== undefined && hints.hardwareConcurrency <= 2) {
      tabletPressure += 2
    }
    if (hints.deviceMemory !== undefined) {
      if (hints.deviceMemory <= 3) tabletPressure += 3
      else if (hints.deviceMemory <= 4) tabletPressure += 1
    }
    return tabletPressure >= 4 ? LOW : BALANCED
  }

  let pressure = 0
  if (isiPhone) pressure += 5
  else if (isiPad) pressure += 2
  if (touch && minSide < 700) pressure += 2
  else if (touch) pressure += 1
  if (hints.devicePixelRatio >= 3) pressure += 1
  if (hints.hardwareConcurrency !== undefined) {
    if (hints.hardwareConcurrency <= 4) pressure += 2
    else if (hints.hardwareConcurrency <= 6) pressure += 1
  }
  if (hints.deviceMemory !== undefined) {
    if (hints.deviceMemory <= 3) pressure += 2
    else if (hints.deviceMemory <= 4) pressure += 1
  }

  if (pressure >= 5) return MINIMUM
  if (pressure >= 4) return LOW
  if (pressure >= 2) return BALANCED
  return HIGH
}

export function renderProfileByName(name: RenderProfileName): RenderProfile {
  return PROFILES[name]
}

export function shouldThrottleRenderProfile(profile: RenderProfile): boolean {
  return (profile.name === 'low' || profile.name === 'minimum') && profile.targetFps < 59
}

export function lowerRenderProfile(profile: RenderProfile): RenderProfile {
  if (profile.name === 'high') return BALANCED
  if (profile.name === 'balanced') return LOW
  if (profile.name === 'low') return MINIMUM
  return MINIMUM
}

export function createFrameTimeDownshiftState(profile: RenderProfile): FrameTimeDownshiftState {
  return {
    profile,
    observedFrames: 0,
    slowFrames: 0,
  }
}

export function nextRenderProfileForFrameTime(
  state: FrameTimeDownshiftState,
  frameTimeMs: number,
  options: FrameTimeDownshiftOptions = {},
): FrameTimeDownshiftResult {
  if (!Number.isFinite(frameTimeMs) || frameTimeMs <= 0 || state.profile.name === 'minimum') {
    return { state, changed: false }
  }

  const opts = { ...DEFAULT_DOWNSHIFT_OPTIONS, ...options }
  const observedFrames = state.observedFrames + 1
  if (observedFrames <= opts.warmupFrames) {
    return {
      state: { ...state, observedFrames, slowFrames: 0 },
      changed: false,
    }
  }

  const targetFrameMs = 1000 / state.profile.targetFps
  const slowFrameMs = targetFrameMs * opts.slowFrameBudgetMultiplier
  const slowFrames = frameTimeMs > slowFrameMs ? state.slowFrames + 1 : 0
  if (slowFrames < opts.consecutiveSlowFrames) {
    return {
      state: { ...state, observedFrames, slowFrames },
      changed: false,
    }
  }

  return {
    state: createFrameTimeDownshiftState(lowerRenderProfile(state.profile)),
    changed: true,
  }
}

export function canvasPixelSize(
  cssWidth: number,
  cssHeight: number,
  profile: RenderProfile,
  devicePixelRatio = browserRenderHints().devicePixelRatio,
) {
  const dpr = Math.min(devicePixelRatio || 1, profile.dprCap)
  let width = Math.max(1, Math.floor(cssWidth * dpr))
  let height = Math.max(1, Math.floor(cssHeight * dpr))
  const pixels = width * height
  if (pixels > profile.maxPixels) {
    const scale = Math.sqrt(profile.maxPixels / pixels)
    width = Math.max(1, Math.floor(width * scale))
    height = Math.max(1, Math.floor(height * scale))
  }
  return { width, height }
}

function browserRenderHints(): RenderProfileHints {
  const nav = navigator as Navigator & { deviceMemory?: number }
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: nav.deviceMemory,
    maxTouchPoints: nav.maxTouchPoints,
    coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    userAgent: nav.userAgent,
  }
}
