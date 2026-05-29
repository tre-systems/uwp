// Paste-text importer for standard sector/subsector data.
//
// Supports two community formats:
//   - T5 Second Survey tab-delimited (primary): a header row names the columns
//     (Hex, Name, UWP, Bases, Remarks, Zone, PBG, Allegiance, Stars, ...).
//   - Classic `.sec` fixed-width (secondary): column-positional, after an
//     optional legend block.
//
// Parsing is tolerant: each line is parsed independently, malformed lines are
// collected as errors, and the rows that do parse are still imported. Hex
// coordinates are sector-relative "XXYY" (01-32 / 01-40), matching our internal
// coordinate space exactly, so no translation is needed.

import { ehexToInt, parseUwpStrict } from '../../uwp'
import {
  type Allegiance,
  type Bases,
  type HexCoord,
  type Pbg,
  type Subsector,
  type SubsectorHex,
  type SubsectorMeta,
  type TravelZone,
} from './types'

const SUB_COLS = 8
const SUB_ROWS = 10
const MAX_SECTOR_COLS = 32
const MAX_SECTOR_ROWS = 40

export interface ImportError {
  line: number
  text: string
  reason: string
}

export interface ImportResult {
  subsector: Subsector | null
  errors: ImportError[]
  worldCount: number
  format: 'tab' | 'sec' | 'unknown'
}

interface ParsedWorld {
  coord: HexCoord
  name: string
  uwp: SubsectorHex['uwp']
  bases: Bases
  zone: TravelZone
  pbg: Pbg
  allegiance: string
}

const UWP_BODY = '[A-HXY?][0-9A-HJ-NP-Z?]{6}-[0-9A-HJ-NP-Z?]'

function isCommentOrBlank(line: string): boolean {
  const t = line.trim()
  return t.length === 0 || t.startsWith('#')
}

function basesFromCodes(codes: string): Bases {
  const set = new Set(codes.toUpperCase().replace(/[^A-Z]/g, '').split(''))
  return {
    // Map the common survey base letters onto our four slots.
    naval: set.has('N') || set.has('K'),
    scout: set.has('S'),
    research: set.has('R') || set.has('E'),
    aid: set.has('A'),
  }
}

function zoneFromCode(code: string): TravelZone {
  switch (code.trim().toUpperCase()) {
    case 'A':
      return 'Amber'
    case 'R':
      return 'Red'
    default:
      return 'Green'
  }
}

function pbgFromCode(code: string): Pbg {
  const digits = code.trim()
  const at = (i: number) => Math.max(0, ehexToInt(digits[i] ?? '0'))
  return {
    population_multiplier: at(0),
    belts: at(1),
    gas_giants: at(2),
  }
}

function parseHex(raw: string): HexCoord | null {
  const m = /^(\d{2})(\d{2})$/.exec(raw.trim())
  if (!m) return null
  const col = Number(m[1])
  const row = Number(m[2])
  if (col < 1 || col > MAX_SECTOR_COLS || row < 1 || row > MAX_SECTOR_ROWS) return null
  return { col, row }
}

// A finished world record from a single field bag. Returns a reason string on
// failure so the caller can report it.
function buildWorld(fields: {
  hex: string
  name: string
  uwp: string
  bases: string
  zone: string
  pbg: string
  allegiance: string
}): ParsedWorld | string {
  const coord = parseHex(fields.hex)
  if (!coord) return `bad hex "${fields.hex}"`
  const uwp = parseUwpStrict(fields.uwp)
  if (!uwp) return `bad UWP "${fields.uwp}"`
  return {
    coord,
    name: fields.name.trim() || 'Unnamed',
    uwp,
    bases: basesFromCodes(fields.bases),
    zone: zoneFromCode(fields.zone),
    pbg: pbgFromCode(fields.pbg || '000'),
    allegiance: (fields.allegiance.trim() || 'Na').slice(0, 4),
  }
}

function detectFormat(lines: string[]): 'tab' | 'sec' {
  // T5SS tab files carry a tab-delimited header naming the columns.
  const header = lines.find((l) => !isCommentOrBlank(l) && l.includes('\t'))
  if (header && /(^|\t)\s*hex\s*(\t|$)/i.test(header) && /\buwp\b/i.test(header)) {
    return 'tab'
  }
  return 'sec'
}

function parseTab(lines: string[], errors: ImportError[]): ParsedWorld[] {
  const worlds: ParsedWorld[] = []
  let cols: Record<string, number> | null = null
  lines.forEach((line, i) => {
    if (isCommentOrBlank(line)) return
    const cells = line.split('\t')
    if (!cols) {
      // First non-comment row is the header; map known names to indices.
      cols = {}
      cells.forEach((c, idx) => {
        cols![c.trim().toLowerCase()] = idx
      })
      return
    }
    const at = (name: string) => (cols![name] != null ? (cells[cols![name]] ?? '').trim() : '')
    const built = buildWorld({
      hex: at('hex'),
      name: at('name'),
      uwp: at('uwp'),
      bases: at('bases'),
      zone: at('zone'),
      pbg: at('pbg'),
      allegiance: at('allegiance'),
    })
    if (typeof built === 'string') errors.push({ line: i + 1, text: line, reason: built })
    else worlds.push(built)
  })
  return worlds
}

