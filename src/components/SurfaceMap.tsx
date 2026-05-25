import {
  currentSystem,
  getSurfacePrebake,
  openRegionView,
  params,
  selectAndFocusSurfaceHex,
  selectedSurfaceHex,
} from '../appState'
import {
  hexCoordLabel,
  terrainLabel,
  type SurfaceMap as SurfaceMapDTO,
  type Settlement,
  type SurfaceHexCoord,
  type Terrain,
} from '../domain/surfaceMap'
import { systemName } from '../domain/names'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useMapGestures } from './useMapGestures'
import { renderSurfaceBackground } from './surfaceMapBackground'
import { buildIcosahedralSurface, type IcosaHex } from './icosahedralSurface'
import {
  FACES,
  faceFlatVertices,
  NET_HEIGHT,
  NET_WIDTH,
  sphereToNet,
} from '../domain/icosahedron'

// Cepheus / legacy 2d6-style icosahedral surface map.
//
// The world is laid out as a flat net of the 20 triangular faces of an
// icosahedron (5 columns × 4 rows). The background image is the Rust
// pre-bake projected through that same net, so continents wrap
// continuously across fold lines. Each face is subdivided N times
// into smaller triangles; each sub-triangle becomes one hex on the
// map. Hexes near triangle edges may straddle fold lines visually -
// that's intrinsic to an icosahedral net, and matches the canonical
// legacy 2d6 world maps.

const SUBDIVISIONS = 8

// SVG viewBox matches the net's intrinsic geometry; gestures and the
// background `<image>` ride the same coordinate system.
const SVG_W = NET_WIDTH
const SVG_H = NET_HEIGHT

interface SurfaceMapProps {
  map: SurfaceMapDTO | null
}

export function SurfaceMap({ map }: SurfaceMapProps) {
  const system = currentSystem.value
  const containerRef = useRef<HTMLDivElement>(null)
  const gestures = useMapGestures(containerRef, SVG_W, SVG_H)

  const seaLevelParam = params.value.sea_level
  const iceLatitudeDeg = params.value.ice_latitude * 90
  const mainWorld = system && system.main_world >= 0 ? system.planets[system.main_world] ?? null : null
  const meanTempK = mainWorld?.climate.mean_surface_temp_k ?? mainWorld?.temperature_k ?? 288
  const iceFraction = mainWorld?.climate.ice_fraction ?? 0.0

  // Rebuild the icosahedral hex set whenever the inputs that drive
  // terrain / sea level / temperature change. Done synchronously in a
  // useMemo so the UI repaints atomically.
  const surface = useMemo(() => {
    if (!map) return null
    const prebake = getSurfacePrebake()
    if (!prebake) return null
    return buildIcosahedralSurface({
      prebake,
      waterFraction: seaLevelParam,
      iceFraction,
      meanTempK,
      subdivisions: SUBDIVISIONS,
    })
  }, [map?.seed, seaLevelParam, iceFraction, meanTempK])

  // Rendered background, recomputed alongside the surface.
  const [bgUrl, setBgUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!map) { setBgUrl(null); return }
    const prebake = getSurfacePrebake()
    if (!prebake) { setBgUrl(null); return }
    const url = renderSurfaceBackground(prebake, {
      waterFraction: seaLevelParam,
      iceLatitudeDeg,
      meanTempK,
      width: 1024,
    })
    setBgUrl(url)
  }, [map?.seed, seaLevelParam, iceLatitudeDeg, meanTempK])

  if (!map) {
    return (
      <div class="surface-map surface-empty">
        <p>No main world available — generate a habitable system first.</p>
      </div>
    )
  }

  const sel = selectedSurfaceHex.value
  // Project the Rust DTO's settlements + starport through the
  // icosahedron so they land on the new net. coord (col, row) maps
  // back to (lat, lon) via the same convention surface_map.rs uses.
  const cityPoints = map.cities.map((s) => projectCity(s, map.seed))
  const starportPoint = map.starport ? projectStarport(map.starport) : null

  return (
    <div
      class="surface-map"
      role="region"
      aria-label={`Surface map, ${(map.ocean_fraction * 100).toFixed(0)}% ocean`}
      ref={containerRef}
      onWheel={gestures.handlers.onWheel as unknown as preact.JSX.WheelEventHandler<HTMLDivElement>}
      onPointerDown={gestures.handlers.onPointerDown as unknown as preact.JSX.PointerEventHandler<HTMLDivElement>}
      onPointerMove={gestures.handlers.onPointerMove as unknown as preact.JSX.PointerEventHandler<HTMLDivElement>}
      onPointerUp={gestures.handlers.onPointerUp as unknown as preact.JSX.PointerEventHandler<HTMLDivElement>}
      onPointerCancel={gestures.handlers.onPointerCancel as unknown as preact.JSX.PointerEventHandler<HTMLDivElement>}
    >
      <svg viewBox={gestures.viewBox} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Surface hex grid (icosahedral net)">
        {/* Background: icosahedral projection of the prebake. Sits
            behind everything and rides the SVG viewBox. */}
        {bgUrl && (
          <image
            href={bgUrl}
            x={0}
            y={0}
            width={SVG_W}
            height={SVG_H}
            preserveAspectRatio="none"
            class="surface-bg-image"
            aria-hidden="true"
          />
        )}
        {/* Hex sub-cells. Each is a small flat-top hex centred on the
            sub-triangle centroid; size matches the sub-triangle so
            adjacent hexes interlock cleanly within a face. */}
        {surface && surface.hexes.map((h, i) => (
          <SubHex
            key={i}
            hex={h}
            cellSize={surface.cellSize}
            selected={!!sel && coordOfHex(h) === coordOfSel(sel)}
          />
        ))}
        {/* Fold lines: heavy strokes along every triangle edge. */}
        <FoldLines />
        {/* Settlement / starport markers + labels, projected through
            the icosahedron from their original lat/lon. */}
        {starportPoint && <StarportMarker x={starportPoint.x} y={starportPoint.y} />}
        {cityPoints.map((p, i) => (
          <CityMarker key={i} x={p.x} y={p.y} tier={p.tier} name={p.name} />
        ))}
      </svg>
    </div>
  )
}

