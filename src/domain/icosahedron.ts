// Icosahedral (20-face) projection for the legacy 2d6-style world map.
//
// The icosahedron has 12 vertices arranged as a north pole, a south pole,
// a "north ring" of 5 vertices at lat ≈ +26.57° and a "south ring" of 5
// vertices at lat ≈ -26.57° (offset 36° in longitude from the north
// ring). Its 20 triangular faces fall into four bands:
//
//   * North cap (5 faces): NP + two adjacent north-ring vertices.
//   * North middle (5 faces): two north-ring vertices + one south-ring.
//   * South middle (5 faces): two south-ring vertices + one north-ring.
//   * South cap (5 faces): SP + two adjacent south-ring vertices.
//
// Net layout: each band becomes a row in a 5-column flat grid, so the
// net is a 5×4 rectangle of equilateral triangles. North-cap and
// south-middle rows are up-pointing; north-middle and south-cap rows
// are down-pointing. Adjacent rows share edges in the flat net (and on
// the icosahedron), so the heightmap projects continuously across
// those edges - which is what makes the wrap-around feel work.

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Vec2 {
  x: number
  y: number
}

export interface Face {
  /** Indices into the 12 icosahedron vertices, CCW from "first" vertex. */
  v: [number, number, number]
  /** True for up-pointing triangle in the flat net. */
  upPointing: boolean
  /** Column 0..4, row 0..3 in the flat net. */
  col: number
  row: number
}

export interface ProjectedFace {
  faceIdx: number
  /** Barycentric coords (u, v, w) inside the face triangle.
   *  Each is in [0, 1] and they sum to ~1. */
  u: number
  v: number
  w: number
}

const NORTH_LAT = Math.atan(0.5) // 26.565° - geometric latitude of the icosahedron's ring vertices

function sphericalToCart(latRad: number, lonRad: number): Vec3 {
  const cos = Math.cos(latRad)
  return {
    x: cos * Math.cos(lonRad),
    y: Math.sin(latRad),
    z: cos * Math.sin(lonRad),
  }
}

/** 12 icosahedron vertices on the unit sphere. Index layout:
 *    0 = north pole, 1 = south pole,
 *    2..6 = north ring (lon 0°, 72°, 144°, 216°, 288°),
 *    7..11 = south ring (lon 36°, 108°, 180°, 252°, 324°).
 *  Both rings start at their respective longitude offset and step
 *  around the planet by 72°. */
export const VERTICES_3D: readonly Vec3[] = (() => {
  const out: Vec3[] = []
  out.push({ x: 0, y: 0, z: 1 })  // north pole
  out.push({ x: 0, y: 0, z: -1 }) // south pole
  for (let i = 0; i < 5; i++) {
    const lon = (i * 72) * Math.PI / 180
    out.push(sphericalToCart(NORTH_LAT, lon))
  }
  for (let i = 0; i < 5; i++) {
    const lon = (i * 72 + 36) * Math.PI / 180
    out.push(sphericalToCart(-NORTH_LAT, lon))
  }
  return out
})()

function nIdx(col: number): number { return 2 + (col % 5) }
function sIdx(col: number): number { return 7 + (col % 5) }

/** 20 faces in the order: north-cap × 5, north-middle × 5,
 *  south-middle × 5, south-cap × 5. Column 0..4 matches the flat-net
 *  column. Vertex ordering inside `v` follows the upPointing convention
 *  used by `faceFlatVertices` below: index 0 is the apex of an
 *  up-pointing triangle (or the "left base" of a down-pointing one). */
export const FACES: readonly Face[] = (() => {
  const out: Face[] = []
  // Row 0: north cap (up-pointing). Apex = NP, base = (Ni, Ni+1).
  for (let col = 0; col < 5; col++) {
    out.push({ v: [0, nIdx(col), nIdx(col + 1)], upPointing: true, col, row: 0 })
  }
  // Row 1: north middle (down-pointing). Top edge = (Ni, Ni+1), apex = Si.
  for (let col = 0; col < 5; col++) {
    out.push({ v: [nIdx(col), nIdx(col + 1), sIdx(col)], upPointing: false, col, row: 1 })
  }
  // Row 2: south middle (up-pointing). Apex = Ni+1, base = (Si, Si+1).
  // We rotate vertices so index 0 is the apex (Ni+1) of the up-pointing
  // triangle for symmetry with row 0's NP-as-apex convention.
  for (let col = 0; col < 5; col++) {
    out.push({ v: [nIdx(col + 1), sIdx(col), sIdx(col + 1)], upPointing: true, col, row: 2 })
  }
  // Row 3: south cap (down-pointing). Top edge = (Si, Si+1), apex = SP.
  for (let col = 0; col < 5; col++) {
    out.push({ v: [sIdx(col), sIdx(col + 1), 1], upPointing: false, col, row: 3 })
  }
  return out
})()

// ---------- Flat-net layout ----------

/** Edge length of each flat triangle. Pick whatever pixel size suits
 *  the renderer; barycentric math is scale-invariant. */
