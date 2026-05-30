import { describe, expect, it } from 'vitest'
import { parseSectorData } from './import'
import { SAMPLE_SECTOR_TEXT } from './sampleData'
import { uwpToCode } from './types'

// T5SS tab-delimited sample (Spinward Marches A, abridged), tabs explicit.
const TAB_HEADER = [
  'Sector', 'SS', 'Hex', 'Name', 'UWP', 'Bases', 'Remarks', 'Zone', 'PBG',
  'Allegiance', 'Stars', '{Ix}', '(Ex)', '[Cx]', 'Nobility', 'W', 'RU',
].join('\t')

function tabRow(hex: string, name: string, uwp: string, bases: string, remarks: string, zone: string, pbg: string, alleg: string): string {
  return ['Spin', 'A', hex, name, uwp, bases, remarks, zone, pbg, alleg, 'K9 V', '{ 0 }', '(000+0)', '[0000]', '', '8', '0'].join('\t')
}

const TAB_SAMPLE = [
  '# Spinward Marches / A',
  TAB_HEADER,
  tabRow('0101', 'Zeycude', 'C430698-9', '', 'De Na Ni Po', '', '613', 'ZhIN'),
  tabRow('0102', 'Reno', 'C4207B9-A', '', 'De He Na Po Pi', 'A', '603', 'ZhIN'),
  tabRow('0103', 'Errere', 'B563664-B', 'KM', 'Ni Ri', '', '910', 'ZhIN'),
].join('\n')

// Build a classic `.sec` line by placing each field at its 1-based column.
function secLine(name: string, hex: string, uwp: string, bases: string, codes: string, zone: string, pbg: string, alleg: string): string {
  const buf = ' '.repeat(64).split('')
  const put = (s: string, start: number) => {
    for (let i = 0; i < s.length; i++) buf[start - 1 + i] = s[i]
  }
  put(name, 1)
  put(hex, 15)
  put(uwp, 20)
  put(bases, 31)
  put(codes, 33)
  put(zone, 49)
  put(pbg, 52)
  put(alleg, 56)
  return buf.join('').trimEnd()
}

describe('parseSectorData — T5SS tab', () => {
  it('imports tab-delimited worlds with decoded fields', () => {
    const { subsector, errors, worldCount, format } = parseSectorData(TAB_SAMPLE)
    expect(format).toBe('tab')
    expect(errors).toEqual([])
    expect(worldCount).toBe(3)
    expect(subsector).not.toBeNull()
    const sub = subsector!

    // All three sit in subsector A → a single 8×10 grid.
    expect(sub.columns).toBe(8)
    expect(sub.rows).toBe(10)
    expect(sub.subsectors).toHaveLength(1)
    expect(sub.subsectors?.[0].letter).toBe('A')

    const reno = sub.hexes.find((h) => h.coord.col === 1 && h.coord.row === 2)!
    expect(reno.name).toBe('Reno')
    expect(uwpToCode(reno.uwp)).toBe('C4207B9-A')
    expect(reno.travel_zone).toBe('Amber')
    expect(reno.pbg).toEqual({ population_multiplier: 6, belts: 0, gas_giants: 3 })

    const errere = sub.hexes.find((h) => h.coord.col === 1 && h.coord.row === 3)!
    expect(errere.bases.naval).toBe(true) // 'K' (naval) in "KM"
    expect(errere.allegiance).toBe('ZhIN')
  })

  it('skips malformed lines but imports the rest', () => {
    const text = [
      TAB_HEADER,
      tabRow('0101', 'Good', 'C430698-9', '', '', '', '613', 'ZhIN'),
      tabRow('zz01', 'BadHex', 'C430698-9', '', '', '', '613', 'ZhIN'),
      tabRow('0103', 'BadUwp', 'NOTUWP', '', '', '', '613', 'ZhIN'),
    ].join('\n')
    const { subsector, errors, worldCount } = parseSectorData(text)
    expect(worldCount).toBe(1)
    expect(subsector!.hexes[0].name).toBe('Good')
    expect(errors).toHaveLength(2)
    expect(errors.map((e) => e.reason).join(' ')).toMatch(/hex|UWP/i)
  })

  it('detects a full sector when coordinates spread past one subsector', () => {
    const text = [
      TAB_HEADER,
      tabRow('0101', 'A1', 'C430698-9', '', '', '', '613', 'ImDi'),
      tabRow('3240', 'P80', 'A788899-C', '', '', '', '113', 'CsLe'),
    ].join('\n')
    const { subsector } = parseSectorData(text)
    expect(subsector!.columns).toBe(32)
    expect(subsector!.rows).toBe(40)
    expect(subsector!.subsectors).toHaveLength(16)
    expect(subsector!.allegiances.map((a) => a.code).sort()).toEqual(['CsLe', 'ImDi'])
  })
})

describe('parseSectorData — classic .sec', () => {
  it('imports column-aligned worlds after a legend block', () => {
    const text = [
      ' 1-14: Name',
      '15-18: HexNbr',
      '',
      secLine('Zeycude', '0101', 'C430698-9', '', 'De Na Ni Po', '', '613', 'Zh'),
      secLine('Reno', '0102', 'C4207B9-A', '', 'De He Na Po Pi', 'A', '603', 'Zh'),
    ].join('\n')
    const { subsector, errors, worldCount, format } = parseSectorData(text)
    expect(format).toBe('sec')
    expect(errors).toEqual([])
    expect(worldCount).toBe(2)
    const zeycude = subsector!.hexes.find((h) => h.coord.col === 1 && h.coord.row === 1)!
    expect(zeycude.name).toBe('Zeycude')
    expect(uwpToCode(zeycude.uwp)).toBe('C430698-9')
    const reno = subsector!.hexes.find((h) => h.coord.col === 1 && h.coord.row === 2)!
    expect(reno.travel_zone).toBe('Amber')
  })
})

describe('SAMPLE_SECTOR_TEXT', () => {
  it('is a valid paste-ready 7-world subsector (doc + Load sample stay honest)', () => {
    const { subsector, errors, worldCount, format } = parseSectorData(SAMPLE_SECTOR_TEXT)
    expect(format).toBe('tab')
    expect(errors).toEqual([])
    expect(worldCount).toBe(7)
    const sub = subsector!
    expect(sub.columns).toBe(8)
    expect(sub.rows).toBe(10)
    expect(sub.subsectors).toHaveLength(1)

    const ennis = sub.hexes.find((h) => h.coord.col === 5 && h.coord.row === 2)!
    expect(ennis.name).toBe('Ennis')
    expect(ennis.travel_zone).toBe('Red')

    const gesh = sub.hexes.find((h) => h.coord.col === 7 && h.coord.row === 4)!
    expect(uwpToCode(gesh.uwp)).toBe('B6747A9-A')
    expect(gesh.allegiance).toBe('Fd')
    // Two distinct allegiances → two synthesized polities.
    expect(sub.allegiances.map((a) => a.code).sort()).toEqual(['Fd', 'Na'])
  })
})

describe('parseSectorData — empty/garbage', () => {
  it('returns no subsector and reports nothing parseable', () => {
    const { subsector, worldCount } = parseSectorData('just some\nrandom text\n')
    expect(subsector).toBeNull()
    expect(worldCount).toBe(0)
  })
})
