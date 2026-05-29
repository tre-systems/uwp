import { describe, expect, it } from 'vitest'
import {
  ehexToInt,
  intToEhex,
  parseUwp,
  parseUwpDigits,
  parseUwpStrict,
  reconcileUwpDigits,
  uwpHex,
  uwpToCode,
} from './uwp'

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

describe('extended hex (ehex)', () => {
  it('decodes 0-9, A-H, J-N, P-Z to 0-33 and skips I/O', () => {
    expect(ehexToInt('0')).toBe(0)
    expect(ehexToInt('9')).toBe(9)
    expect(ehexToInt('A')).toBe(10)
    expect(ehexToInt('F')).toBe(15)
    expect(ehexToInt('G')).toBe(16)
    expect(ehexToInt('H')).toBe(17)
    expect(ehexToInt('J')).toBe(18) // I is skipped
    expect(ehexToInt('N')).toBe(22)
    expect(ehexToInt('P')).toBe(23) // O is skipped
    expect(ehexToInt('Z')).toBe(33)
    expect(ehexToInt('I')).toBe(-1)
    expect(ehexToInt('O')).toBe(-1)
    expect(ehexToInt('')).toBe(-1)
    expect(ehexToInt('AB')).toBe(-1)
  })

  it('round-trips every value through intToEhex/ehexToInt', () => {
    for (let v = 0; v <= 33; v++) {
      expect(ehexToInt(intToEhex(v))).toBe(v)
    }
    expect(intToEhex(15)).toBe('F')
    expect(intToEhex(16)).toBe('G')
    expect(intToEhex(18)).toBe('J') // not "I"
    expect(intToEhex(23)).toBe('P') // not "O"
    expect(intToEhex(34)).toBe('Z') // clamp
    expect(intToEhex(-1)).toBe('0')
    expect(intToEhex(Number.NaN)).toBe('0')
  })
})

describe('parseUwpStrict', () => {
  it('parses a standard UWP into decoded fields', () => {
    expect(parseUwpStrict('A867974-D')).toEqual({
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

  it('decodes the full ehex range (values above 15)', () => {
    expect(parseUwpStrict('BG8A9C9-H')).toEqual({
      starport: 'B',
      size: 16, // G
      atm: 8,
      hydro: 10, // A
      pop: 9,
      gov: 12, // C
      law: 9,
      tech: 17, // H
    })
  })

  it('treats unknown "?" digits as 0 and keeps a "?" starport', () => {
    expect(parseUwpStrict('?A?0000-0')).toEqual({
      starport: '?',
      size: 10,
      atm: 0,
      hydro: 0,
      pop: 0,
      gov: 0,
      law: 0,
      tech: 0,
    })
  })

  it('rejects malformed codes and the skipped I/O letters', () => {
    expect(parseUwpStrict('AI67974-D')).toBeNull() // I is not an ehex digit
    expect(parseUwpStrict('AO67974-D')).toBeNull() // O is not an ehex digit
    expect(parseUwpStrict('Z867974-D')).toBeNull() // Z is not a starport class
    expect(parseUwpStrict('A867974D')).toBeNull() // missing hyphen
    expect(parseUwpStrict('A86797-D')).toBeNull() // too few body digits
    expect(parseUwpStrict('A867974-DD')).toBeNull() // tech too long
  })
})