export const TRI_SIDE = 200
export const TRI_HEIGHT = TRI_SIDE * Math.sqrt(3) / 2

export const NET_WIDTH = 5 * TRI_SIDE
export const NET_HEIGHT = 4 * TRI_HEIGHT

/** Returns the 3 flat-net vertices of `face`, with the same ordering
 *  as `face.v` (so vertex `face.v[k]` corresponds to flat point k). */
export function faceFlatVertices(face: Face): [Vec2, Vec2, Vec2] {
  const x0 = face.col * TRI_SIDE
  const y0 = face.row * TRI_HEIGHT
  if (face.upPointing) {
    return [
      { x: x0 + TRI_SIDE / 2, y: y0 },                 // apex
      { x: x0, y: y0 + TRI_HEIGHT },                   // bottom-left
      { x: x0 + TRI_SIDE, y: y0 + TRI_HEIGHT },        // bottom-right
    ]
  } else {
    return [
      { x: x0, y: y0 },                                // top-left
      { x: x0 + TRI_SIDE, y: y0 },                     // top-right
      { x: x0 + TRI_SIDE / 2, y: y0 + TRI_HEIGHT },    // apex (bottom)
    ]
  }
}

/** Cartesian-on-sphere vertices of `face`, paired with flat-net order. */
export function faceSphereVertices(face: Face): [Vec3, Vec3, Vec3] {
  return [VERTICES_3D[face.v[0]], VERTICES_3D[face.v[1]], VERTICES_3D[face.v[2]]]
}

// ---------- Projections ----------

/** Map a flat-net point (x, y) to a spherical point. Returns null if
 *  the point is outside the net (the zigzag region around the cells). */
export function netToSphere(x: number, y: number): { lat: number; lon: number; face: number } | null {
  const col = Math.floor(x / TRI_SIDE)
  const row = Math.floor(y / TRI_HEIGHT)
  if (col < 0 || col >= 5 || row < 0 || row >= 4) return null
  const faceIdx = row * 5 + col
  const face = FACES[faceIdx]
  const flat = faceFlatVertices(face)
  const bary = barycentric2D({ x, y }, flat[0], flat[1], flat[2])
  if (bary.u < 0 || bary.v < 0 || bary.w < 0) return null
  const sph = faceSphereVertices(face)
  const p = barycentricMix3D(bary, sph[0], sph[1], sph[2])
  const len = Math.hypot(p.x, p.y, p.z) || 1
  const nx = p.x / len, ny = p.y / len, nz = p.z / len
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, ny))),
    lon: Math.atan2(nz, nx),
    face: faceIdx,
  }
}

/** Map a spherical point (lat, lon in radians) to a flat-net point.
 *  Walks the 20 faces and picks the one whose spherical triangle
 *  contains the point (positive barycentric coords on the sphere). */
export function sphereToNet(latRad: number, lonRad: number): { x: number; y: number; faceIdx: number } {
  const p = sphericalToCart(latRad, lonRad)
  let bestFace = 0
  let bestSum = -Infinity
  let bestBary = { u: 0, v: 0, w: 0 }
  for (let i = 0; i < FACES.length; i++) {
    const sph = faceSphereVertices(FACES[i])
    const b = sphericalBarycentric(p, sph[0], sph[1], sph[2])
    // Smallest negative coordinate measures how far outside this face
    // the point is; the face with the highest min-coord wins.
    const minC = Math.min(b.u, b.v, b.w)
    if (minC > bestSum) {
      bestSum = minC
      bestFace = i
      bestBary = b
    }
  }
  // Normalise so the three coords sum to 1 (they almost do already
  // because we recover a sphere point from a sphere triangle).
  const s = bestBary.u + bestBary.v + bestBary.w
  if (s !== 0) {
    bestBary = { u: bestBary.u / s, v: bestBary.v / s, w: bestBary.w / s }
  }
  const flat = faceFlatVertices(FACES[bestFace])
  const pt = {
    x: flat[0].x * bestBary.u + flat[1].x * bestBary.v + flat[2].x * bestBary.w,
    y: flat[0].y * bestBary.u + flat[1].y * bestBary.v + flat[2].y * bestBary.w,
  }
  return { x: pt.x, y: pt.y, faceIdx: bestFace }
}

// ---------- Helpers ----------

interface Bary {
  u: number
  v: number
  w: number
}

function barycentric2D(p: Vec2, a: Vec2, b: Vec2, c: Vec2): Bary {
  const v0x = b.x - a.x, v0y = b.y - a.y
  const v1x = c.x - a.x, v1y = c.y - a.y
  const v2x = p.x - a.x, v2y = p.y - a.y
  const den = v0x * v1y - v1x * v0y
  if (Math.abs(den) < 1e-9) return { u: -1, v: -1, w: -1 }
  const v = (v2x * v1y - v1x * v2y) / den
  const w = (v0x * v2y - v2x * v0y) / den
  const u = 1 - v - w
  return { u, v, w }
}

