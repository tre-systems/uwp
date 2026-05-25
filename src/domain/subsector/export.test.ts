import { describe, expect, it } from 'vitest'
import { subsectorToText } from './export'
import type { JumpRoute, Subsector, SubsectorHex } from './types'

function hex(col: number, row: number, overrides: Partial<SubsectorHex> = {}): SubsectorHex {
  return {
    coord: { col, row },
    system_seed: 0xABCD1234,
    uwp: { starport: 'A', size: 7, atm: 8, hydro: 8, pop: 8, gov: 9, law: 9, tech: 12 },
    bases: { naval: true, scout: true, research: false, Aid: false },
    travel_zone: 'Green',
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
    columns: 16,
    rows: 10,
    allegiance: 'ImDi',
    hexes,
    jump_routes,
  }
}

describe('subsectorToText', () => {
  it('renders a header, divider, and one row per hex', () => {
    const text = subsectorToText(subsector([hex(3, 6)]))
    const lines = text.trim().split('\n')
    // 5 banner comments + blank + header + divider + 1 data row
    expect(lines).toHaveLength(9)
    expect(lines[1]).toBe('# Dimensions: 16 x 10')
    expect(lines[3]).toBe('# Hexes occupied: 1 / 160')
    expect(lines[4]).toBe('# Routes: 0 communications, 0 trade')
    expect(lines[6]).toMatch(/^Name\s+Hex\s+UWP\s+Bases\s+Codes\s+Zone\s+PBG\s+Allegiance$/)
    expect(lines[7]).toMatch(/^-+\s+-+\s+-+/)
    // Hex 0306 with starport A, bases NS, allegiance ImDi
    expect(lines[8]).toContain('0306')
    expect(lines[8]).toContain('A788899-C')
    expect(lines[8]).toContain('NS')
    expect(lines[8]).toMatch(/ImDi$/)
  })

  it('sorts hexes by col then row', () => {
    const out = subsectorToText(
      subsector([hex(16, 10), hex(1, 9), hex(9, 1)]),
    )
    const dataLines = out.trim().split('\n').slice(8)
    expect(dataLines[0]).toContain('0109')
    expect(dataLines[1]).toContain('0901')
    expect(dataLines[2]).toContain('1610')
  })

  it('formats red/amber zones and base combinations', () => {
    const text = subsectorToText(
      subsector([
        hex(1, 1, {
          travel_zone: 'Red',
          bases: { naval: false, scout: false, research: true, Aid: true },
        }),
        hex(2, 2, {
          travel_zone: 'Amber',
          bases: { naval: false, scout: false, research: false, Aid: false },
        }),
      ]),
    )
    const lines = text.trim().split('\n').slice(8)
    expect(lines[0]).toMatch(/--RT/)  // research + Aid, leading hyphens preserved
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
})
