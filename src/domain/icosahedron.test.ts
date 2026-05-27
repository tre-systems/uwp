import { describe, expect, it } from 'vitest'
import {
  FACES,
  faceFlatVertices,
  iterFaceSubCells,
  netToSphere,
  TRI_HEIGHT,
  TRI_SIDE,
} from './icosahedron'

describe('icosahedral surface net', () => {
  it('uses a connected cap-belt-cap net instead of a holed face grid', () => {
    for (let col = 0; col < 5; col++) {
      expect(sharedEdge(0 + col, 5 + col)).toBe(true)
      expect(sharedEdge(5 + col, 10 + col)).toBe(true)
      expect(sharedEdge(10 + col, 15 + col)).toBe(true)
      if (col < 4) {
        expect(sharedEdge(10 + col, 6 + col)).toBe(true)
      }
    }
  })

  it('projects every face centroid back onto its own face', () => {
    for (let i = 0; i < FACES.length; i++) {
      const [a, b, c] = faceFlatVertices(FACES[i])
      const p = {
        x: (a.x + b.x + c.x) / 3,
        y: (a.y + b.y + c.y) / 3,
      }
      expect(netToSphere(p.x, p.y)?.face).toBe(i)
    }
  })

  it('has no old diamond-hole centre in the equatorial belt', () => {
    // In the old 5x4 layout this point sat in the large black diamond
    // between four isolated face tiles. In the connected classic 2d6
    // strip it is inside the equatorial belt.
    expect(netToSphere(2.75 * TRI_SIDE, 1.5 * TRI_HEIGHT)).not.toBeNull()
  })

  it('spaces sub-cell centroids for a non-overlapping hex lattice', () => {
    const subdivisions = 8
    const cells = [...iterFaceSubCells(subdivisions)]
    expect(cells).toHaveLength(20 * subdivisions * subdivisions)

    const up = cells.find((c) => c.faceIdx === 0 && c.i === 0 && c.j === 0 && c.subUp)
    const down = cells.find((c) => c.faceIdx === 0 && c.i === 0 && c.j === 0 && !c.subUp)
    expect(up).toBeDefined()
    expect(down).toBeDefined()

    const centreDistance = Math.hypot(up!.flat.x - down!.flat.x, up!.flat.y - down!.flat.y)
    const hexRadius = (TRI_SIDE / subdivisions) / 3
    expect(centreDistance).toBeCloseTo(Math.sqrt(3) * hexRadius, 6)
  })
})

function sharedEdge(aIdx: number, bIdx: number): boolean {
  const a = faceFlatVertices(FACES[aIdx])
  const b = faceFlatVertices(FACES[bIdx])
  let matches = 0
  for (const pa of a) {
    if (b.some((pb) => samePoint(pa, pb))) matches++
  }
  return matches === 2
}

function samePoint(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6
}