function barycentricMix3D(b: Bary, a: Vec3, b1: Vec3, c: Vec3): Vec3 {
  return {
    x: a.x * b.u + b1.x * b.v + c.x * b.w,
    y: a.y * b.u + b1.y * b.v + c.y * b.w,
    z: a.z * b.u + b1.z * b.v + c.z * b.w,
  }
}

/** Barycentric coords of a unit-sphere point P with respect to a
 *  spherical triangle (A, B, C). Uses the planar barycentric on the
 *  triangle in 3-space and signed by face normal. Negative coords
 *  mean the point is outside the triangle. */
function sphericalBarycentric(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Bary {
  const ax = b.x - a.x, ay = b.y - a.y, az = b.z - a.z
  const bx = c.x - a.x, by = c.y - a.y, bz = c.z - a.z
  const nx = ay * bz - az * by
  const ny = az * bx - ax * bz
  const nz = ax * by - ay * bx
  const nlen2 = nx * nx + ny * ny + nz * nz
  // Project p onto the triangle plane. (Sphere points are close to
  // the plane anyway since the icosahedron's faces inscribe the
  // sphere; the projection is a small correction.)
  const dotAP = (p.x - a.x) * nx + (p.y - a.y) * ny + (p.z - a.z) * nz
  const px = p.x - nx * dotAP / nlen2
  const py = p.y - ny * dotAP / nlen2
  const pz = p.z - nz * dotAP / nlen2
  // Plane barycentric via 3-vec cross products.
  const v0x = px - a.x, v0y = py - a.y, v0z = pz - a.z
  // u-coord = area(P, B, C) / area(A, B, C), using signed-area via
  // cross-product with the face normal.
  const c1x = ay * v0z - az * v0y
  const c1y = az * v0x - ax * v0z
  const c1z = ax * v0y - ay * v0x
  const w = (c1x * nx + c1y * ny + c1z * nz) / nlen2
  const c2x = v0y * bz - v0z * by
  const c2y = v0z * bx - v0x * bz
  const c2z = v0x * by - v0y * bx
  const v = (c2x * nx + c2y * ny + c2z * nz) / nlen2
  const u = 1 - v - w
  return { u, v, w }
}

// ---------- Subdivision: per-face hex grid ----------

/** A point on a face's subdivided triangular grid.
 *  i, j are barycentric subdivision coords in [0, N]; i + j <= N.
 *  The third coord is N - i - j. */
export interface SubCell {
  faceIdx: number
  i: number
  j: number
}

/** Iterate the subdivided triangular grid on every face. For
 *  subdivision level N, each face has N² sub-triangles, of which
 *  N²−... are up-pointing inside the parent. Each sub-cell yields its
 *  centroid in 3D (on the unit sphere) and 2D (in the flat net) plus
 *  an `subUp` flag identifying which sub-triangle orientation it is,
 *  so callers can rotate or shade differently if they want. */
export function* iterFaceSubCells(
  N: number,
): Generator<SubCell & { center3D: Vec3; flat: Vec2; subUp: boolean }> {
  for (let f = 0; f < FACES.length; f++) {
    const face = FACES[f]
    const flat = faceFlatVertices(face)
    const sph = faceSphereVertices(face)
    for (let row = 0; row < N; row++) {
      for (let col = 0; col + row < N; col++) {
        // Up-pointing sub-triangle - always exists inside the parent.
        const upBary = {
          u: 1 - (col + 1/3) / N - (row + 1/3) / N,
          v: (col + 1/3) / N,
          w: (row + 1/3) / N,
        }
        yield emitCell(f, col, row, true, upBary, flat, sph)
        // Down-pointing sub-triangle only exists when there's room
        // for a full sub-triangle to its right + above.
        if (col + row + 1 < N) {
          const downBary = {
            u: 1 - (col + 2/3) / N - (row + 2/3) / N,
            v: (col + 2/3) / N,
            w: (row + 2/3) / N,
          }
          yield emitCell(f, col, row, false, downBary, flat, sph)
        }
      }
    }
  }
}

function emitCell(
  f: number,
  col: number,
  row: number,
  subUp: boolean,
  bary: { u: number; v: number; w: number },
  flat: [Vec2, Vec2, Vec2],
  sph: [Vec3, Vec3, Vec3],
): SubCell & { center3D: Vec3; flat: Vec2; subUp: boolean } {
  return {
    faceIdx: f,
    i: col,
    j: row,
    subUp,
    center3D: normalise({
      x: sph[0].x * bary.u + sph[1].x * bary.v + sph[2].x * bary.w,
      y: sph[0].y * bary.u + sph[1].y * bary.v + sph[2].y * bary.w,
      z: sph[0].z * bary.u + sph[1].z * bary.v + sph[2].z * bary.w,
    }),
    flat: {
      x: flat[0].x * bary.u + flat[1].x * bary.v + flat[2].x * bary.w,
      y: flat[0].y * bary.u + flat[1].y * bary.v + flat[2].y * bary.w,
    },
  }
}

function normalise(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

/** Convert a unit-sphere position to (latRad, lonRad). */
export function cartToSpherical(v: Vec3): { lat: number; lon: number } {
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, v.y))),
    lon: Math.atan2(v.z, v.x),
  }
}
