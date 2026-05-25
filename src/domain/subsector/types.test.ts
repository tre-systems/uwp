import { describe, expect, it } from 'vitest'
import { polityBorders, type Subsector, type SubsectorHex } from './types'

function hex(col: number, row: number, allegiance: string): SubsectorHex {
  return {
    coord: { col, row },
    system_seed: 1,
    uwp: { starport: 'C', size: 7, atm: 6, hydro: 5, pop: 6, gov: 7, law: 4, tech: 9 },
    bases: { naval: false, scout: false, research: false, Aid: false },
    travel_zone: 'Green',
    allegiance,
    gas_giant: false,
    belts: false,
    population: 6_000_000,
    pbg: { population_multiplier: 6, belts: 0, gas_giants: 0 },
    name: null,
  }
}

function subsector(hexes: SubsectorHex[]): Subsector {
  return {
    seed: 1,
    density: 0.5,
    columns: 16,
    rows: 10,
    allegiance: 'ImDi',
    allegiances: [
      { code: 'ImDi', name: 'Imperial Diocese', capital: { col: 4, row: 5 }, color_index: 0 },
      { code: 'NaVa', name: 'Navis Verge', capital: { col: 13, row: 5 }, color_index: 1 },
    ],
    hexes,
    jump_routes: [],
  }
}

describe('polityBorders', () => {
  it('does not draw borders between same-allegiance occupied neighbours', () => {
    expect(polityBorders(subsector([hex(1, 1, 'ImDi'), hex(1, 2, 'ImDi')]))).toEqual([])
  })

  it('draws one border segment between different occupied neighbours', () => {
    expect(polityBorders(subsector([hex(1, 1, 'ImDi'), hex(1, 2, 'NaVa')]))).toEqual([
      { coord: { col: 1, row: 1 }, edge: 1, from: 'ImDi', to: 'NaVa' },
    ])
  })

  it('does not outline empty neighbours in v1', () => {
    expect(polityBorders(subsector([hex(1, 1, 'ImDi')]))).toEqual([])
  })
})
