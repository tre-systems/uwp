import { parseUwpDigits, type UwpDigits } from '../../uwp'

export type TradeCode =
  | 'Ag'
  | 'As'
  | 'Ba'
  | 'De'
  | 'Fl'
  | 'Ga'
  | 'Hi'
  | 'Ht'
  | 'Ic'
  | 'In'
  | 'Lo'
  | 'Lt'
  | 'Na'
  | 'Ni'
  | 'Po'
  | 'Ri'
  | 'Va'
  | 'Wa'

export type UwpTradeCodeDigits = Pick<
  UwpDigits,
  'size' | 'atm' | 'hydro' | 'pop' | 'gov' | 'law' | 'tech'
>

export interface TradeCodeDefinition {
  code: TradeCode
  name: string
}

interface TradeCodeRule extends TradeCodeDefinition {
  matches: (uwp: UwpTradeCodeDigits) => boolean
}

const TRADE_CODE_RULES: readonly TradeCodeRule[] = [
  {
    code: 'Ag',
    name: 'Agricultural',
    matches: ({ atm, hydro, pop }) => inRange(atm, 4, 9) && inRange(hydro, 4, 8) && inRange(pop, 5, 7),
  },
  {
    code: 'As',
    name: 'Asteroid',
    matches: ({ size, atm, hydro }) => size === 0 && atm === 0 && hydro === 0,
  },
  {
    code: 'Ba',
    name: 'Barren',
    matches: ({ pop, gov, law }) => pop === 0 && gov === 0 && law === 0,
  },
  {
    code: 'De',
    name: 'Desert',
    matches: ({ atm, hydro }) => atm >= 2 && hydro === 0,
  },
  {
    code: 'Fl',
    name: 'Fluid Oceans',
    matches: ({ atm, hydro }) => atm >= 10 && hydro >= 1,
  },
  {
    code: 'Ga',
    name: 'Garden',
    matches: ({ atm, hydro, pop }) =>
      [5, 6, 8].includes(atm) && inRange(hydro, 4, 9) && inRange(pop, 4, 8),
  },
  {
    code: 'Hi',
    name: 'High Population',
    matches: ({ pop }) => pop >= 9,
  },
  {
    code: 'Ht',
    name: 'High Technology',
    matches: ({ tech }) => tech >= 12,
  },
  {
    code: 'Ic',
    name: 'Ice-Capped',
    matches: ({ atm, hydro }) => inRange(atm, 0, 1) && hydro >= 1,
  },
  {
    code: 'In',
    name: 'Industrial',
    matches: ({ atm, pop }) => [0, 1, 2, 4, 7, 9].includes(atm) && pop >= 9,
  },
  {
    code: 'Lo',
    name: 'Low Population',
    matches: ({ pop }) => inRange(pop, 1, 3),
  },
  {
    code: 'Lt',
    name: 'Low Technology',
    matches: ({ tech }) => tech <= 5,
  },
  {
    code: 'Na',
    name: 'Non-Agricultural',
    matches: ({ atm, hydro, pop }) => inRange(atm, 0, 3) && inRange(hydro, 0, 3) && pop >= 6,
  },
  {
    code: 'Ni',
    name: 'Non-Industrial',
    matches: ({ pop }) => inRange(pop, 4, 6),
  },
  {
    code: 'Po',
    name: 'Poor',
    matches: ({ atm, hydro }) => inRange(atm, 2, 5) && inRange(hydro, 0, 3),
  },
  {
    code: 'Ri',
    name: 'Rich',
    matches: ({ atm, pop }) => [6, 8].includes(atm) && inRange(pop, 6, 8),
  },
  {
    code: 'Va',
    name: 'Vacuum',
    matches: ({ atm }) => atm === 0,
  },
  {
    code: 'Wa',
    name: 'Water World',
    matches: ({ hydro }) => hydro === 10,
  },
]

export const TRADE_CODE_DEFINITIONS: readonly TradeCodeDefinition[] = TRADE_CODE_RULES.map(
  ({ code, name }) => ({ code, name }),
)

export function deriveTradeCodes(uwp: UwpTradeCodeDigits): TradeCode[] {
  return TRADE_CODE_RULES.filter((rule) => rule.matches(uwp)).map((rule) => rule.code)
}

export function deriveTradeCodesFromUwpCode(code: string): TradeCode[] | null {
  const uwp = parseUwpDigits(code)
  return uwp ? deriveTradeCodes(uwp) : null
}

export function tradeCodeName(code: TradeCode): string {
  return TRADE_CODE_RULES.find((rule) => rule.code === code)?.name ?? code
}

function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max
}
