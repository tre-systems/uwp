import {
  selectedHex,
  selectHex,
  selectTerritoryHex,
  showJumpRoutes,
  subsectorSeed,
} from '../appState'
import {
  allegianceForCode,
  hexLabel,
  polityCells,
  polityBorders,
  routeDisplayKind,
  uwpToCode,
  visibleRoutes,
  type Bases,
  type HexCoord,
  type Subsector,
  type SubsectorHex,
  type TravelZone,
} from '../domain/subsector'
import { useRef, useState } from 'preact/hooks'
import { hexName, subsectorHexNames } from '../domain/names'
import { useMapGestures } from './useMapGestures'

// Subsector map styled after classic 2d6 sector charts: pure black field,
// thin grey flat-top
// hex grid, each occupied hex shows base markers across the top,
// starport letter above a filled system dot, world name below it,
// gas-giant / belt glyphs to the sides. Travel zones outline the hex
// (amber / red) instead of filling it. Jump routes are bright green
// strokes between hex centres.
//
// Geometry: FLAT-TOP hex with circumradius R. Horizontal centre step
// = 1.5 * R, vertical centre step = sqrt(3) * R. Odd columns shift
// DOWN by half a vertical step. Matches the classic sector-map convention
// exactly — point-east/west, flat top/bottom.

const HEX_R = 34
const HEX_H = HEX_R * Math.sqrt(3) // flat-to-flat height
const COL_STEP = HEX_R * 1.5
const ROW_STEP = HEX_H
const PAD_X = HEX_R * 1.1
const PAD_Y = HEX_H * 0.85

const DEFAULT_COLS = 8
const DEFAULT_ROWS = 10
// A lettered subsector block is the standard 8×10; a full sector tiles 4×4 of
// them, so a multi-subsector grid draws dividers on these boundaries.
const SUB_BLOCK_COLS = 8
const SUB_BLOCK_ROWS = 10

interface XY { x: number; y: number }

function hexCenter(col: number, row: number): XY {
  // 1-indexed grid; odd cols shift down half a row (legacy 2d6 convention).
  const cx = PAD_X + (col - 1) * COL_STEP
  const cy = PAD_Y + (row - 1) * ROW_STEP + (col % 2 === 0 ? ROW_STEP * 0.5 : 0)
  return { x: cx, y: cy }
}

function hexVertices(cx: number, cy: number, r: number): XY[] {
  const pts: XY[] = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * 60 * i
    pts.push({
      x: cx + r * Math.cos(a),
      y: cy + r * Math.sin(a),
    })
  }
  return pts
}

function mapWidth(columns: number): number {
  return PAD_X * 2 + (columns - 1) * COL_STEP + HEX_R
}

function mapHeight(rows: number): number {
  return PAD_Y * 2 + (rows - 1) * ROW_STEP + ROW_STEP * 0.5 + HEX_H * 0.5
}

function hexPath(cx: number, cy: number, r: number): string {
  // Flat-top hex: vertices at 0°, 60°, 120°, 180°, 240°, 300°.
  const pts = hexVertices(cx, cy, r).map((pt) => `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`)
  return `M${pts.join(' L')}Z`
}

