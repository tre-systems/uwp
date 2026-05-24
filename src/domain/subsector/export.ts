import { deriveTradeCodes } from '../cepheus'
import { systemName } from '../names'
import { hexLabel, uwpToCode, type Subsector, type SubsectorHex } from './types'

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
// PBG packs Population multiplier / Belt count / Gas-giant count - we
// don't currently model the population multiplier so it defaults to 5
// (the legacy 2d6 convention when the value is unknown).

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
  // Population multiplier defaults to 5 since we don't model it;
  // belts and gas-giant flags compress to 0/1 in their slots.
  const pop = 5
  const belts = h.belts ? 1 : 0
  const giants = h.gas_giant ? 1 : 0
  return `${pop}${belts}${giants}`
}

function nameOrFallback(h: SubsectorHex): string {
  if (h.name) return h.name
  return systemName(h.system_seed)
}

function padRight(s: string, w: number): string {
  if (s.length >= w) return s.slice(0, Math.max(1, w - 1)) + ' '
  return s + ' '.repeat(w - s.length)
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

export function subsectorToText(sub: Subsector): string {
  const lines: string[] = []
  lines.push(`# Subsector ${systemName(sub.seed)}  (seed ${sub.seed})`)
  lines.push(`# Allegiance: ${sub.allegiance}`)
  lines.push(`# Hexes occupied: ${sub.hexes.length} / 80`)
  lines.push(`# Jump routes: ${sub.jump_routes.length}`)
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
    lines.push(hexLine(hex, sub.allegiance))
  }
  return lines.join('\n') + '\n'
}
