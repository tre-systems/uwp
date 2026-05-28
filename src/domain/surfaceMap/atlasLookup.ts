import { netToFaceBary } from '../icosahedron'
import type { SurfaceAtlas, SurfaceAtlasCell } from './types'

export type SurfaceAtlasLookup = Map<string, SurfaceAtlasCell>

export function buildSurfaceAtlasLookup(atlas: SurfaceAtlas): SurfaceAtlasLookup {
  const out: SurfaceAtlasLookup = new Map()
  for (const cell of atlas.cells) {
    out.set(surfaceAtlasCellKey(cell.id.resolution, cell.id.face, cell.id.i, cell.id.j, cell.id.up), cell)
  }
  return out
}

export function surfaceAtlasCellAtNetPoint(
  atlas: SurfaceAtlas,
  cellsById: SurfaceAtlasLookup,
  netX: number,
  netY: number,
): SurfaceAtlasCell | null {
  const bary = netToFaceBary(netX, netY)
  if (!bary) return null

  const n = Math.max(2, Math.trunc(atlas.resolution))
  const eps = 1e-6
  let v = clamp(bary.v * n, 0, n - eps)
  let w = clamp(bary.w * n, 0, n - eps)

  // Points exactly on the outer face edge can produce v + w == n.
  // Pull them infinitesimally inside so they resolve to the boundary cell
  // instead of missing the atlas lookup.
  if (v + w >= n) {
    const scale = (n - eps) / Math.max(v + w, eps)
    v *= scale
    w *= scale
  }

  let i = Math.floor(v)
  let j = Math.floor(w)
  if (i + j >= n) {
    if (i > j) i = Math.max(0, n - j - 1)
    else j = Math.max(0, n - i - 1)
  }

  const localV = v - i
  const localW = w - j
  let up = localV + localW <= 1
  if (!up && i + j + 1 >= n) up = true

  return (
    cellsById.get(surfaceAtlasCellKey(n, bary.faceIdx, i, j, up)) ??
    cellsById.get(surfaceAtlasCellKey(n, bary.faceIdx, i, j, true)) ??
    null
  )
}

export function surfaceAtlasCellKey(
  resolution: number,
  face: number,
  i: number,
  j: number,
  up: boolean,
): string {
  return `${resolution}:${face}:${i}:${j}:${up ? 1 : 0}`
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}
