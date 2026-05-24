import {
  currentSurfaceMap,
  selectAndFocusSurfaceHex,
  selectedSurfaceHex,
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
import { systemName } from '../domain/names'

// Classic Cepheus / legacy 2d6 Book 3 world surface map.
//
// Same flat-top hex geometry as the subsector map, just denser and
// at a higher detail level. Each hex carries:
//   - a terrain colour from a legacy 2d6-style palette
//   - a single-glyph terrain symbol (▲ mountain, ♣ forest, ≈ ocean, ...)
//   - optional starport / settlement marker
//
// The grid covers a 32x16 lat/lon projection of the main world's
// surface, matching the Rust generator's output.

const HEX_R = 16
const HEX_H = HEX_R * Math.sqrt(3) // flat-to-flat height
const COL_STEP = HEX_R * 1.5
const ROW_STEP = HEX_H
const PAD_X = HEX_R * 1.0
const PAD_Y = HEX_H * 0.7

const COLS = 32
const ROWS = 16

// legacy 2d6-style terrain palette: muted, parchment-leaning fills
// keyed to the canonical Book 3 / third-party publishers 2e terrain colours, plus
// a single glyph per type that surfaces when the map is small.
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

function hexCenter(col: number, row: number): { x: number; y: number } {
  const cx = PAD_X + col * COL_STEP
  const cy = PAD_Y + row * ROW_STEP + (col % 2 === 1 ? ROW_STEP * 0.5 : 0)
  return { x: cx, y: cy }
}

function hexPath(cx: number, cy: number, r: number): string {
  // Flat-top hex: vertices at 0°, 60°, 120°, 180°, 240°, 300°.
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * 60 * i
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`)
  }
  return `M${pts.join(' L')}Z`
}

const SVG_W = PAD_X * 2 + (COLS - 1) * COL_STEP
const SVG_H = PAD_Y * 2 + (ROWS - 1) * ROW_STEP + ROW_STEP * 0.5

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

  // Indexed lookup so we can detect coastline edges (ocean ↔ land)
  // and draw a slightly darker outline on the land side - the classic
  // legacy 2d6 map's continental highlight.
  const hexByKey = new Map<string, SurfaceHex>()
  for (const h of map.hexes) hexByKey.set(`${h.coord.col},${h.coord.row}`, h)

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
          const isLand = !isOcean(hex.terrain)
          const isCoast = isLand && neighbours(hex.coord).some((nc) => {
            const n = hexByKey.get(`${nc.col},${nc.row}`)
            return n != null && isOcean(n.terrain)
          })
          return (
            <SurfaceHexCell
              key={key}
              hex={hex}
              cx={x}
              cy={y}
              selected={isSel}
              isStarport={isStarport}
              settlement={settlement}
              isCoast={isCoast}
            />
          )
        })}
        {/* Settlement / starport labels render on a separate layer so
            they sit above every hex outline, never clipped by neighbours. */}
        {map.starport && (
          <SurfaceLabel
            cx={hexCenter(map.starport.col, map.starport.row).x}
            cy={hexCenter(map.starport.col, map.starport.row).y}
            text="Starport"
            tier={3}
          />
        )}
        {map.cities.map((s) => (
          <SurfaceLabel
            key={`label-${s.coord.col}-${s.coord.row}`}
            cx={hexCenter(s.coord.col, s.coord.row).x}
            cy={hexCenter(s.coord.col, s.coord.row).y}
            text={cityName(map.seed, s.coord)}
            tier={s.tier}
          />
        ))}
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
  isCoast: boolean
}

function SurfaceHexCell({ hex, cx, cy, selected, isStarport, settlement, isCoast }: CellProps) {
  const fill = TERRAIN_FILL[hex.terrain]
  const glyph = TERRAIN_GLYPH[hex.terrain]
  const coord: SurfaceHexCoord = hex.coord
  const label = `${hexCoordLabel(coord)} · ${terrainLabel(hex.terrain)}`
  const terrainClass = hex.terrain.toLowerCase()
  return (
    <g
      class={`surface-hex surface-${terrainClass}${selected ? ' surface-selected' : ''}${isCoast ? ' surface-coast' : ''}`}
      tabIndex={0}
      role="button"
      aria-label={label}
      onClick={() => selectAndFocusSurfaceHex(coord)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          selectAndFocusSurfaceHex(coord)
        }
      }}
    >
      <path d={hexPath(cx, cy, HEX_R)} class="surface-hex-shape" fill={fill} />
      {glyph && (
        <text x={cx} y={cy + 3} class="surface-glyph" text-anchor="middle" aria-hidden="true">
          {glyph}
        </text>
      )}
      {isStarport && (
        <text x={cx} y={cy + 5} class="surface-marker surface-starport" text-anchor="middle">★</text>
      )}
      {!isStarport && settlement && (
        <circle cx={cx} cy={cy} r={settlementRadius(settlement.tier)} class={`surface-city surface-city-${settlement.tier}`} />
      )}
    </g>
  )
}

interface LabelProps {
  cx: number
  cy: number
  text: string
  tier: number
}

function SurfaceLabel({ cx, cy, text, tier }: LabelProps) {
  // Major cities and the starport get a small label below the marker.
  // Tier 0 / minor settlements stay unlabelled to keep the map readable.
  if (tier < 2) return null
  return (
    <text
      x={cx}
      y={cy + HEX_R * 0.95}
      class={`surface-label surface-label-tier-${tier}`}
      text-anchor="middle"
      aria-hidden="true"
    >
      {text}
    </text>
  )
}

function settlementRadius(tier: number): number {
  switch (tier) {
    case 3: return 3.4
    case 2: return 2.8
    case 1: return 2.0
    default: return 1.2
  }
}

function isOcean(t: Terrain): boolean {
  return t === 'Ocean'
}

// Derive a city name deterministically from the world seed + settlement
// coord, reusing the same syllabic generator the system names use. Keeps
// the labels readable without expanding the Rust DTO.
function cityName(worldSeed: number, coord: SurfaceHexCoord): string {
  const mixed = ((worldSeed >>> 0) * 0x9e3779b9 + ((coord.col << 16) | coord.row)) >>> 0
  return systemName(mixed)
}

function neighbours(c: SurfaceHexCoord): SurfaceHexCoord[] {
  // Flat-top hex neighbours in odd-q offset coordinates (matches the
  // grid layout used by hexCenter above).
  const odd = c.col % 2 === 1
  const dCol = [+1, +1, 0, -1, -1, 0]
  const dRowEven = [0, -1, -1, -1, 0, +1]
  const dRowOdd  = [+1, 0, -1, 0, +1, +1]
  const out: SurfaceHexCoord[] = []
  for (let i = 0; i < 6; i++) {
    out.push({
      col: c.col + dCol[i],
      row: c.row + (odd ? dRowOdd[i] : dRowEven[i]),
    })
  }
  return out
}