// ---------- sub-hex cell ----------

interface SubHexProps {
  hex: IcosaHex
  cellSize: number
  selected: boolean
}

function SubHex({ hex, cellSize, selected }: SubHexProps) {
  // Hex radius set so the cell footprint covers roughly a sub-triangle.
  // The 0.62 factor was eyeballed to make adjacent hexes touch without
  // big overlaps on the up/down-pointing alternation.
  const r = cellSize * 0.62
  const terrainClass = hex.terrain.toLowerCase()
  const label = `${hex.terrain} · ${hex.latDeg.toFixed(1)}°`
  const coord: SurfaceHexCoord = {
    col: Math.round(hex.lonDeg * 32 / 360 + 16),
    row: Math.round(hex.latDeg * 16 / 180 + 8),
  }
  return (
    <g
      class={`surface-hex surface-${terrainClass}${selected ? ' surface-selected' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={() => selectAndFocusSurfaceHex(coord)}
      onDblClick={() => openRegionView(coord)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          selectAndFocusSurfaceHex(coord)
        }
      }}
    >
      <path d={hexPath(hex.x, hex.y, r)} class="surface-hex-shape" fill={terrainFill(hex.terrain)} />
      {terrainGlyph(hex.terrain) && (
        <text x={hex.x} y={hex.y + 3} class="surface-glyph" text-anchor="middle" aria-hidden="true">
          {terrainGlyph(hex.terrain)}
        </text>
      )}
    </g>
  )
}

// ---------- fold lines ----------

function FoldLines() {
  // Render every face's outline. Adjacent faces share edges, so each
  // edge will be drawn twice - that doubles the stroke weight and gives
  // the fold lines a slightly heavier, woodcut feel which suits the
  // legacy 2d6 look.
  return (
    <g class="surface-fold-lines" aria-hidden="true">
      {FACES.map((face, i) => {
        const v = faceFlatVertices(face)
        return (
          <polygon
            key={i}
            points={`${v[0].x},${v[0].y} ${v[1].x},${v[1].y} ${v[2].x},${v[2].y}`}
            fill="none"
          />
        )
      })}
    </g>
  )
}

// ---------- markers ----------

function StarportMarker({ x, y }: { x: number; y: number }) {
  return (
    <g class="surface-starport-group" aria-hidden="true">
      <circle cx={x} cy={y} r={6} class="surface-starport-halo" />
      <text x={x} y={y + 4} class="surface-starport" text-anchor="middle">★</text>
      <text x={x} y={y + 18} class="surface-label surface-label-tier-3" text-anchor="middle">Starport</text>
    </g>
  )
}

function CityMarker({ x, y, tier, name }: { x: number; y: number; tier: number; name: string }) {
  return (
    <g class="surface-city-group" aria-hidden="true">
      <circle cx={x} cy={y} r={settlementRadius(tier)} class={`surface-city surface-city-${tier}`} />
      {tier >= 2 && (
        <text x={x} y={y + 14} class={`surface-label surface-label-tier-${tier}`} text-anchor="middle">{name}</text>
      )}
    </g>
  )
}

function projectCity(s: Settlement, worldSeed: number): { x: number; y: number; tier: number; name: string } {
  const { x, y } = projectColRow(s.coord)
  return { x, y, tier: s.tier, name: cityName(worldSeed, s.coord) }
}

function projectStarport(coord: SurfaceHexCoord): { x: number; y: number } {
  return projectColRow(coord)
}

function projectColRow(coord: SurfaceHexCoord): { x: number; y: number } {
  // surface_map.rs convention: row 0 .. 15 maps to lat -90..+90,
  // col 0 .. 31 maps to lon -180..+180. We feed lat/lon (radians)
  // to sphereToNet.
  const latDeg = -90 + (coord.row + 0.5) * 180 / 16
  const lonDeg = -180 + (coord.col + 0.5) * 360 / 32
  const p = sphereToNet(latDeg * Math.PI / 180, lonDeg * Math.PI / 180)
  return { x: p.x, y: p.y }
}

function hexPath(cx: number, cy: number, r: number): string {
  // Flat-top hex.
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * 60 * i
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`)
  }
  return `M${pts.join(' L')}Z`
}

