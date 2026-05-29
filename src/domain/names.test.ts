import { describe, expect, it } from 'vitest'
import { hexName, resolveHexName, subsectorHexNames, systemName } from './names'
import type { Subsector, SubsectorHex } from './subsector/types'

function makeHex(col: number, row: number, name: string | null = null): SubsectorHex {
  return {
    coord: { col, row },
    system_seed: (((col << 8) | row) ^ 0x5bd1e995) >>> 0,
    uwp: { starport: 'A', size: 7, atm: 8, hydro: 8, pop: 8, gov: 9, law: 9, tech: 12 },
    bases: { naval: false, scout: false, research: false, aid: false },
    travel_zone: 'Green',
    allegiance: 'Im',
    gas_giant: false,
    belts: false,
    population: 1000,
    pbg: { population_multiplier: 1, belts: 0, gas_giants: 0 },
    name,
  }
}

function makeSubsector(hexes: SubsectorHex[]): Subsector {
  return {
    seed: 0xFEEDFACE,
    density: 0.5,
    columns: 8,
    rows: 10,
    allegiance: 'Im',
    allegiances: [],
    hexes,
    jump_routes: [],
  }
}

describe('name generator', () => {
  it('is deterministic for the same seed', () => {
    expect(systemName(1234)).toBe(systemName(1234))
    expect(systemName(0)).toBe(systemName(0))
    expect(systemName(0xffffffff)).toBe(systemName(0xffffffff))
  })

  it('produces distinct names for nearby seeds', () => {
    const a = systemName(1)
    const b = systemName(2)
    const c = systemName(3)
    // splitmix32 should scatter; if all three collide, our RNG is broken.
    const distinct = new Set([a, b, c])
    expect(distinct.size).toBeGreaterThanOrEqual(2)
  })

  it('starts with an uppercase letter', () => {
    for (let i = 0; i < 32; i++) {
      const name = systemName(i * 17 + 1)
      expect(name[0]).toBe(name[0].toUpperCase())
    }
  })

  it('hexName combines parent seed with coords', () => {
    const a = hexName(1, 3, 4)
    const b = hexName(1, 4, 3)
    // Different cells should usually produce different names.
    // (Hash collisions are possible but vanishingly unlikely for this small a test.)
    expect(a).not.toBe(b)
  })

  it('stays within a reasonable length', () => {
    for (let i = 0; i < 64; i++) {
      const name = systemName(i)
      expect(name.length).toBeGreaterThan(2)
      expect(name.length).toBeLessThanOrEqual(24)
    }
  })
})

describe('resolveHexName (single source of truth)', () => {
  it('resolves to the same name the shared table holds (map/breadcrumb/panel agree)', () => {
    const sub = makeSubsector([makeHex(1, 1), makeHex(2, 3), makeHex(8, 10)])
    const table = subsectorHexNames(sub)
    for (const h of sub.hexes) {
      expect(resolveHexName(sub, h.coord)).toBe(table.get(`${h.coord.col},${h.coord.row}`))
    }
  })

  it('is deterministic across subsector instances with the same seed + hexes', () => {
    const a = makeSubsector([makeHex(3, 4)])
    const b = makeSubsector([makeHex(3, 4)])
    expect(resolveHexName(a, { col: 3, row: 4 })).toBe(resolveHexName(b, { col: 3, row: 4 }))
  })

  it('prefers an explicit (imported) hex name over the generated one', () => {
    const sub = makeSubsector([makeHex(1, 1, 'Aramis')])
    expect(resolveHexName(sub, { col: 1, row: 1 })).toBe('Aramis')
  })

  it('gives every occupied hex a unique name across a full subsector', () => {
    const hexes: SubsectorHex[] = []
    for (let col = 1; col <= 8; col++) {
      for (let row = 1; row <= 10; row++) hexes.push(makeHex(col, row))
    }
    const names = [...subsectorHexNames(makeSubsector(hexes)).values()]
    expect(new Set(names).size).toBe(names.length)
  })
})
