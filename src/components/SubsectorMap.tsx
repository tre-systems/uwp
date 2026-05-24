import {
  selectedHex,
  selectHex,
  showJumpRoutes,
  subsectorSeed,
} from '../appState'
import {
  hexLabel,
  type Bases,
  type HexCoord,
  type Subsector,
  type SubsectorHex,
  type TravelZone,
} from '../domain/subsector'
import { hexName } from '../domain/names'

// Subsector map styled after the classic legacy 2d6 Map
// (https://sector-map.com): black field, thin grey hex grid, each
// occupied hex shows base markers, starport letter, system dot, world
// name in caps, and a tiny gas-giant glyph. Travel zones outline the
// hex (amber / red) instead of filling it. Jump routes are bright
// green strokes between hex centres.
//
// Geometry: pointy-top hex with circumradius R. Horizontal step =
// R * sqrt(3), vertical step = R * 1.5. Odd columns shift down by half
// a vertical step so neighbouring hexes share edges.

const HEX_R = 30
const HEX_W = HEX_R * Math.sqrt(3)
const HEX_H = HEX_R * 2
const COL_STEP = HEX_W
const ROW_STEP = HEX_H * 0.75
const PAD_X = HEX_W * 0.8
const PAD_Y = HEX_H * 0.6

const COLS = 8
const ROWS = 10

interface XY { x: number; y: number }

function hexCenter(col: number, row: number): XY {
  // 1-indexed grid; odd cols shift down half a row.
  const cx = PAD_X + (col - 1) * COL_STEP
  const cy = PAD_Y + (row - 1) * ROW_STEP + (col % 2 === 0 ? ROW_STEP * 0.5 : 0)
  return { x: cx, y: cy }
}

function hexPath(cx: number, cy: number, r: number): string {
  // Pointy-top hex: vertices at 30, 90, 150, 210, 270, 330 deg.
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30)
    const px = cx + r * Math.cos(a)
    const py = cy + r * Math.sin(a)
    pts.push(`${px.toFixed(2)},${py.toFixed(2)}`)
  }
  return `M${pts.join(' L')}Z`
}

const SVG_WIDTH = PAD_X * 2 + (COLS - 1) * COL_STEP
const SVG_HEIGHT = PAD_Y * 2 + (ROWS - 1) * ROW_STEP + ROW_STEP * 0.5

interface SubsectorMapProps {
  subsector: Subsector | null
}

