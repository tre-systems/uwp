import { describe, expect, it } from 'vitest'
import {
  decodeOverridesPayload,
  encodeOverridesPayload,
  filterOverridesForSeed,
} from './urlOverrides'

describe('urlOverrides', () => {
  it('round-trips hex and route overrides for one subsector seed', () => {
    const payload = filterOverridesForSeed(99, {
      '99:1610': { travel_zone: 'Red', allegiance: 'Na' },
      '42:0101': { travel_zone: 'Amber' },
    }, {
      '99:1610-1701': { visible: false, trade: true },
    })
    const encoded = encodeOverridesPayload(payload)
    expect(encoded).toBeTruthy()
    const decoded = decodeOverridesPayload(encoded!)
    expect(decoded?.h).toEqual({
      '99:1610': { travel_zone: 'Red', allegiance: 'Na' },
    })
    expect(decoded?.r).toEqual({
      '99:1610-1701': { visible: false, trade: true },
    })
  })

  it('returns null when there is nothing to encode', () => {
    expect(encodeOverridesPayload({ h: {}, r: {} })).toBeNull()
  })
})
