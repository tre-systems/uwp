import { deriveTradeCodes } from '../cepheus'
import { systemName } from '../names'
import { hexLabel, subsectorHexCount, uwpToCode, visibleRoutes, type Subsector, type SubsectorHex } from './types'

// Tab-aligned plain text export, modelled on legacy 2d6-Map's "Second
// Survey" sec/tab format. Columns are space-padded so the file reads
// well in a terminal *and* round-trips through tools that expect
// fixed-width fields.
//
// Sample line (header + row):
//
//   Name             Hex   UWP        Bases Codes              Zone PBG  Allegiance
//   Aramis           0306  A788899-C  N-S-  Ri Ag              -    503  ImDe
//
// PBG packs Population multiplier / Belt count / Gas-giant count. Rust
// derives this from the generated population estimate and physical
// system counts, then serializes it with the subsector hex.

const COLS = [
  { label: 'Name', width: 18 },
  { label: 'Hex', width: 6 },
  { label: 'UWP', width: 11 },
  { label: 'Bases', width: 6 },
  { label: 'Codes', width: 22 },
  { label: 'Zone', width: 5 },
  { label: 'PBG', width: 5 },
  { label: 'Allegiance', width: 11 },
] as const

function basesField(h: SubsectorHex): string {
  // Single-letter legacy 2d6 convention: Naval (N), Scout (S),
  // Research (R), Aid (T). Hyphen fills empty slots so the column
  // stays a stable width.
  const slots = [
    h.bases.naval ? 'N' : '-',
    h.bases.scout ? 'S' : '-',
    h.bases.research ? 'R' : '-',
    h.bases.Aid ? 'T' : '-',
  ]
  return slots.join('').replace(/-+$/, '') || '-'
}

function zoneField(h: SubsectorHex): string {
  switch (h.travel_zone) {
    case 'Amber': return 'A'
    case 'Red': return 'R'
    default: return '-'
  }
}

function pbgField(h: SubsectorHex): string {
  return `${pbgDigit(h.pbg.population_multiplier)}${pbgDigit(h.pbg.belts)}${pbgDigit(h.pbg.gas_giants)}`
}

function nameOrFallback(h: SubsectorHex): string {
  if (h.name) return h.name
  return systemName(h.system_seed)
}

function padRight(s: string, w: number): string {
  if (s.length >= w) return s.slice(0, Math.max(1, w - 1)) + ' '
  return s + ' '.repeat(w - s.length)
}

function pbgDigit(value: number): string {
  return String(Math.max(0, Math.min(9, Math.trunc(value))))
}

function headerLine(): string {
  return COLS.map((c) => padRight(c.label, c.width)).join('').trimEnd()
}

function dividerLine(): string {
  return COLS.map((c) => padRight('-'.repeat(Math.max(1, c.width - 1)), c.width)).join('').trimEnd()
}

function hexLine(h: SubsectorHex, allegiance: string): string {
  const tradeCodes = deriveTradeCodes(h.uwp).join(' ')
  const fields: readonly string[] = [
    nameOrFallback(h),
    hexLabel(h.coord),
    uwpToCode(h.uwp),
    basesField(h),
    tradeCodes || '-',
    zoneField(h),
    pbgField(h),
    allegiance.slice(0, 4),
  ]
  return fields.map((f, i) => padRight(f, COLS[i].width)).join('').trimEnd()
}

function routeLine(route: Subsector['jump_routes'][number]): string {
  const comm = route.communication ? 'Y' : '-'
  const trade = route.trade ? 'Y' : '-'
  const score = route.trade ? String(route.trade_score) : '-'
  return [
    padRight(hexLabel(route.from), 6),
    padRight(hexLabel(route.to), 6),
    padRight(`J-${route.jump}`, 6),
    padRight(comm, 6),
    padRight(trade, 6),
    score,
  ].join('').trimEnd()
}

function routeDividerLine(): string {
  return [
    padRight('-----', 6),
    padRight('-----', 6),
    padRight('-----', 6),
    padRight('-----', 6),
    padRight('-----', 6),
    '-----',
  ].join('').trimEnd()
}

export function subsectorToText(sub: Subsector): string {
  const lines: string[] = []
  const exportedRoutes = visibleRoutes(sub)
  const communicationRoutes = exportedRoutes.filter((route) => route.communication)
  const tradeRoutes = exportedRoutes.filter((route) => route.trade)
  lines.push(`# Subsector region ${systemName(sub.seed)}  (seed ${sub.seed})`)
  lines.push(`# Dimensions: ${sub.columns} x ${sub.rows}`)
  lines.push(`# Dominant allegiance: ${sub.allegiance}`)
  lines.push(`# Polities: ${sub.allegiances.map((a) => `${a.code}=${a.name}`).join(', ') || '-'}`)
  lines.push(`# Hexes occupied: ${sub.hexes.length} / ${subsectorHexCount(sub)}`)
  lines.push(`# Routes: ${communicationRoutes.length} communications, ${tradeRoutes.length} trade`)
  lines.push('')
  lines.push(headerLine())
  lines.push(dividerLine())
  // Render rows in hex-address order so the file reads like a
  // catalogue rather than the generator's traversal order.
  const sorted = [...sub.hexes].sort((a, b) => {
    if (a.coord.col !== b.coord.col) return a.coord.col - b.coord.col
    return a.coord.row - b.coord.row
  })
  for (const hex of sorted) {
    lines.push(hexLine(hex, hex.allegiance || sub.allegiance))
  }
  if (exportedRoutes.length > 0) {
    lines.push('')
    lines.push('# Route table')
    lines.push('From  To    Jump  Comm  Trade Score')
    lines.push(routeDividerLine())
    const sortedRoutes = [...exportedRoutes].sort((a, b) => {
      const from = hexLabel(a.from).localeCompare(hexLabel(b.from))
      if (from !== 0) return from
      const to = hexLabel(a.to).localeCompare(hexLabel(b.to))
      if (to !== 0) return to
      return a.jump - b.jump
    })
    for (const route of sortedRoutes) {
      lines.push(routeLine(route))
    }
  }
  return lines.join('\n') + '\n'
}