export function SubsectorMap({ subsector }: SubsectorMapProps) {
  if (!subsector) {
    return (
      <div class="subsector-map subsector-empty">
        <p>Generating subsector…</p>
      </div>
    )
  }
  const sel = selectedHex.value
  const routesVisible = showJumpRoutes.value
  const seed = subsectorSeed.value
  const hexByCoord = new Map<string, SubsectorHex>()
  for (const h of subsector.hexes) {
    hexByCoord.set(`${h.coord.col},${h.coord.row}`, h)
  }
  return (
    <div class="subsector-map" role="region" aria-label={`Subsector ${subsector.allegiance}, seed ${subsector.seed}`}>
      <svg
        viewBox={`0 0 ${SVG_WIDTH.toFixed(0)} ${SVG_HEIGHT.toFixed(0)}`}
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Subsector hex grid"
      >
        {/* Routes sit below hex shapes so the hex outline reads as the
            connector boundary, matching the legacy 2d6 Map look. */}
        {routesVisible && (
          <g class="jump-routes" aria-hidden="true">
            {subsector.jump_routes.map((route) => {
              const a = hexCenter(route.from.col, route.from.row)
              const b = hexCenter(route.to.col, route.to.row)
              return (
                <line
                  key={`${route.from.col},${route.from.row}-${route.to.col},${route.to.row}-${route.jump}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  class={route.jump === 1 ? 'jump-route jump-route-1' : 'jump-route jump-route-2'}
                />
              )
            })}
          </g>
        )}
        {Array.from({ length: COLS }, (_, i) => i + 1).flatMap((col) =>
          Array.from({ length: ROWS }, (_, j) => j + 1).map((row) => {
            const key = `${col},${row}`
            const hex = hexByCoord.get(key) ?? null
            const { x, y } = hexCenter(col, row)
            const isSelected = !!sel && sel.col === col && sel.row === row
            return (
              <HexCell
                key={key}
                col={col}
                row={row}
                cx={x}
                cy={y}
                hex={hex}
                selected={isSelected}
                subsectorSeed={seed}
              />
            )
          }),
        )}
      </svg>
    </div>
  )
}

interface HexCellProps {
  col: number
  row: number
  cx: number
  cy: number
  hex: SubsectorHex | null
  selected: boolean
  subsectorSeed: number
}

function HexCell({ col, row, cx, cy, hex, selected, subsectorSeed }: HexCellProps) {
  const label = `${col.toString().padStart(2, '0')}${row.toString().padStart(2, '0')}`
  if (!hex) {
    return (
      <g class="hex-cell hex-empty" data-coord={label}>
        <path d={hexPath(cx, cy, HEX_R)} class="hex-shape" />
        <text x={cx} y={cy - HEX_R + 9} class="hex-label" text-anchor="middle">
          {label}
        </text>
      </g>
    )
  }
  const fullCoord: HexCoord = { col, row }
  const zoneClass = travelZoneClass(hex.travel_zone)
  const portClass = `port-${hex.uwp.starport.toLowerCase()}`
  const isRed = hex.travel_zone === 'Red'
  const name = (hex.name ?? hexName(subsectorSeed, col, row)).toUpperCase()
  return (
    <g
      class={`hex-cell hex-occupied ${zoneClass} ${portClass}${selected ? ' hex-selected' : ''}`}
      data-coord={label}
      tabIndex={0}
      role="button"
      aria-label={describe(hex)}
      onClick={() => selectHex(fullCoord)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          selectHex(fullCoord)
        }
      }}
    >
      {/* Grid outline. Selection / zone styling lives on the hex-shape
          via CSS classes - no fill, just stroke variants. */}
      <path d={hexPath(cx, cy, HEX_R)} class="hex-shape" />

      {/* Hex coordinate, top-centre, very small - matches the
          sector-map reference. */}
      <text x={cx} y={cy - HEX_R + 9} class="hex-label" text-anchor="middle">
        {label}
      </text>

      {/* Bases row - tiny markers across the upper third of the hex.
          ★ for Naval (top-left), △ for Scout, ◆ for Research, ◯ for Aid. */}
      <BaseMarkers cx={cx} cy={cy} bases={hex.bases} />

      {/* Starport letter, just above the system marker. Red ports are
          flagged in red when the zone is Red. */}
      <text
        x={cx - HEX_R * 0.32}
        y={cy - 2}
        class={`hex-starport${isRed ? ' hex-starport-warn' : ''}`}
        text-anchor="middle"
      >
        {hex.uwp.starport}
      </text>

      {/* System marker: filled dot. Selected highlights with a ring. */}
      <circle cx={cx} cy={cy - 1} r={2.6} class="hex-system-dot" />

      {/* World name, classic uppercase legacy 2d6 style, below the dot. */}
      <text
        x={cx}
        y={cy + HEX_R * 0.38}
        class={`hex-name${isRed ? ' hex-name-warn' : ''}`}
        text-anchor="middle"
      >
        {name}
      </text>

      {/* Gas-giant glyph: small empty circle just below the name. */}
      {hex.gas_giant && (
        <circle
          cx={cx + HEX_R * 0.42}
          cy={cy + HEX_R * 0.16}
          r={2.4}
          class="hex-gas-giant"
        />
      )}

      {/* Asteroid belt glyph: small dots cluster, opposite the gas giant. */}
      {hex.belts && (
        <g class="hex-belt-glyph" aria-hidden="true">
          <circle cx={cx - HEX_R * 0.40} cy={cy + HEX_R * 0.10} r={0.9} />
          <circle cx={cx - HEX_R * 0.32} cy={cy + HEX_R * 0.18} r={0.7} />
          <circle cx={cx - HEX_R * 0.46} cy={cy + HEX_R * 0.20} r={0.6} />
        </g>
      )}
    </g>
  )
}

function BaseMarkers({ cx, cy, bases }: { cx: number; cy: number; bases: Bases }) {
  const markers: { x: number; y: number; symbol: string; cls: string }[] = []
  const row1y = cy - HEX_R * 0.50
  // Lay bases out left-to-right across the top half so multiple bases
  // don't overlap. Naval ★ in the left slot, then Scout, Research, Aid.
  let nextX = cx - HEX_R * 0.45
  const stepX = HEX_R * 0.30
  if (bases.naval) {
    markers.push({ x: nextX, y: row1y, symbol: '★', cls: 'base-naval' })
    nextX += stepX
  }
  if (bases.scout) {
    markers.push({ x: nextX, y: row1y, symbol: '△', cls: 'base-scout' })
    nextX += stepX
  }
  if (bases.research) {
    markers.push({ x: nextX, y: row1y, symbol: '◆', cls: 'base-research' })
    nextX += stepX
  }
  if (bases.Aid) {
    markers.push({ x: nextX, y: row1y, symbol: '◯', cls: 'base-Aid' })
  }
  return (
    <>
      {markers.map((m) => (
        <text
          key={m.cls}
          x={m.x}
          y={m.y}
          class={`hex-base ${m.cls}`}
          text-anchor="middle"
        >
          {m.symbol}
        </text>
      ))}
    </>
  )
}

function travelZoneClass(zone: TravelZone): string {
  switch (zone) {
    case 'Amber': return 'zone-amber'
    case 'Red': return 'zone-red'
    default: return 'zone-green'
  }
}

function describe(hex: SubsectorHex): string {
  const flags: string[] = []
  if (hex.gas_giant) flags.push('gas giant')
  if (hex.belts) flags.push('asteroid belt')
  if (hex.bases.naval) flags.push('naval base')
  if (hex.bases.scout) flags.push('scout base')
  if (hex.bases.research) flags.push('research base')
  if (hex.bases.Aid) flags.push('Aid')
  const tail = flags.length > 0 ? ' (' + flags.join(', ') + ')' : ''
  return `Hex ${hexLabel(hex.coord)}: UWP ${hex.uwp.starport}${hex.uwp.size}${hex.uwp.atm}${hex.uwp.hydro}${hex.uwp.pop}${hex.uwp.gov}${hex.uwp.law}-${hex.uwp.tech}${tail}`
}
