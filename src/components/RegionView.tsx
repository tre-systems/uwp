import { useEffect, useRef, useState } from 'preact/hooks'
import {
  closeRegionView,
  currentSurfaceMap,
  params,
  regionHex,
  regionSurfaceCell,
} from '../appState'
import { hexCoordLabel, terrainLabel } from '../domain/surfaceMap'
import { systemName } from '../domain/names'
import { renderRegion, type RegionLabel } from '../regionRender'
import { useFocusTrap } from './useFocusTrap'

// Full-screen "Region" view shown when the user drills into a single
// surface hex. A high-density Canvas2D landscape (FBM terrain, rivers,
// biome flourishes, settlements) fills a large hex-clipped frame, with
// city / starport labels rendered as HTML on top so the text stays
// crisp regardless of the underlying canvas resolution.
//
// Dismiss via Escape, backdrop click, or the close affordance.

// Frame size tuned to fit within a typical laptop viewport while still
// leaving room for the modal header + padding.
const FRAME_WIDTH = 760
const FRAME_HEIGHT = 600

export function RegionView() {
  const hex = regionHex.value
  const exactCell = regionSurfaceCell.value
  const map = currentSurfaceMap.value
  const containerRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useFocusTrap(containerRef, hex != null)

  useEffect(() => {
    if (!hex) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRegionView()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hex])

  // The visible region detail is recomputed every time the focused hex
  // (or world seed) changes. Two-pass progressive render: a fast
  // preview paints on the next frame so the modal feels instant, then
  // a high-resolution pass replaces it on the frame after. The HTML
  // label overlay is set from whichever pass finishes most recently.
  const [labels, setLabels] = useState<RegionLabel[]>([])
  const [refining, setRefining] = useState(false)
  useEffect(() => {
    if (!hex || !map) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const surfaceHex = exactCell ?? map.hexes.find((h) => h.coord.col === hex.col && h.coord.row === hex.row)
    if (!surfaceHex) return

    // Devicepixelratio-scaled drawing buffer so the render stays sharp
    // on high-DPI displays. We keep the CSS size at FRAME_WIDTH x
    // FRAME_HEIGHT but scale the canvas backing store.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = FRAME_WIDTH * dpr
    canvas.height = FRAME_HEIGHT * dpr
    canvas.style.width = `${FRAME_WIDTH}px`
    canvas.style.height = `${FRAME_HEIGHT}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const selectedCellId = surfaceHex.cell_id ?? null
    const starport = surfaceCellMatches(map.starport_cell_id ?? null, selectedCellId) ||
      (!selectedCellId && map.starport && map.starport.col === hex.col && map.starport.row === hex.row)
      ? { name: 'Starport', x: 0.5, y: 0.55 }
      : null
    const settlements = map.cities
      .filter((s) => surfaceCellMatches(s.cell_id ?? null, selectedCellId) ||
        (!selectedCellId && s.coord.col === hex.col && s.coord.row === hex.row))
      .map((s, i) => ({
        // We don't have settlement coords within a hex from the Rust
        // model, so scatter cities deterministically inside the frame.
        name: cityName(map.seed, hex.col, hex.row, i),
        tier: s.tier,
        x: 0.25 + ((i * 0.41 + (s.tier % 3) * 0.18) % 0.55),
        y: 0.30 + ((i * 0.29 + s.tier * 0.11) % 0.45),
      }))

    const paint = (quality: 'preview' | 'final') => {
      ctx.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT)
      ctx.save()
      pathFlatTopHex(ctx, FRAME_WIDTH / 2, FRAME_HEIGHT / 2, FRAME_HEIGHT / 2 - 12)
      ctx.clip()
      const result = renderRegion(
        ctx,
        {
          hex: surfaceHex,
          worldSeed: map.seed,
          authoredHydroFraction: surfaceHexHydroFraction(map.ocean_fraction),
          width: FRAME_WIDTH,
          height: FRAME_HEIGHT,
          starport,
          settlements,
          paletteBase: {
            ocean: params.value.ocean_color,
            land: params.value.land_color,
            mountain: params.value.mountain_color,
            sand: params.value.sand_color,
            snow: params.value.snow_color,
          },
          atlas: map.atlas ?? null,
          selectedCellId,
        },
        quality,
      )
      ctx.restore()
      // Hex frame outline on top of the clipped scene.
      ctx.save()
      pathFlatTopHex(ctx, FRAME_WIDTH / 2, FRAME_HEIGHT / 2, FRAME_HEIGHT / 2 - 12)
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'
      ctx.stroke()
      ctx.restore()
      setLabels(result.labels)
    }

    let raf1 = 0
    let raf2 = 0
    let cancelled = false
    setRefining(true)
    // First frame: low-res preview so the modal has content within
    // ~25 ms. Run inside rAF so the modal layout settles before the
    // synchronous render blocks the main thread.
    raf1 = requestAnimationFrame(() => {
      if (cancelled) return
      paint('preview')
      // Second frame: high-resolution final paint. The user sees a
      // soft preview for one frame, then a sharp result.
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return
        paint('final')
        setRefining(false)
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [hex, exactCell, map])

  if (!hex || !map) return null
  const surfaceHex = exactCell ?? map.hexes.find((h) => h.coord.col === hex.col && h.coord.row === hex.row)
  if (!surfaceHex) return null

  const title = `${systemName(mix32(map.seed, mix32(hex.col, hex.row)))} (${hexCoordLabel(hex)})`
  const tempC = surfaceHex.temperature_k - 273.15
  const climateBand = climateBandLabel(surfaceHex.latitude_deg, surfaceHex.temperature_k)
  const rainfall = rainfallBandLabel(surfaceHex.latitude_deg, surfaceHex.temperature_k, surfaceHex.terrain)
  const subtitle = `${terrainLabel(surfaceHex.terrain)} · ${surfaceHex.temperature_k.toFixed(0)} K (${tempC.toFixed(0)} °C) · lat ${surfaceHex.latitude_deg.toFixed(1)}° · ${climateBand} · ${rainfall}`
  // 32 x 16 hex grid covers a sphere ~12,000 km in diameter for the
  // default Earth-class world. Translating one hex of that grid to its
  // physical width gives a rough scale for the region card.
  const planetRadiusKm = 6378
  const hexAngularWidthRad = (2 * Math.PI) / 32
  const hexKm = Math.round(planetRadiusKm * hexAngularWidthRad)

  return (
    <div
      class="region-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="region-title"
      onClick={closeRegionView}
    >
      <div
        class="region-modal"
        ref={containerRef}
        onClick={(e) => e.stopPropagation()}
      >
        <header class="region-header">
          <div>
            <h2 id="region-title">{title}</h2>
            <p class="region-subtitle">{subtitle}</p>
          </div>
          <button
            ref={closeRef}
            class="glossary-close region-close"
            onClick={closeRegionView}
            aria-label="Close region view"
          >
            ✕
          </button>
        </header>
        <div class="region-canvas-wrap" style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT }}>
          <canvas ref={canvasRef} class="region-canvas" />
          {refining && (
            <div class="region-refining" aria-hidden="true">refining…</div>
          )}
          {labels.map((l, i) => (
            <div
              key={i}
              class={`region-label region-label-${l.kind} region-label-tier-${l.tier}`}
              style={{ left: `${l.x}px`, top: `${l.y}px` }}
            >
              {l.text}
            </div>
          ))}
          {/* Compass rose: north points toward the lit hemisphere. */}
          <div class="region-compass" aria-hidden="true">
            <svg viewBox="0 0 40 40" width="44" height="44">
              <circle cx="20" cy="20" r="18" />
              <polygon points="20,4 24,20 20,16 16,20" class="region-compass-north" />
              <polygon points="20,36 24,20 20,24 16,20" class="region-compass-south" />
              <text x="20" y="10" class="region-compass-letter" text-anchor="middle">N</text>
            </svg>
          </div>
          {/* Scale bar: 1 hex ~ planet circumference / 32. */}
          <div class="region-scale" aria-hidden="true">
            <div class="region-scale-bar" />
            <span>{hexKm.toLocaleString()} km</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function pathFlatTopHex(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * 60 * i
    const x = cx + r * Math.cos(a)
    const y = cy + r * Math.sin(a)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

function cityName(worldSeed: number, col: number, row: number, idx: number): string {
  // Mirrors the SurfaceMap label generation so the same settlement keeps
  // the same name across the two views.
  const mixed = ((worldSeed >>> 0) * 0x9e3779b9 + ((col << 16) | row) + idx * 0x85ebca6b) >>> 0
  return systemName(mixed)
}

function surfaceHexHydroFraction(oceanFraction: number): number {
  // The renderer uses this to bias lakes/rivers on inland hexes; clamp to a
  // gentle band so even arid worlds get a hint of moisture in forest hexes.
  return Math.max(0.1, Math.min(0.9, oceanFraction))
}

function mix32(a: number, b: number): number {
  let h = ((a >>> 0) * 0x9e3779b9 + (b >>> 0)) >>> 0
  h = ((h ^ (h >>> 16)) * 0x85ebca6b) >>> 0
  h = ((h ^ (h >>> 13)) * 0xc2b2ae35) >>> 0
  return h ^ (h >>> 16)
}

function surfaceCellMatches(
  a: import('../domain/surfaceMap').SurfaceCellId | null,
  b: import('../domain/surfaceMap').SurfaceCellId | null,
): boolean {
  return !!a && !!b &&
    a.face === b.face &&
    a.i === b.i &&
    a.j === b.j &&
    a.up === b.up &&
    a.resolution === b.resolution
}

function climateBandLabel(latDeg: number, tempK: number): string {
  const absLat = Math.abs(latDeg)
  if (tempK > 320) return 'Hyperthermal'
  if (tempK < 235) return 'Polar deep-freeze'
  if (absLat < 23.5) return 'Tropical'
  if (absLat < 35) return 'Subtropical'
  if (absLat < 55) return 'Temperate'
  if (absLat < 66.5) return 'Subarctic'
  return 'Polar'
}

function rainfallBandLabel(latDeg: number, tempK: number, terrain: import('../domain/surfaceMap').Terrain): string {
  // Caricature of the Hadley / Ferrel / polar precipitation belts: rain
  // belt at the equator and around 55°, dry belts around the
  // subtropical highs (~30°) and the poles.
  if (terrain === 'Ocean') return 'Marine'
  if (terrain === 'Ice') return 'Sublimating'
  const absLat = Math.abs(latDeg)
  if (tempK < 240) return 'Bone-dry frost'
  if (tempK > 320) return 'Arid'
  if (absLat < 12) return 'High rainfall'
  if (absLat < 35) return 'Dry belt'
  if (absLat < 60) return 'Moderate rainfall'
  return 'Cold dry'
}
