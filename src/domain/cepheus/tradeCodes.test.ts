import { describe, expect, it } from 'vitest'
import {
  deriveTradeCodes,
  deriveTradeCodesFromUwpCode,
  tradeCodeName,
  type UwpTradeCodeDigits,
} from './index'

function uwp(overrides: Partial<UwpTradeCodeDigits>): UwpTradeCodeDigits {
  return {
    size: 8,
    atm: 6,
    hydro: 7,
    pop: 6,
    gov: 0,
    law: 0,
    tech: 10,
    ...overrides,
  }
}

describe('deriveTradeCodes', () => {
  it('derives overlapping agricultural, garden, and non-industrial classifications', () => {
    expect(deriveTradeCodes(uwp({ atm: 5, hydro: 5, pop: 6 }))).toEqual(['Ag', 'Ga', 'Ni'])
  })

  it('derives exact asteroid, barren, vacuum, and low-tech classifications', () => {
    expect(
      deriveTradeCodes(
        uwp({
          size: 0,
          atm: 0,
          hydro: 0,
          pop: 0,
          gov: 0,
          law: 0,
          tech: 0,
        }),
      ),
    ).toEqual(['As', 'Ba', 'Lt', 'Va'])
  })

  it('applies desert, non-agricultural, poor, and low-tech boundary rules', () => {
    expect(deriveTradeCodes(uwp({ atm: 3, hydro: 0, pop: 6, tech: 5 }))).toEqual([
      'De',
      'Lt',
      'Na',
      'Ni',
      'Po',
    ])
  })

  it('recognizes high population, industrial, and high-tech worlds', () => {
    expect(deriveTradeCodes(uwp({ atm: 7, hydro: 2, pop: 9, tech: 12 }))).toEqual([
      'Hi',
      'Ht',
      'In',
    ])
  })

  it('recognizes fluid-ocean water worlds from parsed UWP strings', () => {
    expect(deriveTradeCodesFromUwpCode('CAAA96A-C')).toEqual(['Fl', 'Hi', 'Ht', 'Wa'])
  })

  it('returns null for invalid UWP strings', () => {
    expect(deriveTradeCodesFromUwpCode('ZAA996A-C')).toBeNull()
  })

  it('exposes game-facing trade code names', () => {
    expect(tradeCodeName('Ri')).toBe('Rich')
  })
})
