import {
  currentSurfaceMap,
  selectedSurfaceHex,
  setSelectedSurfaceHex,
} from '../appState'
import {
  hexCoordLabel,
  terrainLabel,
  type SurfaceHex,
  type SurfaceMap as SurfaceMapDTO,
  type Settlement,
  type SurfaceHexCoord,
  type Terrain,
} from '../domain/surfaceMap'

// Cepheus-style 32x16 hex world map for the current main world.
//
// Geometry mirrors the subsector map: pointy-top hexes with odd columns
// shifted down half a row. Terrain colour comes from a fixed palette so
// the map reads at a glance.

const HEX_R = 14
const HEX_W = HEX_R * Math.sqrt(3)
const HEX_H = HEX_R * 2
const COL_STEP = HEX_W
const ROW_STEP = HEX_H * 0.75
const PAD = HEX_W * 0.8

const COLS = 32
const ROWS = 16

const TERRAIN_FILL: Record<Terrain, string> = {
  Ocean: 'rgba(38, 70, 130, 0.72)',
  Shoreline: 'rgba(110, 150, 190, 0.65)',
  Plain: 'rgba(160, 175, 110, 0.65)',
  Forest: 'rgba(70, 130, 80, 0.75)',
  Hill: 'rgba(160, 130, 90, 0.70)',
  Mountain: 'rgba(140, 110, 95, 0.85)',
  Desert: 'rgba(225, 200, 130, 0.80)',
  Tundra: 'rgba(170, 180, 175, 0.65)',
  Ice: 'rgba(220, 235, 245, 0.85)',
  Volcanic: 'rgba(150, 60, 50, 0.85)',
}

function hexCenter(col: number, row: number): { x: number; y: number } {
  const cx = PAD + col * COL_STEP
  const cy = PAD + row * ROW_STEP + (col % 2 === 1 ? ROW_STEP * 0.5 : 0)
  return { x: cx, y: cy }
}

function hexPath(cx: number, cy: number, r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30)
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`)
  }
  return `M${pts.join(' L')}Z`
}

const SVG_W = PAD * 2 + (COLS - 1) * COL_STEP
const SVG_H = PAD * 2 + (ROWS - 1) * ROW_STEP + ROW_STEP * 0.5

interface SurfaceMapProps {
  map: SurfaceMapDTO | null
}

export function SurfaceMap(_: SurfaceMapProps) {
  // Read from the signal so we re-render on map changes. The prop is kept
  // for symmetry with SubsectorMap and to make the call site clearer.
  const map = currentSurfaceMap.value
  if (!map) {
    return (
      <div class="surface-map surface-empty">
        <p>No main world available — generate a habitable system first.</p>
      </div>
    )
  }
  const sel = selectedSurfaceHex.value
  const settlementByKey = new Map<string, Settlement>()
  for (const s of map.cities) {
    settlementByKey.set(`${s.coord.col},${s.coord.row}`, s)
  }
  const starportKey = map.starport ? `${map.starport.col},${map.starport.row}` : null
  return (
    <div
      class="surface-map"
      role="region"
      aria-label={`Surface map, ${(map.ocean_fraction * 100).toFixed(0)}% ocean`}
    >
      <svg viewBox={`0 0 ${SVG_W.toFixed(0)} ${SVG_H.toFixed(0)}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Surface hex grid">
        {map.hexes.map((hex) => {
          const { x, y } = hexCenter(hex.coord.col, hex.coord.row)
          const key = `${hex.coord.col},${hex.coord.row}`
          const isSel = !!sel && sel.col === hex.coord.col && sel.row === hex.coord.row
          const isStarport = starportKey === key
          const settlement = settlementByKey.get(key)
          return (
            <SurfaceHexCell
              key={key}
              hex={hex}
              cx={x}
              cy={y}
              selected={isSel}
              isStarport={isStarport}
              settlement={settlement}
            />
          )
        })}
      </svg>
    </div>
  )
}

interface CellProps {
  hex: SurfaceHex
  cx: number
  cy: number
  selected: boolean
  isStarport: boolean
  settlement: Settlement | undefined
}

function SurfaceHexCell({ hex, cx, cy, selected, isStarport, settlement }: CellProps) {
  const fill = TERRAIN_FILL[hex.terrain]
  const coord: SurfaceHexCoord = hex.coord
  const label = `${hexCoordLabel(coord)} · ${terrainLabel(hex.terrain)}`
  return (
    <g
      class={`surface-hex surface-${hex.terrain.toLowerCase()}${selected ? ' surface-selected' : ''}`}
      tabIndex={0}
      role="button"
      aria-label={label}
      onClick={() => setSelectedSurfaceHex(coord)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setSelectedSurfaceHex(coord)
        }
      }}
    >
      <path d={hexPath(cx, cy, HEX_R)} class="surface-hex-shape" fill={fill} />
      {isStarport && (
        <text x={cx} y={cy + 4} class="surface-marker surface-starport" text-anchor="middle">★</text>
      )}
      {!isStarport && settlement && (
        <circle cx={cx} cy={cy} r={settlementRadius(settlement.tier)} class={`surface-city surface-city-${settlement.tier}`} />
      )}
    </g>
  )
}

function settlementRadius(tier: number): number {
  switch (tier) {
    case 3: return 4
    case 2: return 3.2
    case 1: return 2.4
    default: return 1.6
  }
}
