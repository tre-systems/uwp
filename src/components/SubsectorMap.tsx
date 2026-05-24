import {
  selectedHex,
  selectHex,
} from '../appState'
import {
  hexLabel,
  uwpDigitChar,
  type Bases,
  type HexCoord,
  type Subsector,
  type SubsectorHex,
  type TravelZone,
} from '../domain/subsector'

// Cepheus subsector map: 8 columns x 10 rows of pointy-top hexes laid out
// with odd columns vertically offset. The map renders as a single SVG so
// it scales cleanly and stays accessible to keyboard users.
//
// Geometry: pointy-top hex with circumradius R. Horizontal step = R * sqrt(3),
// vertical step = R * 1.5. Odd columns shift down by half a vertical step so
// neighbouring hexes share edges.

const HEX_R = 26               // hex circumradius in SVG units
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
        <defs>
          <pattern id="hex-empty" patternUnits="userSpaceOnUse" width="6" height="6">
            <path d="M0 0l6 6M-1 5l2 2M5 -1l2 2" stroke="rgba(255,255,255,0.04)" stroke-width="0.6" />
          </pattern>
        </defs>
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
}

function HexCell({ col, row, cx, cy, hex, selected }: HexCellProps) {
  const label = `${col.toString().padStart(2, '0')}${row.toString().padStart(2, '0')}`
  if (!hex) {
    return (
      <g class="hex-cell hex-empty" data-coord={label}>
        <path d={hexPath(cx, cy, HEX_R)} class="hex-shape" fill="url(#hex-empty)" />
        <text x={cx} y={cy + HEX_R - 4} class="hex-label" text-anchor="middle">
          {label}
        </text>
      </g>
    )
  }
  const fullCoord: HexCoord = { col, row }
  const zoneClass = travelZoneClass(hex.travel_zone)
  const portClass = `port-${hex.uwp.starport.toLowerCase()}`
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
      <path d={hexPath(cx, cy, HEX_R)} class="hex-shape" />
      <circle cx={cx} cy={cy - HEX_R * 0.42} r={3.2} class="hex-system-dot" />
      <text x={cx} y={cy - 2} class="hex-uwp" text-anchor="middle">
        {hex.uwp.starport}
        {uwpDigitChar(hex.uwp.size)}
        {uwpDigitChar(hex.uwp.atm)}
        {uwpDigitChar(hex.uwp.hydro)}
      </text>
      <text x={cx} y={cy + 9} class="hex-uwp-row2" text-anchor="middle">
        {uwpDigitChar(hex.uwp.pop)}
        {uwpDigitChar(hex.uwp.gov)}
        {uwpDigitChar(hex.uwp.law)}-{uwpDigitChar(hex.uwp.tech)}
      </text>
      <BaseMarkers cx={cx} cy={cy} bases={hex.bases} />
      {(hex.gas_giant || hex.belts) && (
        <text x={cx + HEX_R * 0.55} y={cy + HEX_R * 0.45} class="hex-flags" text-anchor="middle">
          {hex.gas_giant ? '◉' : ''}{hex.belts ? '·' : ''}
        </text>
      )}
      <text x={cx} y={cy + HEX_R - 4} class="hex-label" text-anchor="middle">
        {label}
      </text>
    </g>
  )
}

function BaseMarkers({ cx, cy, bases }: { cx: number; cy: number; bases: Bases }) {
  const markers: { x: number; y: number; ch: string; cls: string }[] = []
  const baseX = cx - HEX_R * 0.55
  const baseY = cy - HEX_R * 0.05
  if (bases.naval) markers.push({ x: baseX, y: baseY, ch: 'N', cls: 'base-naval' })
  if (bases.scout) markers.push({ x: baseX, y: baseY + 10, ch: 'S', cls: 'base-scout' })
  if (bases.research) markers.push({ x: baseX, y: baseY + 20, ch: 'R', cls: 'base-research' })
  if (bases.Aid) markers.push({ x: baseX + 10, y: baseY + 20, ch: 'T', cls: 'base-Aid' })
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
          {m.ch}
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
