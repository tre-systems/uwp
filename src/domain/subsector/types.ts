// Mirrors the Rust `domain::subsector` serde shape. Field names and casing
// must match the Rust struct so `serde_wasm_bindgen::to_value` round-trips
// straight into these interfaces.

export interface HexCoord {
  col: number
  row: number
}

export interface Bases {
  naval: boolean
  scout: boolean
  research: boolean
  Aid: boolean
}

export type TravelZone = 'Green' | 'Amber' | 'Red'

export interface SubsectorUwp {
  starport: string  // 'A' | 'B' | 'C' | 'D' | 'E' | 'X'
  size: number
  atm: number
  hydro: number
  pop: number
  gov: number
  law: number
  tech: number
}

export interface Pbg {
  population_multiplier: number
  belts: number
  gas_giants: number
}

export interface SubsectorHex {
  coord: HexCoord
  system_seed: number
  uwp: SubsectorUwp
  bases: Bases
  travel_zone: TravelZone
  gas_giant: boolean
  belts: boolean
  population: number
  pbg: Pbg
  name: string | null
}

export interface JumpRoute {
  from: HexCoord
  to: HexCoord
  jump: 1 | 2
  communication: boolean
  trade: boolean
  trade_score: number
}

export interface Subsector {
  seed: number
  density: number
  columns: number
  rows: number
  allegiance: string
  hexes: SubsectorHex[]
  jump_routes: JumpRoute[]
}

export function subsectorHexCount(subsector: Pick<Subsector, 'columns' | 'rows'>): number {
  return subsector.columns * subsector.rows
}

export function hexLabel(coord: HexCoord): string {
  return `${coord.col.toString().padStart(2, '0')}${coord.row.toString().padStart(2, '0')}`
}

export function routesForHex(subsector: Subsector, coord: HexCoord): JumpRoute[] {
  return subsector.jump_routes.filter((route) =>
    sameHex(route.from, coord) || sameHex(route.to, coord),
  )
}

export function routeNeighbor(route: JumpRoute, coord: HexCoord): HexCoord {
  return sameHex(route.from, coord) ? route.to : route.from
}

function sameHex(a: HexCoord, b: HexCoord): boolean {
  return a.col === b.col && a.row === b.row
}

// Cepheus pseudo-hex digit rendering: 0-9 then A-F for 10-15.
export function uwpDigitChar(value: number): string {
  if (value < 10) return String(value)
  return String.fromCharCode('A'.charCodeAt(0) + value - 10)
}

export function uwpToCode(u: SubsectorUwp): string {
  const d = uwpDigitChar
  return `${u.starport}${d(u.size)}${d(u.atm)}${d(u.hydro)}${d(u.pop)}${d(u.gov)}${d(u.law)}-${d(u.tech)}`
}