function edgePath(col: number, row: number, edge: number): string {
  const { x, y } = hexCenter(col, row)
  const pts = hexVertices(x, y, HEX_R - 0.7)
  const a = pts[edge]
  const b = pts[(edge + 1) % pts.length]
  return `M${a.x.toFixed(2)},${a.y.toFixed(2)} L${b.x.toFixed(2)},${b.y.toFixed(2)}`
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
  // Dividers + letter labels for the lettered 8×10 subsector blocks that tile a
  // multi-subsector grid (a full sector). A single subsector draws none.
  const subBlocks = subsector?.subsectors ?? []
  const showBlocks = subBlocks.length > 1
  const colDividers = showBlocks
    ? Array.from({ length: Math.floor((columns - 1) / SUB_BLOCK_COLS) }, (_, i) => {
        const c = (i + 1) * SUB_BLOCK_COLS
        return (hexCenter(c, 1).x + hexCenter(c + 1, 1).x) * 0.5
      })
    : []
  const rowDividers = showBlocks
    ? Array.from({ length: Math.floor((rows - 1) / SUB_BLOCK_ROWS) }, (_, i) => {
        const r = (i + 1) * SUB_BLOCK_ROWS
        return (hexCenter(1, r).y + hexCenter(1, r + 1).y) * 0.5
      })
    : []
  const gestures = useMapGestures(containerRef, svgWidth, svgHeight)

  if (!subsector) {
    return (
      <div class="map-gesture-viewport" ref={containerRef}>
        <div class="subsector-map subsector-empty">
          <p>Generating subsector…</p>
        </div>
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
  const cells = polityCells(subsector)
  const polityByCoord = new Map(cells.map((cell) => [`${cell.coord.col},${cell.coord.row}`, cell]))
  const capitalCells = cells.filter((cell) => cell.capital)
  const borders = polityBorders(subsector)
  // Canonical, deduplicated, memoized name table shared with the breadcrumb
  // and hex panel so a world reads the same everywhere (see subsectorHexNames).
  const nameMap = subsectorHexNames(subsector)
  return (
    <div class="map-gesture-viewport" ref={containerRef}>
    <div
      class="subsector-map"
      role="region"
      aria-label={`Subsector ${subsector.allegiance}, seed ${subsector.seed}`}
    >
      <svg
        viewBox={gestures.viewBox}
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label={`${columns} by ${rows} subsector hex grid`}
      >
        {/* Routes sit below the hex outlines so the hex border reads as
            the connector boundary, matching the classic sector map look. */}
        {routesVisible && (
          <g class="jump-routes" aria-hidden="true">
            {visibleRoutes(subsector).map((route) => {
              const a = hexCenter(route.from.col, route.from.row)
              const b = hexCenter(route.to.col, route.to.row)
              const kind = routeDisplayKind(route)
              const kindClass = `jump-route-${kind === 'communication' ? 'comm' : kind}`
              return (
                <line
                  key={`${route.from.col},${route.from.row}-${route.to.col},${route.to.row}-${route.jump}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  class={`jump-route ${route.jump === 1 ? 'jump-route-1' : 'jump-route-2'} ${kindClass}`}
                  data-route={`${hexLabel(route.from)}-${hexLabel(route.to)}`}
                />
              )
            })}
          </g>
        )}
        <g class="polity-borders" aria-hidden="true">
          {borders.map((border) => (
            <g key={`${border.coord.col},${border.coord.row},${border.edge},${border.from},${border.to}`}>
              <path
                d={edgePath(border.coord.col, border.coord.row, border.edge)}
                class="polity-border-halo"
              />
              <path
                d={edgePath(border.coord.col, border.coord.row, border.edge)}
                class="polity-border-line"
              />
            </g>
          ))}
        </g>
        {(colDividers.length > 0 || rowDividers.length > 0) && (
          <g class="subsector-dividers" aria-hidden="true">
            {colDividers.map((x, i) => (
              <line key={`v${i}`} x1={x} y1={HEX_R * 0.35} x2={x} y2={svgHeight - HEX_R * 0.35} class="subsector-seam" />
            ))}
            {rowDividers.map((y, i) => (
              <line key={`h${i}`} x1={HEX_R * 0.35} y1={y} x2={svgWidth - HEX_R * 0.35} y2={y} class="subsector-seam" />
            ))}
          </g>
        )}
        {showBlocks && (
          <g class="subsector-letters" aria-hidden="true">
            {subBlocks.map((s) => {
              const p = hexCenter(s.col_min, s.row_min)
              return (
                <text key={s.letter} x={p.x - HEX_R * 0.55} y={p.y - HEX_H * 0.4} class="subsector-letter">
                  {s.letter}
                </text>
              )
            })}
          </g>
        )}
        {Array.from({ length: columns }, (_, i) => i + 1).flatMap((col) =>
          Array.from({ length: rows }, (_, j) => j + 1).map((row) => {
            const key = `${col},${row}`
            const hex = hexByCoord.get(key) ?? null
            const polityCell = polityByCoord.get(key) ?? null
            const allegiance = hex
              ? allegianceForCode(subsector, hex.allegiance)
              : polityCell
                ? allegianceForCode(subsector, polityCell.allegiance)
                : null
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
                allegianceColorIndex={allegiance?.color_index ?? 2}
                polityAllegiance={polityCell?.allegiance ?? null}
                polityName={allegiance?.name ?? null}
              />
            )
          }),
        )}
        <g class="polity-capitals" aria-hidden="true">
          {capitalCells.map((cell) => {
            const allegiance = allegianceForCode(subsector, cell.allegiance)
            const { x, y } = hexCenter(cell.coord.col, cell.coord.row)
            const mx = x + HEX_R * 0.42
            const my = y - HEX_R * 0.38
            return (
              <g
                key={`${cell.coord.col},${cell.coord.row},${cell.allegiance}`}
                class={`polity-capital polity-capital-${Math.max(0, Math.min(5, Math.trunc(allegiance?.color_index ?? 2)))}`}
              >
                <path d={`M${mx},${my - 6} L${mx + 6},${my} L${mx},${my + 6} L${mx - 6},${my}Z`} />
                <text x={mx} y={my - 8} text-anchor="middle">{cell.allegiance}</text>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
    {showBlocks && (
      <div class="subsector-jump" role="group" aria-label="Jump to subsector">
        {subBlocks.map((b) => {
          const a = hexCenter(b.col_min, b.row_min)
          const c = hexCenter(b.col_max, b.row_max)
          return (
            <button
              key={b.letter}
              type="button"
              class="subsector-jump-btn"
              title={`Frame subsector ${b.letter}`}
              onClick={() => gestures.focusRect(a.x - HEX_R, a.y - HEX_H / 2, c.x - a.x + 2 * HEX_R, c.y - a.y + HEX_H)}
            >
              {b.letter}
            </button>
          )
        })}
        <button type="button" class="subsector-jump-btn subsector-jump-all" title="Show the whole sector" onClick={gestures.reset}>
          All
        </button>
      </div>
    )}
    <SubsectorLegend />
    </div>
  )
}

// A collapsible key for the map glyphs. Defaults closed so it doesn't clutter
// the chart; the symbols match the hex markers (★ Naval, △ Scout, ◆ Research,
// ◯ Aid bases; starport letter; travel-zone rings; route colours).
function SubsectorLegend() {
  const [open, setOpen] = useState(false)
  return (
    <div class={`subsector-legend${open ? ' open' : ''}`}>
      <button type="button" class="subsector-legend-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide key' : 'Key'}
      </button>
      {open && (
        <ul class="subsector-legend-body">
          <li><span class="legend-glyph legend-port">A–E</span> Starport class (X = none)</li>
          <li><span class="legend-glyph base-naval">★</span> Naval base</li>
          <li><span class="legend-glyph base-scout">△</span> Scout base</li>
          <li><span class="legend-glyph base-research">◆</span> Research base</li>
          <li><span class="legend-glyph base-aid">◯</span> Aid base</li>
          <li><span class="legend-glyph legend-gas">◍</span> Gas giant · <span class="legend-glyph legend-belt">⋯</span> Belt</li>
          <li><span class="legend-swatch legend-amber" /> Amber · <span class="legend-swatch legend-red" /> Red zone</li>
          <li><span class="legend-line legend-trade" /> Trade · <span class="legend-line legend-comm" /> Comms route</li>
        </ul>
      )}
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
  allegianceColorIndex: number
  polityAllegiance: string | null
  polityName: string | null
}

function HexCell({
  col,
  row,
  cx,
  cy,
  hex,
  selected,
  subsectorSeed,
  displayName,
  allegianceColorIndex,
  polityAllegiance,
  polityName,
}: HexCellProps) {
  const label = `${col.toString().padStart(2, '0')}${row.toString().padStart(2, '0')}`
  const fullCoord: HexCoord = { col, row }
  if (!hex) {
    const territoryLabel = polityAllegiance
      ? `Hex ${label}: ${polityName ?? polityAllegiance} territory (no system)`
      : `Hex ${label}: unoccupied`
    return (
      <g
        class={`hex-cell hex-empty${selected ? ' hex-selected' : ''}`}
        data-coord={label}
        data-allegiance={polityAllegiance ?? undefined}
        tabIndex={0}
        role="button"
        aria-label={territoryLabel}
        onClick={() => selectTerritoryHex(fullCoord)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            selectTerritoryHex(fullCoord)
          }
        }}
      >
        <path d={hexPath(cx, cy, HEX_R)} class="hex-hit-area" aria-hidden="true" />
        {polityAllegiance && (
          <path
            d={hexPath(cx, cy, HEX_R - 1)}
            class={`hex-polity-fill polity-fill-${Math.max(0, Math.min(5, Math.trunc(allegianceColorIndex)))}`}
          />
        )}
        <path d={hexPath(cx, cy, HEX_R)} class="hex-shape" />
        <text x={cx} y={cy - HEX_R * 0.55} class="hex-label" text-anchor="middle">
          {label}
        </text>
      </g>
    )
  }
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
      <path
        d={hexPath(cx, cy, HEX_R)}
        class="hex-hit-area"
        aria-hidden="true"
      />
      {/* Grid outline (grey, continuous across the whole subsector). */}
      <path
        d={hexPath(cx, cy, HEX_R - 1)}
        class={`hex-polity-fill polity-fill-${Math.max(0, Math.min(5, Math.trunc(allegianceColorIndex)))}`}
      />
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
          matching the sector-map "GG" indicator. */}
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
  if (bases.aid) {
    markers.push({ x: nextX, y: rowY, symbol: '◯', cls: 'base-aid' })
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
  if (hex.bases.aid) flags.push('Aid')
  const tail = flags.length > 0 ? ' (' + flags.join(', ') + ')' : ''
  return `Hex ${hexLabel(hex.coord)}: UWP ${uwpToCode(hex.uwp)}, ${hex.travel_zone} zone, allegiance ${hex.allegiance}${tail}`
}
