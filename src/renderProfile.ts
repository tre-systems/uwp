export type RenderProfileName = 'high' | 'balanced' | 'low'

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
  targetFps: 45,
  shaderQuality: 0.68,
  meshQuality: 0.72,
}

const LOW: RenderProfile = {
  name: 'low',
  dprCap: 1,
  maxPixels: 700_000,
  targetFps: 30,
  shaderQuality: 0.35,
  meshQuality: 0.45,
}

export function detectRenderProfile(hints = browserRenderHints()): RenderProfile {
  const minSide = Math.min(hints.width, hints.height)
  const touch = (hints.maxTouchPoints ?? 0) > 0 || hints.coarsePointer === true
  const ua = hints.userAgent ?? ''
  const isiPhone = /iPhone|iPod/i.test(ua)
  const isiPad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && (hints.maxTouchPoints ?? 0) > 1)

  let pressure = 0
  if (isiPhone) pressure += 4
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

  if (pressure >= 4) return LOW
  if (pressure >= 2) return BALANCED
  return HIGH
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
