import {
  selectedHex,
  selectHex,
  showJumpRoutes,
  subsectorSeed,
} from '../appState'
import {
  hexLabel,
  uwpToCode,
  type Bases,
  type HexCoord,
  type Subsector,
  type SubsectorHex,
  type TravelZone,
} from '../domain/subsector'
import { useRef } from 'preact/hooks'
import { hexName, uniqueHexNames } from '../domain/names'
import { useMapGestures } from './useMapGestures'

// Subsector map styled after the classic legacy 2d6 Map
// (https://sector-map.com): pure black field, thin grey flat-top
// hex grid, each occupied hex shows base markers across the top,
// starport letter above a filled system dot, world name below it,
// gas-giant / belt glyphs to the sides. Travel zones outline the hex
// (amber / red) instead of filling it. Jump routes are bright green
// strokes between hex centres.
//
// Geometry: FLAT-TOP hex with circumradius R. Horizontal centre step
// = 1.5 * R, vertical centre step = sqrt(3) * R. Odd columns shift
// DOWN by half a vertical step. Matches the legacy 2d6 Map convention
// exactly — point-east/west, flat top/bottom.

const HEX_R = 34
const HEX_H = HEX_R * Math.sqrt(3) // flat-to-flat height
const COL_STEP = HEX_R * 1.5
const ROW_STEP = HEX_H
const PAD_X = HEX_R * 1.1
const PAD_Y = HEX_H * 0.85

const DEFAULT_COLS = 16
const DEFAULT_ROWS = 10

interface XY { x: number; y: number }

function hexCenter(col: number, row: number): XY {
  // 1-indexed grid; odd cols shift down half a row (legacy 2d6 convention).
  const cx = PAD_X + (col - 1) * COL_STEP
  const cy = PAD_Y + (row - 1) * ROW_STEP + (col % 2 === 0 ? ROW_STEP * 0.5 : 0)
  return { x: cx, y: cy }
}

function mapWidth(columns: number): number {
  return PAD_X * 2 + (columns - 1) * COL_STEP + HEX_R
}

function mapHeight(rows: number): number {
  return PAD_Y * 2 + (rows - 1) * ROW_STEP + ROW_STEP * 0.5 + HEX_H * 0.5
}

function hexPath(cx: number, cy: number, r: number): string {
  // Flat-top hex: vertices at 0°, 60°, 120°, 180°, 240°, 300°.
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * 60 * i
    const px = cx + r * Math.cos(a)
    const py = cy + r * Math.sin(a)
    pts.push(`${px.toFixed(2)},${py.toFixed(2)}`)
  }
  return `M${pts.join(' L')}Z`
}

interface SubsectorMapProps {
  subsector: Subsector | null
}

