import { describe, expect, it } from 'vitest'
import {
  canvasPixelSize,
  createFrameTimeDownshiftState,
  detectRenderProfile,
  nextRenderProfileForFrameTime,
  renderProfileByName,
  shouldThrottleRenderProfile,
} from './renderProfile'

describe('detectRenderProfile', () => {
  it('keeps ordinary desktop-class devices on high quality', () => {
    expect(detectRenderProfile({
      width: 1440,
      height: 900,
      devicePixelRatio: 2,
      hardwareConcurrency: 10,
      deviceMemory: 8,
      maxTouchPoints: 0,
      coarsePointer: false,
      userAgent: 'Mozilla/5.0 Macintosh',
    }).name).toBe('high')
  })

  it('drops iPhone-class devices to the minimum profile', () => {
    expect(detectRenderProfile({
      width: 393,
      height: 852,
      devicePixelRatio: 3,
      hardwareConcurrency: 4,
      maxTouchPoints: 5,
      coarsePointer: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    }).name).toBe('minimum')
  })

  it('uses the balanced profile for larger touch tablets', () => {
    expect(detectRenderProfile({
      width: 1024,
      height: 1366,
      devicePixelRatio: 2,
      hardwareConcurrency: 8,
      maxTouchPoints: 5,
      coarsePointer: true,
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)',
    }).name).toBe('balanced')
  })

  it('keeps privacy-capped high-end iPads out of the visibly chunky low profile', () => {
    expect(detectRenderProfile({
      width: 1024,
      height: 1366,
      devicePixelRatio: 3,
      hardwareConcurrency: 4,
      maxTouchPoints: 5,
      coarsePointer: true,
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)',
    }).name).toBe('balanced')
  })

  it('can still protect genuinely constrained large tablets', () => {
    expect(detectRenderProfile({
      width: 800,
      height: 1280,
      devicePixelRatio: 2,
      hardwareConcurrency: 2,
      deviceMemory: 3,
      maxTouchPoints: 5,
      coarsePointer: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Tablet)',
    }).name).toBe('low')
  })
})

describe('canvasPixelSize', () => {
  it('caps minimum-profile iPhone pixels close to CSS resolution', () => {
    const profile = detectRenderProfile({
      width: 393,
      height: 852,
      devicePixelRatio: 3,
      hardwareConcurrency: 4,
      maxTouchPoints: 5,
      coarsePointer: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    })

    expect(canvasPixelSize(393, 852, profile, 3)).toEqual({
      width: 393,
      height: 852,
    })
  })

  it('keeps low-profile tablet fallback near CSS resolution instead of heavily upscaling', () => {
    const profile = renderProfileByName('low')

    expect(canvasPixelSize(1280, 884, profile, 2)).toEqual({
      width: 1203,
      height: 831,
    })
  })

  it('preserves desktop DPR when under the high-profile pixel cap', () => {
    const profile = detectRenderProfile({
      width: 1280,
      height: 720,
      devicePixelRatio: 2,
      hardwareConcurrency: 10,
      deviceMemory: 8,
      maxTouchPoints: 0,
      coarsePointer: false,
      userAgent: 'Mozilla/5.0 Macintosh',
    })

    expect(canvasPixelSize(1280, 720, profile, 2)).toEqual({
      width: 2560,
      height: 1440,
    })
  })
})

describe('render profile frame pacing', () => {
  it('keeps balanced quality at the browser refresh cadence', () => {
    expect(renderProfileByName('balanced').targetFps).toBe(60)
    expect(shouldThrottleRenderProfile(renderProfileByName('balanced'))).toBe(false)
  })

  it('throttles the low and minimum profiles to their reduced frame cadence', () => {
    expect(renderProfileByName('low').targetFps).toBe(30)
    expect(shouldThrottleRenderProfile(renderProfileByName('low'))).toBe(true)
    expect(renderProfileByName('minimum').targetFps).toBe(30)
    expect(shouldThrottleRenderProfile(renderProfileByName('minimum'))).toBe(true)
  })
})

describe('nextRenderProfileForFrameTime', () => {
  it('waits through the warmup window before counting slow frames', () => {
    const initial = createFrameTimeDownshiftState(renderProfileByName('high'))
    const result = nextRenderProfileForFrameTime(initial, 60, {
      warmupFrames: 2,
      consecutiveSlowFrames: 1,
    })

    expect(result.changed).toBe(false)
    expect(result.state.profile.name).toBe('high')
    expect(result.state.observedFrames).toBe(1)
    expect(result.state.slowFrames).toBe(0)
  })

  it('downshifts after sustained slow frames', () => {
    let state = createFrameTimeDownshiftState(renderProfileByName('high'))

    let result = nextRenderProfileForFrameTime(state, 60, {
      warmupFrames: 0,
      consecutiveSlowFrames: 2,
    })
    expect(result.changed).toBe(false)
    state = result.state

    result = nextRenderProfileForFrameTime(state, 60, {
      warmupFrames: 0,
      consecutiveSlowFrames: 2,
    })

    expect(result.changed).toBe(true)
    expect(result.state.profile.name).toBe('balanced')
    expect(result.state.observedFrames).toBe(0)
    expect(result.state.slowFrames).toBe(0)
  })

  it('resets slow-frame pressure after a recovered frame', () => {
    let state = createFrameTimeDownshiftState(renderProfileByName('high'))

    let result = nextRenderProfileForFrameTime(state, 60, {
      warmupFrames: 0,
      consecutiveSlowFrames: 2,
    })
    state = result.state

    result = nextRenderProfileForFrameTime(state, 16, {
      warmupFrames: 0,
      consecutiveSlowFrames: 2,
    })

    expect(result.changed).toBe(false)
    expect(result.state.profile.name).toBe('high')
    expect(result.state.slowFrames).toBe(0)
  })

  it('can step a balanced profile down to low', () => {
    let state = createFrameTimeDownshiftState(renderProfileByName('balanced'))

    let result = nextRenderProfileForFrameTime(state, 80, {
      warmupFrames: 0,
      consecutiveSlowFrames: 2,
    })
    state = result.state

    result = nextRenderProfileForFrameTime(state, 80, {
      warmupFrames: 0,
      consecutiveSlowFrames: 2,
    })

    expect(result.changed).toBe(true)
    expect(result.state.profile.name).toBe('low')
  })

  it('can step a low profile down to minimum', () => {
    const initial = createFrameTimeDownshiftState(renderProfileByName('low'))
    const result = nextRenderProfileForFrameTime(initial, 120, {
      warmupFrames: 0,
      consecutiveSlowFrames: 1,
    })

    expect(result.changed).toBe(true)
    expect(result.state.profile.name).toBe('minimum')
  })

  it('does not downshift below the minimum profile', () => {
    const initial = createFrameTimeDownshiftState(renderProfileByName('minimum'))
    const result = nextRenderProfileForFrameTime(initial, 120, {
      warmupFrames: 0,
      consecutiveSlowFrames: 1,
    })

    expect(result.changed).toBe(false)
    expect(result.state.profile.name).toBe('minimum')
  })
})
