import { deriveTradeCodes } from '../cepheus'
import { resolveHexName, sectorDisplayName } from '../names'
import {
  hexLabel,
  pbgCode,
  subsectorAt,
  uwpToCode,
  type Subsector,
  type SubsectorHex,
} from './types'

// Canonical T5 Second Survey (T5SS) tab-delimited export. The column set is the
// practical superset the community uses; the {Ix}/(Ex)/[Cx] headers are present
// (blank) so the file is recognised as T5SS by standard sector-map tools and
// by our own parseSectorData importer. Export and import are inverses on
// world-identity
// fields, so export -> import -> export is idempotent on the data rows.

const COLUMNS = [
  'Sector', 'SS', 'Hex', 'Name', 'UWP', 'Bases', 'Remarks', 'Zone', 'PBG',
  'Allegiance', 'Stars', '{Ix}', '(Ex)', '[Cx]',
] as const

// Inverse of the importer's base mapping: emit only N/S/R/A so a round-trip
// restores the same four flags.
function basesField(h: SubsectorHex): string {
  return (
    (h.bases.naval ? 'N' : '') +
    (h.bases.scout ? 'S' : '') +
    (h.bases.research ? 'R' : '') +
    (h.bases.aid ? 'A' : '')
  )
}

function zoneField(h: SubsectorHex): string {
  return h.travel_zone === 'Amber' ? 'A' : h.travel_zone === 'Red' ? 'R' : ''
}

function hexRow(sub: Subsector, sectorName: string, hex: SubsectorHex): string {
  return [
    sectorName,
    subsectorAt(sub, hex.coord)?.letter ?? 'A',
    hexLabel(hex.coord),
    resolveHexName(sub, hex.coord),
    uwpToCode(hex.uwp),
    basesField(hex),
    deriveTradeCodes(hex.uwp).join(' '),
    zoneField(hex),
    pbgCode(hex.pbg),
    hex.allegiance,
    '', // Stars — not modelled
    '', '', '', // {Ix} (Ex) [Cx] — not modelled
  ].join('\t')
}

/** Serialize a subsector or sector to canonical T5SS tab-delimited text. */
export function subsectorToText(sub: Subsector): string {
  const sectorName = sectorDisplayName(sub)
  const sorted = [...sub.hexes].sort((a, b) =>
    a.coord.col !== b.coord.col ? a.coord.col - b.coord.col : a.coord.row - b.coord.row,
  )
  const lines: string[] = [
    `# ${sectorName} — ${sub.columns}x${sub.rows}, ${sub.hexes.length} worlds`,
    COLUMNS.join('\t'),
    ...sorted.map((hex) => hexRow(sub, sectorName, hex)),
  ]
  return lines.join('\n') + '\n'
}
