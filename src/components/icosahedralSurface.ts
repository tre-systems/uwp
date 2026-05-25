// Build the pickable hex lattice for the icosahedral Surface map:
// subdivide each of the 20 icosahedron faces N times, sample the Rust
// pre-bake at each triangular subcell centre, classify terrain using
// the same elevation / latitude / temperature rules the Rust path
// uses, and pack those centre points for the SVG hex renderer.

import type { PreBake } from './surfaceMapBackground'
import {
  NET_HEIGHT,
  NET_WIDTH,
  netToSphere,
  TRI_SIDE,
} from '../domain/icosahedron'
import type { Terrain } from '../domain/surfaceMap'

export interface IcosaHex {
  /** Flat-net pixel position of this hex cell's centre. */
  x: number
  y: number
  /** Sphere position in degrees, for tooltips / region drill-down. */
  latDeg: number
  lonDeg: number
  /** Terrain classification matching the Rust classifier. */
  terrain: Terrain
  /** Local temperature in Kelvin (mean - lat gradient). */
  temperatureK: number
  /** Signed elevation in [-1, 1] sampled from the pre-bake. */
  elevation: number
  /** Which of the 20 faces this hex belongs to. */
  faceIdx: number
  /** True for the up-pointing source sub-triangle, false for down. */
  upPointing: boolean
}

export interface IcosaSurface {
  hexes: IcosaHex[]
  seaLevel: number
  /** Pointy-top hex circumradius in flat-net pixels. */
  hexRadius: number
  /** Subdivision level used. */
  subdivisions: number
}

export interface BuildOptions {
  prebake: PreBake
  /** [0, 1] target ocean coverage; sea level is the quantile of all
   *  sub-cell elevations matching this fraction (matches the Rust
   *  surface_map's sea-level pass). */
  waterFraction: number
  /** [0, 1] fraction of polar caps that should be ice. */
  iceFraction: number
  /** Mean surface temperature in Kelvin. Local temperature drops with
   *  latitude using the same 60 K equator-to-pole spread as Rust. */
  meanTempK: number
  /** Subdivision per face. N=8 gives 1280 world-level hex cells and
   *  matches the classic "triangle side size" idea used by legacy 2d6-
   *  style icosahedral maps. */
  subdivisions: number
}

export function buildIcosahedralSurface(opts: BuildOptions): IcosaSurface {
  const N = Math.max(2, Math.min(16, Math.floor(opts.subdivisions)))
  const hexes: IcosaHex[] = []
  // First pass: collect every sub-cell with sampled elevation. We
  // need every elevation before we can pick the sea-level quantile,
  // so the actual terrain classification happens in pass 2.
  type Raw = { x: number; y: number; latRad: number; lonRad: number; elev: number; faceIdx: number; upPointing: boolean }
  const raws: Raw[] = []

  // A classic legacy 2d6-style icosahedral world map uses pointy-top
  // hexes clipped by the unfolded d20 faces. `N` is the approximate
  // number of hex columns across a face edge.
  const hexRadius = TRI_SIDE / (N * Math.sqrt(3))
  const xStep = Math.sqrt(3) * hexRadius
  const yStep = 1.5 * hexRadius
  let row = 0
  for (let y = hexRadius; y <= NET_HEIGHT + hexRadius; y += yStep, row++) {
    const xOffset = (row % 2) * xStep * 0.5
    for (let x = xOffset; x <= NET_WIDTH + xStep; x += xStep) {
      const projected = netToSphere(x, y)
      if (!projected) continue
      const elev = samplePrebake(opts.prebake, projected.lat, projected.lon)
      raws.push({
        x,
        y,
        latRad: projected.lat,
        lonRad: projected.lon,
        elev,
        faceIdx: projected.face,
        upPointing: row % 2 === 0,
      })
    }
  }

  // Compute sea level as the quantile across every sampled elevation
  // (matches Rust surface_map.rs's quantile-based pass).
  const elevs = raws.map((r) => r.elev).sort((a, b) => a - b)
  const targetBelow = Math.max(0, Math.min(elevs.length - 1, Math.floor(opts.waterFraction * elevs.length)))
  const seaLevel = elevs[targetBelow] ?? 0

  // Pass 2: classify.
  for (const r of raws) {
    const latDeg = r.latRad * 180 / Math.PI
    const lonDeg = r.lonRad * 180 / Math.PI
    const absLat = Math.abs(latDeg) / 90
    const localT = opts.meanTempK - 60 * Math.max(0, absLat - 0.4)
    const terrain = classify({
      elevSigned: r.elev,
      seaLevel,
      absLat,
      iceFraction: opts.iceFraction,
      localT,
      water: opts.waterFraction,
      faceIdx: r.faceIdx,
    })
    hexes.push({
      x: r.x,
      y: r.y,
      latDeg,
      lonDeg,
      terrain,
      temperatureK: localT,
      elevation: r.elev,
      faceIdx: r.faceIdx,
      upPointing: r.upPointing,
    })
  }

  return {
    hexes,
    seaLevel,
    hexRadius,
    subdivisions: N,
  }
}

