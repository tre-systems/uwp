export interface UwpDigits {
  starport: string  // A, B, C, D, E, X
  size: number      // 0..10 (A)
  atm: number       // 0..15 (F)
  hydro: number     // 0..10 (A)
  pop: number       // 0..12 (C)
  gov: number       // 0..15 (F)
  law: number       // 0..15 (F)
  tech: number      // 0..15 (F)
}

export const defaultUwp: UwpDigits = {
  starport: 'A',
  size: 8,
  atm: 6,
  hydro: 7,
  pop: 9,
  gov: 7,
  law: 4,
  tech: 13,
}

const STARPORTS = ['A', 'B', 'C', 'D', 'E', 'X'] as const
export const STARPORT_OPTIONS = STARPORTS
type Starport = (typeof STARPORTS)[number]

function isStarport(c: string): c is Starport {
  return STARPORTS.includes(c as Starport)
}

function hexValue(c: string): number {
  if (!/^[0-9A-F]$/.test(c)) return -1
  return parseInt(c, 16)
}

export function uwpHex(n: number): string {
  if (n < 10) return String(n)
  return String.fromCharCode('A'.charCodeAt(0) + n - 10)
}

export function uwpToCode(u: UwpDigits): string {
  return (
    u.starport +
    uwpHex(u.size) +
    uwpHex(u.atm) +
    uwpHex(u.hydro) +
    uwpHex(u.pop) +
    uwpHex(u.gov) +
    uwpHex(u.law) +
    '-' +
    uwpHex(u.tech)
  )
}

// Parse a full UWP into digit state. Pads short bodies with zeros so live
// editing can accept partial-but-meaningful codes such as "B" or "A86".
export function parseUwpDigits(code: string): UwpDigits | null {
  const cleaned = code.toUpperCase().replace(/\s+/g, '')
  const parts = cleaned.split('-')
  if (parts.length > 2) return null
  const [main, techPart] = parts
  if (!main || main.length < 1) return null

  let starport: string = 'A'
  let body = main
  // Prefer starport semantics for A-E/X when live editing; numeric body-only
  // codes still work for the no-starport shorthand.
  if (isStarport(main[0])) {
    starport = main[0]
    body = main.slice(1)
  }
  if (body.length > 6) return null

  body = (body + '000000').slice(0, 6)
  const digits = [...body].map(hexValue)
  if (digits.some((d) => d < 0)) return null

  const tech = techPart && techPart.length > 0 ? hexValue(techPart) : 0
  if ((techPart && techPart.length > 1) || tech < 0) return null

  return {
    starport,
    size: Math.min(digits[0], 10),
    atm: digits[1],
    hydro: Math.min(digits[2], 10),
    pop: Math.min(digits[3], 12),
    gov: digits[4],
    law: digits[5],
    tech: Math.min(tech, 15),
  }
}

export interface UwpVisualExt {
  size: number
  atm: number
  hydro: number
  pop: number
}

export function parseUwp(code: string): UwpVisualExt | null {
  const parsed = parseUwpDigits(code)
  if (!parsed) return null
  return {
    size: parsed.size,
    atm: parsed.atm,
    hydro: parsed.hydro,
    pop: parsed.pop,
  }
}

export function randomUwpDigits(random: () => number = Math.random): UwpDigits {
  const rint = (min: number, max: number) => min + Math.floor(random() * (max - min + 1))
  return {
    starport: STARPORTS[rint(0, 4)],  // Avoid X most of the time.
    size: rint(2, 10),
    atm: rint(0, 15),
    hydro: rint(0, 10),
    pop: rint(0, 12),
    gov: rint(0, 15),
    law: rint(0, 15),
    tech: rint(0, 15),
  }
}
