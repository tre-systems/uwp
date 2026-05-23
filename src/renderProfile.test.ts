import { describe, expect, it } from 'vitest'
import { canvasPixelSize, detectRenderProfile } from './renderProfile'

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

  it('drops iPhone-class devices to the low profile', () => {
    expect(detectRenderProfile({
      width: 393,
      height: 852,
      devicePixelRatio: 3,
      hardwareConcurrency: 4,
      maxTouchPoints: 5,
      coarsePointer: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    }).name).toBe('low')
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
})

describe('canvasPixelSize', () => {
  it('caps low-profile iPhone pixels close to CSS resolution', () => {
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
