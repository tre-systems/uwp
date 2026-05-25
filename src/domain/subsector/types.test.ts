import { describe, expect, it } from 'vitest'
import {
  allegianceCounts,
  applySubsectorOverrides,
  polityBorders,
  subsectorOverrideKey,
  type Subsector,
  type SubsectorHex,
} from './types'

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

describe('applySubsectorOverrides', () => {
  it('applies selected hex map fact overrides without mutating generated data', () => {
    const original = hex(1, 1, 'ImDi')
    const sub = subsector([original])
    const out = applySubsectorOverrides(sub, {
      [subsectorOverrideKey(sub.seed, original.coord)]: {
        system_seed: original.system_seed,
        travel_zone: 'Red',
        allegiance: 'NaVa',
        bases: { naval: true, scout: false, research: true, Aid: false },
      },
    })

    expect(out).not.toBe(sub)
    expect(out.hexes[0]).toMatchObject({
      travel_zone: 'Red',
      allegiance: 'NaVa',
      bases: { naval: true, scout: false, research: true, Aid: false },
    })
    expect(original).toMatchObject({
      travel_zone: 'Green',
      allegiance: 'ImDi',
      bases: { naval: false, scout: false, research: false, Aid: false },
    })
  })

  it('ignores overrides for other seeds or coordinates', () => {
    const sub = subsector([hex(1, 1, 'ImDi')])

    expect(applySubsectorOverrides(sub, {
      [subsectorOverrideKey(2, { col: 1, row: 1 })]: { travel_zone: 'Red' },
      [subsectorOverrideKey(sub.seed, { col: 2, row: 1 })]: { travel_zone: 'Amber' },
    })).toBe(sub)
  })

  it('ignores stale overrides when the generated world seed changes', () => {
    const sub = subsector([hex(1, 1, 'ImDi')])

    expect(applySubsectorOverrides(sub, {
      [subsectorOverrideKey(sub.seed, { col: 1, row: 1 })]: {
        system_seed: 999,
        travel_zone: 'Red',
      },
    })).toBe(sub)
  })

  it('preserves unspecified generated fields for partial overrides', () => {
    const sub = subsector([hex(1, 1, 'ImDi')])
    const out = applySubsectorOverrides(sub, {
      [subsectorOverrideKey(sub.seed, { col: 1, row: 1 })]: {
        system_seed: sub.hexes[0].system_seed,
        travel_zone: 'Amber',
      },
    })

    expect(out.hexes[0]).toMatchObject({
      travel_zone: 'Amber',
      allegiance: 'ImDi',
      bases: sub.hexes[0].bases,
    })
  })

  it('updates derived allegiance counts and borders on the effective subsector', () => {
    const sub = subsector([hex(1, 1, 'ImDi'), hex(1, 2, 'ImDi')])
    const out = applySubsectorOverrides(sub, {
      [subsectorOverrideKey(sub.seed, { col: 1, row: 2 })]: {
        system_seed: sub.hexes[1].system_seed,
        allegiance: 'NaVa',
      },
    })

    expect(allegianceCounts(out).map(({ code, count }) => [code, count])).toEqual([
      ['ImDi', 1],
      ['NaVa', 1],
    ])
    expect(polityBorders(out)).toEqual([
      { coord: { col: 1, row: 1 }, edge: 1, from: 'ImDi', to: 'NaVa' },
    ])
  })
})
