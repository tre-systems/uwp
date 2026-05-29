import { describe, expect, it } from 'vitest'
import { subsectorToText } from './export'
import {
  applySubsectorOverrides,
  subsectorOverrideKey,
  type JumpRoute,
  type Subsector,
  type SubsectorHex,
} from './types'

function hex(col: number, row: number, overrides: Partial<SubsectorHex> = {}): SubsectorHex {
  return {
    coord: { col, row },
    system_seed: 0xABCD1234,
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

function route(fromCol: number, fromRow: number, toCol: number, toRow: number, overrides: Partial<JumpRoute> = {}): JumpRoute {
  return {
    from: { col: fromCol, row: fromRow },
    to: { col: toCol, row: toRow },
    jump: 1,
    communication: true,
    trade: false,
    trade_score: 0,
    ...overrides,
  }
}

function subsector(hexes: SubsectorHex[], jump_routes: JumpRoute[] = []): Subsector {
  return {
    seed: 0xFEEDFACE,
    density: 0.5,
    columns: 8,
    rows: 10,
    allegiance: 'ImDi',
    allegiances: [
      { code: 'ImDi', name: 'Imperial Diocese', capital: { col: 4, row: 5 }, color_index: 0 },
      { code: 'NaVa', name: 'Navis Verge', capital: { col: 13, row: 5 }, color_index: 1 },
      { code: 'Na', name: 'Neutral Border', capital: { col: 8, row: 5 }, color_index: 2 },
    ],
    hexes,
    jump_routes,
  }
}

describe('subsectorToText', () => {
  it('renders a header, divider, and one row per hex', () => {
    const text = subsectorToText(subsector([hex(3, 6)]))
    const lines = text.trim().split('\n')
    // 6 banner comments + blank + header + divider + 1 data row
    expect(lines).toHaveLength(10)
    expect(lines[1]).toBe('# Dimensions: 8 x 10')
    expect(lines[2]).toBe('# Dominant allegiance: ImDi')
    expect(lines[3]).toMatch(/^# Polities: ImDi=Imperial Diocese@0306\(1\/1\), Na=Neutral Border@0805\(0\/0\), NaVa=Navis Verge@1305\(0\/0\)$/)
    expect(lines[4]).toBe('# Hexes occupied: 1 / 80')
    expect(lines[5]).toBe('# Routes: 0 communications, 0 trade')
    expect(lines[7]).toMatch(/^Name\s+Hex\s+UWP\s+Bases\s+Codes\s+Zone\s+PBG\s+Allegiance$/)
    expect(lines[8]).toMatch(/^-+\s+-+\s+-+/)
    // Hex 0306 with starport A, bases NS, allegiance ImDi
    expect(lines[9]).toContain('0306')
    expect(lines[9]).toContain('A788899-C')
    expect(lines[9]).toContain('NS')
    expect(lines[9]).toMatch(/ImDi$/)
  })

  it('sorts hexes by col then row', () => {
    const out = subsectorToText(
      subsector([hex(8, 10), hex(1, 9), hex(7, 1)]),
    )
    const dataLines = out.trim().split('\n').slice(9)
    expect(dataLines[0]).toContain('0109')
    expect(dataLines[1]).toContain('0701')
    expect(dataLines[2]).toContain('0810')
  })

  it('formats red/amber zones and base combinations', () => {
    const text = subsectorToText(
      subsector([
        hex(1, 1, {
          travel_zone: 'Red',
          bases: { naval: false, scout: false, research: true, aid: true },
        }),
        hex(2, 2, {
          travel_zone: 'Amber',
          bases: { naval: false, scout: false, research: false, aid: false },
        }),
      ]),
    )
    const lines = text.trim().split('\n').slice(9)
    expect(lines[0]).toMatch(/--RA/)  // research + aid, leading hyphens preserved
    expect(lines[0]).toMatch(/\sR\s/) // red zone column
    expect(lines[1]).toMatch(/\sA\s/) // amber zone column
  })

  it('packs PBG from the generated multiplier and physical counts', () => {
    const text = subsectorToText(
      subsector([
        hex(1, 1, {
          gas_giant: true,
          belts: true,
          population: 7_000_000,
          pbg: { population_multiplier: 7, belts: 3, gas_giants: 4 },
        }),
      ]),
    )
    expect(text).toMatch(/\s734\s/)
  })

  it('uses each hex allegiance in the world table', () => {
    const text = subsectorToText(subsector([hex(9, 1, { allegiance: 'NaVa' })]))

    expect(text.trim().split('\n').at(-1)).toMatch(/NaVa$/)
  })

  it('exports referee-overridden zone, bases, and allegiance from effective subsectors', () => {
    const raw = subsector([hex(9, 1)])
    const effective = applySubsectorOverrides(raw, {
      [subsectorOverrideKey(raw.seed, { col: 9, row: 1 })]: {
        system_seed: raw.hexes[0].system_seed,
        travel_zone: 'Red',
        allegiance: 'NaVa',
        bases: { naval: false, scout: false, research: true, aid: true },
      },
    })

    const row = subsectorToText(effective).trim().split('\n').at(-1) ?? ''
    expect(row).toContain('--RA')
    expect(row).toMatch(/\sR\s/)
    expect(row).toMatch(/NaVa$/)
  })

  it('adds a route table with communication and trade context', () => {
    const text = subsectorToText(
      subsector(
        [hex(1, 1), hex(1, 2), hex(2, 2)],
        [
          route(1, 1, 1, 2, { communication: true, trade: true, trade_score: 8 }),
          route(1, 1, 2, 2, { jump: 2, communication: false, trade: false, trade_score: 0 }),
        ],
      ),
    )

    expect(text).toContain('# Routes: 1 communications, 1 trade')
    expect(text).toContain('# Route table')
    expect(text).toContain('From  To    Jump  Comm  Trade Score')
    expect(text).toMatch(/0101\s+0102\s+J-1\s+Y\s+Y\s+8/)
    expect(text).toMatch(/0101\s+0202\s+J-2\s+-\s+-\s+-/)
  })

  it('omits referee-hidden routes from counts and route table', () => {
    const text = subsectorToText(
      subsector(
        [hex(1, 1), hex(1, 2), hex(2, 2)],
        [
          route(1, 1, 1, 2, { communication: true, trade: true, trade_score: 8, visible: false }),
          route(1, 1, 2, 2, { jump: 2, communication: true, trade: false }),
        ],
      ),
    )

    expect(text).toContain('# Routes: 1 communications, 0 trade')
    expect(text).not.toMatch(/0101\s+0102/)
    expect(text).toMatch(/0101\s+0202\s+J-2\s+Y\s+-\s+-/)
  })
})
