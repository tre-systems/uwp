import { describe, expect, it } from 'vitest'
import { NET_HEIGHT, NET_WIDTH, TRI_SIDE } from '../domain/icosahedron'
import { buildIcosahedralSurface } from './icosahedralSurface'

describe('icosahedral surface cells', () => {
  it('builds pointy-top cells inside the unfolded icosahedral net', () => {
    const subdivisions = 8
    const surface = buildIcosahedralSurface({
      prebake: flatPrebake(),
      waterFraction: 0.6,
      iceFraction: 0.2,
      meanTempK: 288,
      subdivisions,
    })

    expect(surface.hexRadius).toBeCloseTo(TRI_SIDE / (2 * subdivisions * Math.sqrt(3)), 6)
    expect(surface.hexes.length).toBeGreaterThan(20 * subdivisions)
    for (const hex of surface.hexes) {
      expect(hex.x).toBeGreaterThanOrEqual(0)
      expect(hex.x).toBeLessThanOrEqual(NET_WIDTH)
      expect(hex.y).toBeGreaterThanOrEqual(0)
      expect(hex.y).toBeLessThanOrEqual(NET_HEIGHT)
      expect(hex.faceIdx).toBeGreaterThanOrEqual(0)
      expect(hex.faceIdx).toBeLessThan(20)
      expect(Number.isFinite(hex.latDeg)).toBe(true)
      expect(Number.isFinite(hex.lonDeg)).toBe(true)
    }
  })

  it('normalises plain JS height arrays once and still produces finite terrain', () => {
    const surface = buildIcosahedralSurface({
      prebake: {
        lon_cells: 4,
        lat_cells: 2,
        heightmap: [-0.5, -0.2, 0.2, 0.5, -0.4, -0.1, 0.3, 0.6],
      },
      waterFraction: 0.5,
      iceFraction: 0,
      meanTempK: 288,
      subdivisions: 4,
    })

    expect(surface.hexes.length).toBeGreaterThan(0)
    expect(surface.hexes.every((hex) => Number.isFinite(hex.elevation))).toBe(true)
  })
})

function flatPrebake() {
  return {
    lon_cells: 8,
    lat_cells: 4,
    heightmap: new Float32Array(32),
  }
}
