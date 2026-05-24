import { describe, expect, it } from 'vitest'
import { hexName, systemName } from './names'

describe('name generator', () => {
  it('is deterministic for the same seed', () => {
    expect(systemName(1234)).toBe(systemName(1234))
    expect(systemName(0)).toBe(systemName(0))
    expect(systemName(0xffffffff)).toBe(systemName(0xffffffff))
  })

  it('produces distinct names for nearby seeds', () => {
    const a = systemName(1)
    const b = systemName(2)
    const c = systemName(3)
    // splitmix32 should scatter; if all three collide, our RNG is broken.
    const distinct = new Set([a, b, c])
    expect(distinct.size).toBeGreaterThanOrEqual(2)
  })

  it('starts with an uppercase letter', () => {
    for (let i = 0; i < 32; i++) {
      const name = systemName(i * 17 + 1)
      expect(name[0]).toBe(name[0].toUpperCase())
    }
  })

  it('hexName combines parent seed with coords', () => {
    const a = hexName(1, 3, 4)
    const b = hexName(1, 4, 3)
    // Different cells should usually produce different names.
    // (Hash collisions are possible but vanishingly unlikely for this small a test.)
    expect(a).not.toBe(b)
  })

  it('stays within a reasonable length', () => {
    for (let i = 0; i < 64; i++) {
      const name = systemName(i)
      expect(name.length).toBeGreaterThan(2)
      expect(name.length).toBeLessThanOrEqual(24)
    }
  })
})