// ---------- terrain styling ----------

const TERRAIN_FILL: Record<Terrain, string> = {
  Ocean: '#1a3a6a',
  Shoreline: '#3a6a96',
  Plain: '#9c9c6c',
  Forest: '#3a6e3a',
  Hill: '#8c7050',
  Mountain: '#6e5648',
  Desert: '#d4b46a',
  Tundra: '#7c8888',
  Ice: '#d8e4ec',
  Volcanic: '#7a382e',
}

const TERRAIN_GLYPH: Record<Terrain, string> = {
  Ocean: '',
  Shoreline: '',
  Plain: '',
  Forest: '♣',
  Hill: '⌒',
  Mountain: '▲',
  Desert: '∴',
  Tundra: '·',
  Ice: '❄',
  Volcanic: '⛰',
}

function terrainFill(t: Terrain): string { return TERRAIN_FILL[t] }
function terrainGlyph(t: Terrain): string { return TERRAIN_GLYPH[t] }

function settlementRadius(tier: number): number {
  switch (tier) {
    case 3: return 3.4
    case 2: return 2.8
    case 1: return 2.0
    default: return 1.2
  }
}

function cityName(worldSeed: number, coord: SurfaceHexCoord): string {
  const mixed = ((worldSeed >>> 0) * 0x9e3779b9 + ((coord.col << 16) | coord.row)) >>> 0
  return systemName(mixed)
}

function coordOfHex(h: IcosaHex): string {
  return `${Math.round(h.lonDeg)},${Math.round(h.latDeg)}`
}

function coordOfSel(sel: SurfaceHexCoord): string {
  const latDeg = -90 + (sel.row + 0.5) * 180 / 16
  const lonDeg = -180 + (sel.col + 0.5) * 360 / 32
  return `${Math.round(lonDeg)},${Math.round(latDeg)}`
}

// Re-export for callers that previously imported from this file (the
// terrain label / hex coord helpers live in the domain module now).
export { hexCoordLabel, terrainLabel }
