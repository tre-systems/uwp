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

export interface SubsectorRouteOverride {
  from_system_seed?: number
  to_system_seed?: number
  visible?: boolean
  communication?: boolean
  trade?: boolean
  trade_score?: number
}

export type SubsectorRouteOverrides = Record<string, SubsectorRouteOverride>

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

export interface PolityCell {
  coord: HexCoord
  allegiance: string
  frontier: boolean
  capital: boolean
}

export interface PolitySummary {
  allegiance: Allegiance
  count: number
  territory: number
  capitalHex: SubsectorHex | null
  capitalDistance: number | null
}

export interface JumpRoute {
  from: HexCoord
  to: HexCoord
  jump: 1 | 2
  communication: boolean
  trade: boolean
  trade_score: number
  /** Effective UI/export visibility. Rust omits this field; missing means visible. */
  visible?: boolean
}

export interface Subsector {
  seed: number
  density: number
  columns: number
  rows: number
  allegiance: string
  allegiances: Allegiance[]
  polity_cells?: PolityCell[]
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

export function routeOverrideKey(seed: number, from: HexCoord, to: HexCoord): string {
  const [a, b] = canonicalRouteEndpoints(from, to)
  return `${seed >>> 0}:${hexLabel(a)}-${hexLabel(b)}`
}

export function isRouteVisible(route: Pick<JumpRoute, 'visible'>): boolean {
  return route.visible !== false
}

export function visibleRoutes(subsector: Pick<Subsector, 'jump_routes'>): JumpRoute[] {
  return subsector.jump_routes.filter(isRouteVisible)
}

export function pbgCode(pbg: Pbg): string {
  return `${pbgDigit(pbg.population_multiplier)}${pbgDigit(pbg.belts)}${pbgDigit(pbg.gas_giants)}`
}

export function populationLabel(population: number): string {
  if (!Number.isFinite(population) || population <= 0) return '0'
  if (population >= 1_000_000_000) return `${trimNumber(population / 1_000_000_000)}B`
  if (population >= 1_000_000) return `${trimNumber(population / 1_000_000)}M`
  if (population >= 1_000) return `${trimNumber(population / 1_000)}K`
  return String(Math.round(population))
}

export function routeDisplayKind(route: Pick<JumpRoute, 'communication' | 'trade'>): 'trade' | 'communication' | 'local' {
  if (route.trade) return 'trade'
  if (route.communication) return 'communication'
  return 'local'
}

export function applySubsectorOverrides(
  subsector: Subsector,
  overrides: SubsectorOverrides,
  routeOverrides: SubsectorRouteOverrides = {},
): Subsector {
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
  const polity_cells = subsector.polity_cells?.map((cell) => {
    const override = overrides[subsectorOverrideKey(subsector.seed, cell.coord)]
    if (!override?.allegiance) return cell
    const generatedHex = subsector.hexes.find((hex) => sameHex(hex.coord, cell.coord))
    if (!generatedHex) return cell
    if (override.system_seed != null && override.system_seed !== generatedHex.system_seed) return cell
    changed = true
    return {
      ...cell,
      allegiance: override.allegiance,
      frontier: true,
    }
  })
  const hexByCoord = new Map<string, SubsectorHex>()
  for (const hex of hexes) {
    hexByCoord.set(`${hex.coord.col},${hex.coord.row}`, hex)
  }
  const jump_routes = subsector.jump_routes.map((route) => {
    const override = routeOverrides[routeOverrideKey(subsector.seed, route.from, route.to)]
    if (!override) return route
    const fromHex = hexByCoord.get(`${route.from.col},${route.from.row}`)
    const toHex = hexByCoord.get(`${route.to.col},${route.to.row}`)
    if (
      (override.from_system_seed != null && fromHex?.system_seed !== override.from_system_seed) ||
      (override.to_system_seed != null && toHex?.system_seed !== override.to_system_seed)
    ) {
      return route
    }
    const trade = override.trade ?? route.trade
    changed = true
    return {
      ...route,
      visible: override.visible ?? route.visible ?? true,
      communication: override.communication ?? route.communication,
      trade,
      trade_score: trade ? clampRouteScore(override.trade_score ?? route.trade_score) : 0,
    }
  })
  if (!changed) return subsector
  return {
    ...subsector,
    allegiance: dominantAllegiance(hexes, subsector.allegiance),
    polity_cells,
    hexes,
    jump_routes,
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

export function politySummaries(subsector: Subsector): PolitySummary[] {
  return subsector.allegiances
    .map((allegiance) => {
      const controlled = subsector.hexes.filter((hex) => hex.allegiance === allegiance.code)
      const territory = polityCells(subsector).filter((cell) => cell.allegiance === allegiance.code).length
      const capitalHex = controlled.slice().sort((a, b) => {
        const distance = hexDistance(a.coord, allegiance.capital) - hexDistance(b.coord, allegiance.capital)
        if (distance !== 0) return distance
        if (a.coord.col !== b.coord.col) return a.coord.col - b.coord.col
        return a.coord.row - b.coord.row
      })[0] ?? null
      return {
        allegiance,
        count: controlled.length,
        territory,
        capitalHex,
        capitalDistance: capitalHex ? hexDistance(capitalHex.coord, allegiance.capital) : null,
      }
    })
    .sort((a, b) => b.count - a.count || b.territory - a.territory || a.allegiance.code.localeCompare(b.allegiance.code))
}

export function polityBorders(subsector: Subsector): PolityBorder[] {
  const cells = polityCells(subsector)
  if (cells.length > 0) return polityCellBorders(cells)

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

export function polityCells(subsector: Subsector): PolityCell[] {
  if (subsector.polity_cells && subsector.polity_cells.length > 0) return subsector.polity_cells
  return subsector.hexes.map((hex) => ({
    coord: hex.coord,
    allegiance: hex.allegiance,
    frontier: false,
    capital: subsector.allegiances.some((allegiance) => sameHex(allegiance.capital, hex.coord)),
  }))
}

function polityCellBorders(cells: PolityCell[]): PolityBorder[] {
  const cellByCoord = new Map<string, PolityCell>()
  for (const cell of cells) {
    cellByCoord.set(`${cell.coord.col},${cell.coord.row}`, cell)
  }
  const borders: PolityBorder[] = []
  for (const cell of cells) {
    for (const candidate of forwardNeighborEdges(cell.coord)) {
      const neighbor = cellByCoord.get(`${candidate.coord.col},${candidate.coord.row}`)
      if (!neighbor || neighbor.allegiance === cell.allegiance) continue
      borders.push({
        coord: cell.coord,
        edge: candidate.edge,
        from: cell.allegiance,
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

function pbgDigit(value: number): string {
  return String(Math.max(0, Math.min(9, Math.trunc(value))))
}

function trimNumber(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, '')
}

function hexDistance(a: HexCoord, b: HexCoord): number {
  const [ax, ay] = axialFromOffset(a)
  const [bx, by] = axialFromOffset(b)
  const dx = ax - bx
  const dy = ay - by
  const dz = -dx - dy
  return (Math.abs(dx) + Math.abs(dy) + Math.abs(dz)) / 2
}

function axialFromOffset(coord: HexCoord): [number, number] {
  const col = coord.col
  const row = coord.row
  return [col, row - Math.floor(col / 2)]
}

function canonicalRouteEndpoints(from: HexCoord, to: HexCoord): [HexCoord, HexCoord] {
  const a = hexLabel(from)
  const b = hexLabel(to)
  return a <= b ? [from, to] : [to, from]
}

function clampRouteScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(9, Math.round(value)))
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
