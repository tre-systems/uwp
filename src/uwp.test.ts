import { describe, expect, it } from 'vitest'
import { parseUwp, parseUwpDigits, reconcileUwpDigits, uwpHex, uwpToCode } from './uwp'

describe('parseUwpDigits', () => {
  it('parses a complete UWP code into editable digit state', () => {
    expect(parseUwpDigits('A867974-D')).toEqual({
      starport: 'A',
      size: 8,
      atm: 6,
      hydro: 7,
      pop: 9,
      gov: 7,
      law: 4,
      tech: 13,
    })
  })

  it('supports live starport-only editing', () => {
    expect(parseUwpDigits('B')).toEqual({
      starport: 'B',
      size: 0,
      atm: 0,
      hydro: 0,
      pop: 0,
      gov: 0,
      law: 0,
      tech: 0,
    })
  })

  it('accepts body-only codes with the default starport', () => {
    expect(uwpToCode(parseUwpDigits('867974-D')!)).toBe('A867974-D')
  })

  it('rejects invalid body and tech digits', () => {
    expect(parseUwpDigits('??')).toBeNull()
    expect(parseUwpDigits('Z867974-D')).toBeNull()
    expect(parseUwpDigits('A867974X-D')).toBeNull()
    expect(parseUwpDigits('A867974-?')).toBeNull()
    expect(parseUwpDigits('A867974-DD')).toBeNull()
  })

  it('clamps fields that have UWP table maxima below F', () => {
    expect(parseUwpDigits('AFACF0-F')).toMatchObject({
      size: 10,
      atm: 10,
      hydro: 10,
      pop: 10,
      tech: 15,
    })
  })

  it('reconciles physically impossible referee-entered UWP digits', () => {
    expect(parseUwpDigits('A0AA999-F')).toMatchObject({
      size: 0,
      atm: 0,
      hydro: 0,
      pop: 9,
      gov: 9,
      law: 9,
      tech: 15,
    })

    expect(parseUwpDigits('A1A9999-F')).toMatchObject({
      size: 1,
      atm: 10,
      hydro: 0,
    })

    expect(reconcileUwpDigits({
      starport: 'Z',
      size: 8,
      atm: 12,
      hydro: Number.NEGATIVE_INFINITY,
      pop: 12,
      gov: 15,
      law: Number.NaN,
      tech: 15,
    })).toEqual({
      starport: 'X',
      size: 8,
      atm: 12,
      hydro: 0,
      pop: 10,
      gov: 15,
      law: 0,
      tech: 15,
    })
  })

  it('rounds continuous values when projecting to UWP code digits', () => {
    expect(uwpHex(8.49)).toBe('8')
    expect(uwpHex(8.5)).toBe('9')
    expect(uwpToCode({
      starport: 'A',
      size: 7.6,
      atm: 5.5,
      hydro: 6.8,
      pop: 8.5,
      gov: 7.1,
      law: 4.2,
      tech: 12.6,
    })).toBe('A867974-D')
  })
})

describe('parseUwp', () => {
  it('extracts the visual fields used by the renderer mapping', () => {
    expect(parseUwp('A867974-D')).toEqual({
      size: 8,
      atm: 6,
      hydro: 7,
      pop: 9,
    })
  })

  it('rejects invalid visual fields', () => {
    expect(parseUwp('AX67974-D')).toBeNull()
    expect(parseUwp('Z867974-D')).toBeNull()
  })
})