// Classic `.sec` columns (1-based, inclusive): Name 1-14, Hex 15-18, UWP 20-28,
// Bases 31, Codes 33-47, Zone 49, PBG 52-54, Allegiance 56-57, Stellar 59+.
function parseSec(lines: string[], errors: ImportError[]): ParsedWorld[] {
  const worlds: ParsedWorld[] = []
  const slice = (line: string, start: number, end: number) => line.slice(start - 1, end)
  const uwpRe = new RegExp(`^${UWP_BODY}$`)
  lines.forEach((line, i) => {
    if (isCommentOrBlank(line)) return
    // Skip legend/ruler lines: a data row has a 4-digit hex at cols 15-18.
    if (!/^\d{4}$/.test(slice(line, 15, 18).trim())) return
    const uwp = slice(line, 20, 28).trim()
    if (!uwpRe.test(uwp)) {
      errors.push({ line: i + 1, text: line, reason: `bad UWP "${uwp}"` })
      return
    }
    const built = buildWorld({
      name: slice(line, 1, 14),
      hex: slice(line, 15, 18),
      uwp,
      bases: slice(line, 31, 31),
      zone: slice(line, 49, 49),
      pbg: slice(line, 52, 54),
      allegiance: slice(line, 56, 57),
    })
    if (typeof built === 'string') errors.push({ line: i + 1, text: line, reason: built })
    else worlds.push(built)
  })
  return worlds
}

/** The lettered 8×10 sub-blocks tiling a cols×rows grid (mirrors Rust). */
export function subsectorMeta(cols: number, rows: number): SubsectorMeta[] {
  const blocks: SubsectorMeta[] = []
  let letter = 'A'.charCodeAt(0)
  for (let rowMin = 1; rowMin <= rows; rowMin += SUB_ROWS) {
    for (let colMin = 1; colMin <= cols; colMin += SUB_COLS) {
      blocks.push({
        letter: String.fromCharCode(letter++),
        col_min: colMin,
        col_max: Math.min(colMin + SUB_COLS - 1, cols),
        row_min: rowMin,
        row_max: Math.min(rowMin + SUB_ROWS - 1, rows),
      })
    }
  }
  return blocks
}

function synthSystemSeed(coord: HexCoord, uwp: SubsectorHex['uwp']): number {
  // Deterministic per-world seed so the renderer can show a plausible system
  // whose main world matches the imported UWP (no seed travels in survey data).
  let h = (((coord.col << 8) | coord.row) ^ 0x9e3779b9) >>> 0
  for (const v of [uwp.starport.charCodeAt(0), uwp.size, uwp.atm, uwp.hydro, uwp.pop, uwp.gov, uwp.law, uwp.tech]) {
    h = Math.imul(h ^ v, 0x85ebca6b) >>> 0
  }
  return h >>> 0
}

function toHex(world: ParsedWorld): SubsectorHex {
  const pop = Math.max(0, Math.round(world.pbg.population_multiplier * 10 ** world.uwp.pop))
  return {
    coord: world.coord,
    system_seed: synthSystemSeed(world.coord, world.uwp),
    uwp: world.uwp,
    bases: world.bases,
    travel_zone: world.zone,
    allegiance: world.allegiance,
    gas_giant: world.pbg.gas_giants > 0,
    belts: world.pbg.belts > 0 || world.uwp.size === 0,
    population: pop,
    pbg: world.pbg,
    name: world.name,
  }
}

function buildAllegiances(hexes: SubsectorHex[]): Allegiance[] {
  // One Allegiance per distinct code; capital = its highest-population world.
  const byCode = new Map<string, SubsectorHex>()
  for (const hex of hexes) {
    const best = byCode.get(hex.allegiance)
    if (!best || hex.population > best.population) byCode.set(hex.allegiance, hex)
  }
  return [...byCode.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, capitalHex], idx) => ({
      code,
      name: code,
      capital: capitalHex.coord,
      color_index: idx,
    }))
}

function dominantAllegiance(hexes: SubsectorHex[]): string {
  const counts = new Map<string, number>()
  for (const hex of hexes) counts.set(hex.allegiance, (counts.get(hex.allegiance) ?? 0) + 1)
  let best = 'Na'
  let bestCount = -1
  for (const [code, count] of counts) {
    if (count > bestCount) {
      best = code
      bestCount = count
    }
  }
  return best
}

/** Parse pasted T5SS-tab or classic `.sec` text into a Subsector. */
export function parseSectorData(text: string): ImportResult {
  const clean = text.replace(/^﻿/, '')
  const lines = clean.split(/\r?\n/)
  const format = detectFormat(lines)
  const errors: ImportError[] = []
  const worlds = format === 'tab' ? parseTab(lines, errors) : parseSec(lines, errors)

  if (worlds.length === 0) {
    return { subsector: null, errors, worldCount: 0, format }
  }

  // Dedupe by hex (last one wins) and snap the grid to a standard subsector or
  // full sector based on how far the coordinates spread.
  const byCoord = new Map<string, SubsectorHex>()
  for (const w of worlds) byCoord.set(`${w.coord.col},${w.coord.row}`, toHex(w))
  const hexes = [...byCoord.values()]
  const maxCol = Math.max(...hexes.map((h) => h.coord.col))
  const maxRow = Math.max(...hexes.map((h) => h.coord.row))
  const columns = maxCol > SUB_COLS ? MAX_SECTOR_COLS : SUB_COLS
  const rows = maxRow > SUB_ROWS ? MAX_SECTOR_ROWS : SUB_ROWS

  const allegiances = buildAllegiances(hexes)
  // A stable synthetic seed (for override keys); imported hexes carry explicit
  // names, so this never drives name generation.
  const seed = (((maxCol << 8) | maxRow) ^ Math.imul(hexes.length, 0x9e3779b9)) >>> 0

  const subsector: Subsector = {
    seed,
    density: hexes.length / (columns * rows),
    columns,
    rows,
    allegiance: dominantAllegiance(hexes),
    allegiances,
    hexes,
    jump_routes: [],
    subsectors: subsectorMeta(columns, rows),
  }

  return { subsector, errors, worldCount: hexes.length, format }
}