// ---------- Pre-bake sampling ----------

function samplePrebake(prebake: PreBake, latRad: number, lonRad: number): number {
  const lonCells = prebake.lon_cells
  const latCells = prebake.lat_cells
  const heightmap = prebake.heightmap instanceof Float32Array
    ? prebake.heightmap
    : Float32Array.from(prebake.heightmap)
  // Rust convention: lat_norm 0 = south pole, 1 = north pole;
  // lon_norm wraps 0..1 around the planet starting at lon=0 (positive x).
  const latNorm = (latRad / Math.PI) + 0.5
  const lonNorm = (lonRad / (2 * Math.PI)) + 0.5  // shift so [-π, π] → [0, 1]
  const lat = Math.max(0, Math.min(1, latNorm)) * (latCells - 1)
  const lon = ((lonNorm % 1) + 1) % 1 * lonCells
  const i0 = Math.floor(lat)
  const i1 = Math.min(i0 + 1, latCells - 1)
  const j0 = Math.floor(lon) % lonCells
  const j1 = (j0 + 1) % lonCells
  const fi = lat - i0
  const fj = lon - Math.floor(lon)
  const h00 = heightmap[i0 * lonCells + j0]
  const h01 = heightmap[i0 * lonCells + j1]
  const h10 = heightmap[i1 * lonCells + j0]
  const h11 = heightmap[i1 * lonCells + j1]
  const h0 = h00 * (1 - fj) + h01 * fj
  const h1 = h10 * (1 - fj) + h11 * fj
  return h0 * (1 - fi) + h1 * fi
}

// ---------- Terrain classifier (ported from Rust) ----------

interface ClassifyInput {
  elevSigned: number
  seaLevel: number
  absLat: number     // 0..1, 1 at the pole
  iceFraction: number
  localT: number
  water: number
  faceIdx: number
}

const FREEZE = 273.15

function classify(c: ClassifyInput): Terrain {
  // Polar ice rises with the global ice fraction (same envelope as Rust).
  const iceBand = 1.0 - Math.max(0, Math.min(0.8, c.iceFraction)) * 0.55
  if (c.absLat > iceBand) {
    return 'Ice'
  }
  if (c.elevSigned < c.seaLevel) {
    return 'Ocean'
  }
  if (Math.abs(c.elevSigned - c.seaLevel) < 0.06 && c.water > 0.1) {
    return 'Shoreline'
  }
  // Elevation classes.
  if (c.elevSigned > c.seaLevel + 0.55) return 'Mountain'
  if (c.elevSigned > c.seaLevel + 0.30) return 'Hill'
  // Climate-driven biomes.
  if (c.localT < FREEZE + 5.0) return 'Tundra'
  if (c.localT > FREEZE + 35.0 && c.water < 0.30) return 'Desert'
  const speckle = hashFloat(c.faceIdx * 9973 + Math.round((c.elevSigned + 1) * 1000))
  if (
    c.water > 0.20 &&
    c.localT >= FREEZE + 5.0 &&
    c.localT < FREEZE + 38.0 &&
    (c.elevSigned > c.seaLevel + 0.10 || speckle > 0.55)
  ) {
    return 'Forest'
  }
  return 'Plain'
}

function hashFloat(x: number): number {
  let h = (x | 0) >>> 0
  h = ((h ^ (h >>> 16)) * 0x85ebca6b) >>> 0
  h = ((h ^ (h >>> 13)) * 0xc2b2ae35) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return h / 0xffffffff
}
