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
  type SurfaceHex,
  type Settlement,
  type SurfaceHexCoord,
  type Terrain,
} from '../domain/surfaceMap'
import { systemName } from '../domain/names'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useMapGestures } from './useMapGestures'
import { renderSurfaceBackground } from './surfaceMapBackground'
import { buildIcosahedralSurface, type IcosaHex, type IcosaSurface } from './icosahedralSurface'
import {
  FACES,
  faceFlatVertices,
  NET_HEIGHT,
  NET_WIDTH,
  sphereToNet,
} from '../domain/icosahedron'

// Cepheus / legacy 2d6-style icosahedral surface map.
//
// The world is laid out as a connected net of the 20 triangular faces
// of an icosahedron: five north-cap faces, a ten-face equatorial
// zig-zag belt, then five south-cap faces. The background image is the
// Rust pre-bake projected through that same net, so continents wrap
// continuously across shared face edges. Each face is subdivided N
// times into smaller triangles; each sub-triangle becomes one pickable
// atlas cell. Cuts remain only on the outside boundary, as expected for
// an unfolded d20-style legacy 2d6 world map.

const SUBDIVISIONS = 12
const MIN_BACKGROUND_WIDTH = 1024
const DESKTOP_BACKGROUND_WIDTH = 1536
const TOUCH_BACKGROUND_WIDTH = 1152
const SURFACE_FACE_CLIP_ID = 'surface-face-clip'
const SURFACE_COORD_COLS = 32
const SURFACE_COORD_ROWS = 16

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
  const [selectedCellKey, setSelectedCellKey] = useState<string | null>(null)

  const seaLevelParam = params.value.sea_level
  const iceLatitudeDeg = params.value.ice_latitude * 90
  const mainWorld = system && system.main_world >= 0 ? system.planets[system.main_world] ?? null : null
  const meanTempK = mainWorld?.climate.mean_surface_temp_k ?? mainWorld?.temperature_k ?? 288
  const iceFraction = mainWorld?.climate.ice_fraction ?? 0.0
  const prebake = useMemo(() => {
    if (!map) return null
    return getSurfacePrebake()
  }, [map?.seed, seaLevelParam])

  // Rebuild the icosahedral hex set whenever the inputs that drive
  // terrain / sea level / temperature change. Done synchronously in a
  // useMemo so the UI repaints atomically.
  const surface = useMemo(() => {
    if (!prebake) return null
    return buildIcosahedralSurface({
      prebake,
      waterFraction: seaLevelParam,
      iceFraction,
      meanTempK,
      subdivisions: SUBDIVISIONS,
    })
  }, [prebake, seaLevelParam, iceFraction, meanTempK])

  // Rendered background, recomputed alongside the surface. The render
  // is async + chunked so the UI thread stays responsive on slower
  // devices; the AbortController cancels mid-paint when the user
  // navigates away or the inputs change.
  const [bgUrl, setBgUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!map || !prebake) { setBgUrl(null); return }
    const controller = new AbortController()
    renderSurfaceBackground(
      prebake,
      {
        waterFraction: seaLevelParam,
        iceLatitudeDeg,
        meanTempK,
        width: surfaceBackgroundWidth(containerRef.current),
        paletteBase: {
          ocean: params.value.ocean_color,
          land: params.value.land_color,
          mountain: params.value.mountain_color,
          sand: params.value.sand_color,
          snow: params.value.snow_color,
        },
      },
      controller.signal,
    )
      .then((url) => {
        if (!controller.signal.aborted) setBgUrl(url)
      })
      .catch((err) => {
        if ((err as DOMException)?.name !== 'AbortError') {
          console.warn('renderSurfaceBackground failed', err)
        }
      })
    return () => {
      controller.abort()
    }
  }, [map?.seed, prebake, seaLevelParam, iceLatitudeDeg, meanTempK])

  useEffect(() => {
    setSelectedCellKey(null)
  }, [map?.seed])

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
  const cityPoints = map.cities.map((s) => projectCity(s, map.seed, surface))
  const starportPoint = map.starport ? projectStarport(map.starport, surface) : null

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
        <FaceClipPaths />
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
        {/* Surface cells act as an interactive atlas grid over the rendered
            pre-bake. Keep them visually quiet; the background carries the
            photoreal terrain, the cells provide legacy 2d6-style picking. */}
        {surface && (
          <SurfaceCells
            surface={surface}
            selectedHex={sel}
            selectedCellKey={selectedCellKey}
            onSelectCell={setSelectedCellKey}
          />
        )}
        {/* Fold lines should explain the icosahedral net, not dominate it. */}
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

// ---------- surface hex cells ----------

function FaceClipPaths() {
  return (
    <defs>
      {FACES.map((face, i) => {
        const v = faceFlatVertices(face)
        return (
          <clipPath key={i} id={`${SURFACE_FACE_CLIP_ID}-${i}`}>
            <polygon points={facePoints(v)} />
          </clipPath>
        )
      })}
    </defs>
  )
}

function SurfaceCells({
  surface,
  selectedHex,
  selectedCellKey,
  onSelectCell,
}: {
  surface: ReturnType<typeof buildIcosahedralSurface>
  selectedHex: SurfaceHexCoord | null
  selectedCellKey: string | null
  onSelectCell: (key: string) => void
}) {
  const selectedCoordKey = selectedHex ? coordOfSel(selectedHex) : null
  return (
    <g class="surface-grid-layer">
      {FACES.map((_, faceIdx) => (
        <g key={faceIdx} clip-path={`url(#${SURFACE_FACE_CLIP_ID}-${faceIdx})`}>
          {surface.hexes
            .filter((h) => h.faceIdx === faceIdx)
            .map((h, i) => {
              const cellKey = keyOfHex(h)
              return (
                <SubHex
                  key={`${faceIdx}-${i}`}
                  hex={h}
                  cellKey={cellKey}
                  hexRadius={surface.hexRadius}
                  selected={
                    selectedCellKey
                      ? cellKey === selectedCellKey
                      : !!selectedCoordKey && coordOfHex(h) === selectedCoordKey
                  }
                  onSelectCell={onSelectCell}
                />
              )
            })}
        </g>
      ))}
    </g>
  )
}

