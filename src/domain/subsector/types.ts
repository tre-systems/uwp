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
  allegiance: string
  gas_giant: boolean
  belts: boolean
  population: number
  pbg: Pbg
  name: string | null
}

export interface SubsectorHexOverride {
  system_seed?: number
  travel_zone?: TravelZone
  allegiance?: string
  bases?: Bases
}

export type SubsectorOverrides = Record<string, SubsectorHexOverride>

export interface Allegiance {
  code: string
  name: string
  capital: HexCoord
  color_index: number
}

export interface PolityBorder {
  coord: HexCoord
  edge: 0 | 1 | 2 | 3 | 4 | 5
  from: string
  to: string
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
  allegiances: Allegiance[]
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

export function subsectorOverrideKey(seed: number, coord: HexCoord): string {
  return `${seed >>> 0}:${hexLabel(coord)}`
}

export function applySubsectorOverrides(subsector: Subsector, overrides: SubsectorOverrides): Subsector {
  let changed = false
  const hexes = subsector.hexes.map((hex) => {
    const override = overrides[subsectorOverrideKey(subsector.seed, hex.coord)]
    if (!override) return hex
    if (override.system_seed != null && override.system_seed !== hex.system_seed) return hex
    changed = true
    return {
      ...hex,
      travel_zone: override.travel_zone ?? hex.travel_zone,
      allegiance: override.allegiance ?? hex.allegiance,
      bases: override.bases ? { ...override.bases } : hex.bases,
    }
  })
  if (!changed) return subsector
  return {
    ...subsector,
    allegiance: dominantAllegiance(hexes, subsector.allegiance),
    hexes,
  }
}

export function allegianceForCode(subsector: Subsector, code: string): Allegiance | null {
  return subsector.allegiances.find((allegiance) => allegiance.code === code) ?? null
}

export function allegianceCounts(subsector: Subsector): Array<{ allegiance: Allegiance | null; code: string; count: number }> {
  const counts = new Map<string, number>()
  for (const hex of subsector.hexes) {
    counts.set(hex.allegiance, (counts.get(hex.allegiance) ?? 0) + 1)
  }
  return [...counts]
    .map(([code, count]) => ({ code, count, allegiance: allegianceForCode(subsector, code) }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
}

export function polityBorders(subsector: Subsector): PolityBorder[] {
  const hexByCoord = new Map<string, SubsectorHex>()
  for (const hex of subsector.hexes) {
    hexByCoord.set(`${hex.coord.col},${hex.coord.row}`, hex)
  }
  const borders: PolityBorder[] = []
  for (const hex of subsector.hexes) {
    for (const candidate of forwardNeighborEdges(hex.coord)) {
      const neighbor = hexByCoord.get(`${candidate.coord.col},${candidate.coord.row}`)
      if (!neighbor || neighbor.allegiance === hex.allegiance) continue
      borders.push({
        coord: hex.coord,
        edge: candidate.edge,
        from: hex.allegiance,
        to: neighbor.allegiance,
      })
    }
  }
  return borders
}

function forwardNeighborEdges(coord: HexCoord): Array<{ coord: HexCoord; edge: 0 | 1 | 5 }> {
  const rightUpRow = coord.col % 2 === 0 ? coord.row : coord.row - 1
  const rightDownRow = coord.col % 2 === 0 ? coord.row + 1 : coord.row
  return [
    { coord: { col: coord.col, row: coord.row + 1 }, edge: 1 },
    { coord: { col: coord.col + 1, row: rightUpRow }, edge: 5 },
    { coord: { col: coord.col + 1, row: rightDownRow }, edge: 0 },
  ]
}

function dominantAllegiance(hexes: SubsectorHex[], fallback: string): string {
  const counts = new Map<string, number>()
  for (const hex of hexes) {
    counts.set(hex.allegiance, (counts.get(hex.allegiance) ?? 0) + 1)
  }
  let best = fallback
  let bestCount = -1
  for (const [code, count] of counts) {
    if (count > bestCount || (count === bestCount && code.localeCompare(best) < 0)) {
      best = code
      bestCount = count
    }
  }
  return best
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
