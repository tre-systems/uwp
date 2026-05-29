export interface UwpDigits {
  starport: string  // A, B, C, D, E, X
  size: number      // continuous 0..10, rounded to 0..A in UWP output
  atm: number       // continuous 0..15, rounded to 0..F in UWP output
  hydro: number     // continuous 0..10, rounded to 0..A in UWP output
  pop: number       // continuous 0..10, rounded to 0..A in UWP output
  gov: number       // continuous 0..15, rounded to 0..F in UWP output
  law: number       // continuous 0..15, rounded to 0..F in UWP output
  tech: number      // continuous 0..15, rounded to 0..F in UWP output
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
  const digit = Math.max(0, Math.min(15, Math.round(n)))
  if (digit < 10) return String(digit)
  return String.fromCharCode('A'.charCodeAt(0) + digit - 10)
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

export function reconcileUwpDigits(u: UwpDigits): UwpDigits {
  const size = finiteClamp(u.size, 0, 10)
  const pop = finiteClamp(u.pop, 0, 10)
  const gov = pop <= 0 ? 0 : finiteClamp(u.gov, 0, 15)
  return {
    starport: isStarport(u.starport) ? u.starport : 'X',
    size,
    atm: size <= 0 ? 0 : finiteClamp(u.atm, 0, 15),
    hydro: size <= 1 ? 0 : finiteClamp(u.hydro, 0, 10),
    pop,
    gov,
    law: gov <= 0 ? 0 : finiteClamp(u.law, 0, 15),
    tech: pop <= 0 ? 0 : finiteClamp(u.tech, 0, 15),
  }
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

  return reconcileUwpDigits({
    starport,
    size: Math.min(digits[0], 10),
    atm: digits[1],
    hydro: Math.min(digits[2], 10),
    pop: Math.min(digits[3], 10),
    gov: digits[4],
    law: digits[5],
    tech: Math.min(tech, 15),
  })
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
    pop: rint(0, 10),
    gov: rint(0, 15),
    law: rint(0, 15),
    tech: rint(0, 15),
  }
}

function finiteClamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

// --- Extended hex ("ehex") + strict UWP parsing -------------------------
//
// Imported survey data uses the full extended-hex alphabet (0-9 then A-Z
// with I and O skipped, encoding values 0-33) so codes like high tech levels
// or populations round-trip. The lenient `parseUwpDigits` above is for live
// panel editing and only understands 0-F; import and canonical export route
// through the strict helpers here instead.

const EHEX_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/** Decode a single ehex character to its 0-33 value, or -1 if invalid. */
export function ehexToInt(ch: string): number {
  return ch.length === 1 ? EHEX_ALPHABET.indexOf(ch.toUpperCase()) : -1
}

/** Encode a value (0-33) to its ehex character, clamped into the alphabet. */
export function intToEhex(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const v = Math.max(0, Math.min(EHEX_ALPHABET.length - 1, Math.round(value)))
  return EHEX_ALPHABET[v]
}

/** A fully-decoded UWP (ehex digits resolved to numbers). */
export interface UwpFields {
  starport: string
  size: number
  atm: number
  hydro: number
  pop: number
  gov: number
  law: number
  tech: number
}

// Starport A-E (primary) / F-H, Y (secondary) / X (none) / ? (unknown);
// six ehex body digits; a hyphen; one ehex tech digit. '?' is allowed in any
// digit slot for partially-surveyed worlds.
const EHEX_DIGIT = '[0-9A-HJ-NP-Z?]'
const D = `(${EHEX_DIGIT})`
const STRICT_UWP_RE = new RegExp(`^([A-HXY?])${D}${D}${D}${D}${D}${D}-${D}$`)

/**
 * Strict full-UWP parser for imported survey data. Decodes the complete ehex
 * range (0-33), unlike the lenient editor-facing `parseUwpDigits` (hex 0-F).
 * An unknown digit '?' decodes to 0; malformed input returns null.
 */
export function parseUwpStrict(code: string): UwpFields | null {
  const m = STRICT_UWP_RE.exec(code.trim().toUpperCase())
  if (!m) return null
  const d = (ch: string): number => (ch === '?' ? 0 : ehexToInt(ch))
  return {
    starport: m[1],
    size: d(m[2]),
    atm: d(m[3]),
    hydro: d(m[4]),
    pop: d(m[5]),
    gov: d(m[6]),
    law: d(m[7]),
    tech: d(m[8]),
  }
}