export function SubsectorMap({ subsector }: SubsectorMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const columns = subsector?.columns ?? DEFAULT_COLS
  const rows = subsector?.rows ?? DEFAULT_ROWS
  const svgWidth = mapWidth(columns)
  const svgHeight = mapHeight(rows)
  const seamX = columns > 8
    ? (hexCenter(8, 1).x + hexCenter(9, 1).x) * 0.5
    : null
  const gestures = useMapGestures(containerRef, svgWidth, svgHeight)

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
  // Pre-compute names that are guaranteed unique across the subsector so
  // the visible map doesn't repeat the same world name on multiple hexes
  // (a quirk of the splitmix32 + small CV inventory).
  const nameMap = uniqueHexNames(
    seed,
    subsector.hexes.map((h) => ({ col: h.coord.col, row: h.coord.row })),
  )
  return (
    <div
      class="subsector-map"
      role="region"
      aria-label={`Subsector ${subsector.allegiance}, seed ${subsector.seed}`}
      ref={containerRef}
      onWheel={gestures.handlers.onWheel as unknown as preact.JSX.WheelEventHandler<HTMLDivElement>}
      onPointerDown={gestures.handlers.onPointerDown as unknown as preact.JSX.PointerEventHandler<HTMLDivElement>}
      onPointerMove={gestures.handlers.onPointerMove as unknown as preact.JSX.PointerEventHandler<HTMLDivElement>}
      onPointerUp={gestures.handlers.onPointerUp as unknown as preact.JSX.PointerEventHandler<HTMLDivElement>}
      onPointerCancel={gestures.handlers.onPointerCancel as unknown as preact.JSX.PointerEventHandler<HTMLDivElement>}
    >
      <svg
        viewBox={gestures.viewBox}
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label={`${columns} by ${rows} subsector hex grid`}
      >
        {/* Routes sit below the hex outlines so the hex border reads as
            the connector boundary, matching the legacy 2d6 Map look. */}
        {routesVisible && (
          <g class="jump-routes" aria-hidden="true">
            {subsector.jump_routes.map((route) => {
              const a = hexCenter(route.from.col, route.from.row)
              const b = hexCenter(route.to.col, route.to.row)
              const kindClass = route.trade
                ? 'jump-route-trade'
                : route.communication
                  ? 'jump-route-comm'
                  : 'jump-route-local'
              return (
                <line
                  key={`${route.from.col},${route.from.row}-${route.to.col},${route.to.row}-${route.jump}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  class={`jump-route ${route.jump === 1 ? 'jump-route-1' : 'jump-route-2'} ${kindClass}`}
                />
              )
            })}
          </g>
        )}
        {seamX != null && (
          <line
            x1={seamX}
            y1={HEX_R * 0.35}
            x2={seamX}
            y2={svgHeight - HEX_R * 0.35}
            class="subsector-seam"
            aria-hidden="true"
          />
        )}
        {Array.from({ length: columns }, (_, i) => i + 1).flatMap((col) =>
          Array.from({ length: rows }, (_, j) => j + 1).map((row) => {
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
                displayName={nameMap.get(key)}
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
  displayName?: string
}

function HexCell({ col, row, cx, cy, hex, selected, subsectorSeed, displayName }: HexCellProps) {
  const label = `${col.toString().padStart(2, '0')}${row.toString().padStart(2, '0')}`
  if (!hex) {
    return (
      <g class="hex-cell hex-empty" data-coord={label}>
        <path d={hexPath(cx, cy, HEX_R)} class="hex-shape" />
        <text x={cx} y={cy - HEX_R * 0.55} class="hex-label" text-anchor="middle">
          {label}
        </text>
      </g>
    )
  }
  const fullCoord: HexCoord = { col, row }
  const zoneClass = travelZoneClass(hex.travel_zone)
  const portClass = `port-${hex.uwp.starport.toLowerCase()}`
  const isRed = hex.travel_zone === 'Red'
  const isHighPop = hex.uwp.pop >= 9
  const rawName = displayName ?? hex.name ?? hexName(subsectorSeed, col, row)
  // legacy 2d6 convention: ALL CAPS for high-pop worlds, Title Case otherwise.
  const name = isHighPop ? rawName.toUpperCase() : titleCase(rawName)
  return (
    <g
      class={`hex-cell hex-occupied ${zoneClass} ${portClass}${selected ? ' hex-selected' : ''}${isHighPop ? ' hex-hipop' : ''}`}
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
      {/* Grid outline (grey, continuous across the whole subsector). */}
      <path d={hexPath(cx, cy, HEX_R)} class="hex-shape" />

      {/* Travel-zone ring: a slightly inset concentric hex drawn on
          top, so amber / red zones read as a discrete decoration
          rather than recolouring the underlying grid line. */}
      {hex.travel_zone !== 'Green' && (
        <path
          d={hexPath(cx, cy, HEX_R - 2.5)}
          class={`hex-zone-ring zone-ring-${hex.travel_zone.toLowerCase()}`}
        />
      )}

      {/* Hex coordinate, top edge, very small dim grey. */}
      <text x={cx} y={cy - HEX_R * 0.62} class="hex-label" text-anchor="middle">
        {label}
      </text>

      {/* Base symbols across the upper third of the hex. */}
      <BaseMarkers cx={cx} cy={cy} bases={hex.bases} />

      {/* Starport letter above the system dot. */}
      <text
        x={cx}
        y={cy - HEX_R * 0.10}
        class={`hex-starport${isRed ? ' hex-starport-warn' : ''}`}
        text-anchor="middle"
      >
        {hex.uwp.starport}
      </text>

      {/* System marker: filled circle (or a hollow ring for X-class). */}
      <circle cx={cx} cy={cy + HEX_R * 0.10} r={3.2} class="hex-system-dot" />

      {/* World name below the dot. */}
      <text
        x={cx}
        y={cy + HEX_R * 0.45}
        class={`hex-name${isRed ? ' hex-name-warn' : ''}`}
        text-anchor="middle"
      >
        {name}
      </text>

      {/* Gas-giant glyph: hollow ring to the right of the system dot,
          matching the legacy 2d6 Map's "GG" indicator. */}
      {hex.gas_giant && (
        <circle
          cx={cx + HEX_R * 0.42}
          cy={cy + HEX_R * 0.10}
          r={2.4}
          class="hex-gas-giant"
        />
      )}

      {/* Asteroid belt glyph: small dot cluster to the left of the dot. */}
      {hex.belts && (
        <g class="hex-belt-glyph" aria-hidden="true">
          <circle cx={cx - HEX_R * 0.40} cy={cy + HEX_R * 0.08} r={0.9} />
          <circle cx={cx - HEX_R * 0.33} cy={cy + HEX_R * 0.18} r={0.7} />
          <circle cx={cx - HEX_R * 0.46} cy={cy + HEX_R * 0.20} r={0.6} />
        </g>
      )}
    </g>
  )
}

function BaseMarkers({ cx, cy, bases }: { cx: number; cy: number; bases: Bases }) {
  const markers: { x: number; y: number; symbol: string; cls: string }[] = []
  const rowY = cy - HEX_R * 0.38
  // Lay bases out left-to-right across the top half so multiple bases
  // don't overlap. Naval ★, Scout △, Research ◆, Aid ◯.
  let nextX = cx - HEX_R * 0.42
  const stepX = HEX_R * 0.28
  if (bases.naval) {
    markers.push({ x: nextX, y: rowY, symbol: '★', cls: 'base-naval' })
    nextX += stepX
  }
  if (bases.scout) {
    markers.push({ x: nextX, y: rowY, symbol: '△', cls: 'base-scout' })
    nextX += stepX
  }
  if (bases.research) {
    markers.push({ x: nextX, y: rowY, symbol: '◆', cls: 'base-research' })
    nextX += stepX
  }
  if (bases.Aid) {
    markers.push({ x: nextX, y: rowY, symbol: '◯', cls: 'base-Aid' })
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

function titleCase(s: string): string {
  // Cheap Title Case: capitalise every word's first letter, lowercase
  // the rest. Roman-numeral world suffixes like "II" stay uppercase
  // naturally because the names module emits them that way.
  return s.replace(/[A-Za-zÀ-ÿ]+/g, (word) => {
    if (/^[IVX]+$/i.test(word)) return word.toUpperCase()
    return word[0].toUpperCase() + word.slice(1).toLowerCase()
  })
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
  return `Hex ${hexLabel(hex.coord)}: UWP ${uwpToCode(hex.uwp)}${tail}`
}