interface SubHexProps {
  hex: IcosaHex
  cellKey: string
  hexRadius: number
  selected: boolean
  onSelectCell: (key: string) => void
}

function SubHex({ hex, cellKey, hexRadius, selected, onSelectCell }: SubHexProps) {
  const r = Math.max(1, hexRadius)
  const terrainClass = hex.terrain.toLowerCase()
  const label = `${hex.terrain} · ${hex.latDeg.toFixed(1)}°`
  const coord = coordForHex(hex)
  const cell = surfaceCellForHex(hex, coord)
  return (
    <g
      class={`surface-hex surface-${terrainClass}${selected ? ' surface-selected' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={() => {
        onSelectCell(cellKey)
        selectAndFocusSurfaceHex(coord, cell)
      }}
      onDblClick={() => {
        onSelectCell(cellKey)
        openRegionView(coord, cell)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelectCell(cellKey)
          selectAndFocusSurfaceHex(coord, cell)
        }
      }}
    >
      <path d={hexPath(hex.x, hex.y, r)} class="surface-hex-shape" fill={terrainFill(hex.terrain)} />
    </g>
  )
}

// ---------- fold lines ----------

function FoldLines() {
  // Render every face's outline so the net remains visibly foldable
  // without overpowering the finer atlas grid.
  return (
    <g class="surface-fold-lines" aria-hidden="true">
      {FACES.map((face, i) => {
        const v = faceFlatVertices(face)
        return (
          <polygon
            key={i}
            points={facePoints(v)}
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

function projectCity(s: Settlement, worldSeed: number, surface: IcosaSurface | null): { x: number; y: number; tier: number; name: string } {
  const { x, y } = projectSurfaceCoord(s.coord, surface)
  return { x, y, tier: s.tier, name: cityName(worldSeed, s.coord) }
}

function projectStarport(coord: SurfaceHexCoord, surface: IcosaSurface | null): { x: number; y: number } {
  return projectSurfaceCoord(coord, surface)
}

function projectSurfaceCoord(coord: SurfaceHexCoord, surface: IcosaSurface | null): { x: number; y: number } {
  return snapToSurfaceHex(projectColRow(coord), surface)
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

function snapToSurfaceHex(point: { x: number; y: number }, surface: IcosaSurface | null): { x: number; y: number } {
  if (!surface || surface.hexes.length === 0) return point
  let best = surface.hexes[0]
  let bestD2 = Number.POSITIVE_INFINITY
  for (const hex of surface.hexes) {
    const dx = hex.x - point.x
    const dy = hex.y - point.y
    const d2 = dx * dx + dy * dy
    if (d2 < bestD2) {
      best = hex
      bestD2 = d2
    }
  }
  return { x: best.x, y: best.y }
}

function facePoints(v: readonly { x: number; y: number }[]): string {
  return v.map((p) => `${p.x},${p.y}`).join(' ')
}

function hexPath(cx: number, cy: number, r: number): string {
  // Pointy-top hex, matching the classic icosahedral world-map examples.
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (-90 + 60 * i)
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

function terrainFill(t: Terrain): string { return TERRAIN_FILL[t] }

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
  return coordKey(coordForHex(h))
}

function keyOfHex(h: IcosaHex): string {
  return `${h.faceIdx}:${h.upPointing ? 1 : 0}:${h.x.toFixed(3)}:${h.y.toFixed(3)}`
}

function coordOfSel(sel: SurfaceHexCoord): string {
  return coordKey(sel)
}

function coordForHex(h: IcosaHex): SurfaceHexCoord {
  const lonNorm = ((h.lonDeg + 180) / 360)
  const latNorm = ((h.latDeg + 90) / 180)
  return {
    col: clampIndex(Math.floor(lonNorm * SURFACE_COORD_COLS), SURFACE_COORD_COLS),
    row: clampIndex(Math.floor(latNorm * SURFACE_COORD_ROWS), SURFACE_COORD_ROWS),
  }
}

function surfaceCellForHex(h: IcosaHex, coord: SurfaceHexCoord): SurfaceHex {
  return {
    coord,
    terrain: h.terrain,
    latitude_deg: h.latDeg,
    longitude_deg: h.lonDeg,
    temperature_k: h.temperatureK,
    elevation: (h.elevation + 1) * 0.5,
  }
}

function coordKey(coord: SurfaceHexCoord): string {
  return `${coord.col},${coord.row}`
}

function clampIndex(n: number, max: number): number {
  return Math.max(0, Math.min(max - 1, n))
}

function surfaceBackgroundWidth(el: HTMLElement | null): number {
  if (typeof window === 'undefined') return MIN_BACKGROUND_WIDTH

  const cssWidth = el?.clientWidth || window.innerWidth || MIN_BACKGROUND_WIDTH
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const coarse = window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0
  const maxWidth = coarse ? TOUCH_BACKGROUND_WIDTH : DESKTOP_BACKGROUND_WIDTH
  return Math.round(Math.max(MIN_BACKGROUND_WIDTH, Math.min(maxWidth, cssWidth * dpr * 2)))
}

// Re-export for callers that previously imported from this file (the
// terrain label / hex coord helpers live in the domain module now).
export { hexCoordLabel, terrainLabel }
