import { describe, expect, it } from 'vitest'
import { subsectorToText } from './export'
import { parseSectorData } from './import'
import {
  applySubsectorOverrides,
  subsectorOverrideKey,
  uwpToCode,
  type Subsector,
  type SubsectorHex,
} from './types'

function hex(col: number, row: number, overrides: Partial<SubsectorHex> = {}): SubsectorHex {
  return {
    coord: { col, row },
    system_seed: 0xabcd1234,
    uwp: { starport: 'A', size: 7, atm: 8, hydro: 8, pop: 8, gov: 9, law: 9, tech: 12 },
    bases: { naval: true, scout: true, research: false, aid: false },
    travel_zone: 'Green',
    allegiance: 'ImDi',
    gas_giant: true,
    belts: false,
    population: 8_000_000,
    pbg: { population_multiplier: 8, belts: 0, gas_giants: 2 },
    name: null,
    ...overrides,
  }
}

function subsector(hexes: SubsectorHex[]): Subsector {
  return {
    seed: 0xfeedface,
    density: 0.5,
    columns: 8,
    rows: 10,
    allegiance: 'ImDi',
    allegiances: [
      { code: 'ImDi', name: 'Imperial Diocese', capital: { col: 3, row: 5 }, color_index: 0 },
      { code: 'NaVa', name: 'Navis Verge', capital: { col: 7, row: 5 }, color_index: 1 },
      { code: 'Na', name: 'Neutral Border', capital: { col: 4, row: 5 }, color_index: 2 },
    ],
    hexes,
    jump_routes: [],
  }
}

const HEADER = 'Sector\tSS\tHex\tName\tUWP\tBases\tRemarks\tZone\tPBG\tAllegiance\tStars\t{Ix}\t(Ex)\t[Cx]'

// World rows: drop the leading comment and the literal header line.
function dataRows(text: string): string[] {
  return text
    .trimEnd()
    .split('\n')
    .filter((l) => !l.startsWith('#') && l !== HEADER)
}

describe('subsectorToText (T5SS tab)', () => {
  it('emits a comment, the canonical header, then one tab row per hex', () => {
    const lines = subsectorToText(subsector([hex(3, 6), hex(1, 1)])).trimEnd().split('\n')
    expect(lines[0].startsWith('#')).toBe(true)
    expect(lines[1]).toBe(HEADER)
    expect(lines).toHaveLength(4) // comment + header + 2 worlds
  })

  it('sorts worlds by hex and maps identity fields into each row', () => {
    const text = subsectorToText(
      subsector([
        hex(3, 6, {
          bases: { naval: true, scout: false, research: true, aid: false },
          travel_zone: 'Amber',
          allegiance: 'ZhIN',
          pbg: { population_multiplier: 6, belts: 0, gas_giants: 3 },
        }),
      ]),
    )
    const cells = dataRows(text)[0].split('\t')
    // Sector, SS, Hex, Name, UWP, Bases, Remarks, Zone, PBG, Allegiance, ...
    expect(cells[2]).toBe('0306')
    expect(cells[4]).toBe('A788899-C')
    expect(cells[5]).toBe('NR') // naval + research
    expect(cells[7]).toBe('A') // Amber
    expect(cells[8]).toBe('603')
    expect(cells[9]).toBe('ZhIN')
  })

  it('round-trips through the importer (export -> import -> same worlds)', () => {
    const sub = subsector([
      hex(3, 6, { travel_zone: 'Amber', allegiance: 'ZhIN', bases: { naval: true, scout: false, research: true, aid: false } }),
      hex(1, 1, { travel_zone: 'Red', allegiance: 'NaVa', bases: { naval: false, scout: false, research: false, aid: true } }),
    ])
    const { subsector: round, worldCount } = parseSectorData(subsectorToText(sub))
    expect(worldCount).toBe(2)
    for (const orig of sub.hexes) {
      const got = round!.hexes.find((h) => h.coord.col === orig.coord.col && h.coord.row === orig.coord.row)!
      expect(uwpToCode(got.uwp)).toBe(uwpToCode(orig.uwp))
      expect(got.travel_zone).toBe(orig.travel_zone)
      expect(got.allegiance).toBe(orig.allegiance)
      expect(got.bases).toEqual(orig.bases)
    }
  })

  it('reflects referee overrides in the exported rows', () => {
    const raw = subsector([hex(2, 2)])
    const effective = applySubsectorOverrides(raw, {
      [subsectorOverrideKey(raw.seed, { col: 2, row: 2 })]: {
        system_seed: raw.hexes[0].system_seed,
        travel_zone: 'Red',
        allegiance: 'NaVa',
        bases: { naval: false, scout: false, research: true, aid: true },
      },
    })
    const cells = dataRows(subsectorToText(effective))[0].split('\t')
    expect(cells[5]).toBe('RA') // research + aid
    expect(cells[7]).toBe('R') // Red
    expect(cells[9]).toBe('NaVa')
  })
})
