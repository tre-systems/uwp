import { describe, expect, it } from 'vitest'
import { decodeDetailBody, encodeDetailBody } from './urlState'

describe('urlState detail body encoding', () => {
  it('round-trips planet, star, and belt targets', () => {
    expect(encodeDetailBody({ kind: 'planet', index: 2 })).toBe('p2')
    expect(decodeDetailBody('p2')).toEqual({ kind: 'planet', index: 2 })
    expect(decodeDetailBody('star')).toEqual({ kind: 'star', index: 0 })
    expect(decodeDetailBody('companion')).toEqual({ kind: 'star', index: 1 })
    expect(decodeDetailBody('belt0')).toEqual({ kind: 'belt', index: 0 })
  })

  it('rejects unknown body tokens', () => {
    expect(decodeDetailBody('moon')).toBeNull()
    expect(encodeDetailBody(null)).toBeNull()
  })
})
