import { useEffect, useRef, useState } from 'preact/hooks'
import {
  closeRegionView,
  currentSurfaceMap,
  regionHex,
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

const FRAME_WIDTH = 900
const FRAME_HEIGHT = 780

export function RegionView() {
  const hex = regionHex.value
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
  // (or world seed) changes. We render into the canvas inside an effect
  // so the result repaints with the latest hex data, and stash labels
  // in state so the HTML overlay re-renders on the next pass.
  const [labels, setLabels] = useState<RegionLabel[]>([])
  useEffect(() => {
    if (!hex || !map) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const surfaceHex = map.hexes.find((h) => h.coord.col === hex.col && h.coord.row === hex.row)
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
    ctx.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT)

    // Clip the drawing region to a large flat-top hexagon centred in
    // the canvas. The procedural renderer paints into the unclipped
    // canvas; the clip keeps everything inside the hex frame.
    ctx.save()
    pathFlatTopHex(ctx, FRAME_WIDTH / 2, FRAME_HEIGHT / 2, FRAME_HEIGHT / 2 - 12)
    ctx.clip()

    const starport = map.starport && map.starport.col === hex.col && map.starport.row === hex.row
      ? { name: 'Starport', x: 0.5, y: 0.55 }
      : null
    const settlements = map.cities
      .filter((s) => s.coord.col === hex.col && s.coord.row === hex.row)
      .map((s, i) => ({
        // We don't have settlement coords within a hex from the Rust
        // model, so scatter cities deterministically inside the frame.
        name: cityName(map.seed, hex.col, hex.row, i),
        tier: s.tier,
        x: 0.25 + ((i * 0.41 + (s.tier % 3) * 0.18) % 0.55),
        y: 0.30 + ((i * 0.29 + s.tier * 0.11) % 0.45),
      }))

    const result = renderRegion(ctx, {
      hex: surfaceHex,
      worldSeed: map.seed,
      authoredHydroFraction: surfaceHexHydroFraction(map.ocean_fraction),
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      starport,
      settlements,
    })
    ctx.restore()

    // Draw the hex frame outline on top of the clipped scene.
    ctx.save()
    pathFlatTopHex(ctx, FRAME_WIDTH / 2, FRAME_HEIGHT / 2, FRAME_HEIGHT / 2 - 12)
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'
    ctx.stroke()
    ctx.restore()

    setLabels(result.labels)
  }, [hex, map])

  if (!hex || !map) return null
  const surfaceHex = map.hexes.find((h) => h.coord.col === hex.col && h.coord.row === hex.row)
  if (!surfaceHex) return null

  const title = `${systemName(mix32(map.seed, mix32(hex.col, hex.row)))} (${hexCoordLabel(hex)})`
  const subtitle = `${terrainLabel(surfaceHex.terrain)} · ${surfaceHex.temperature_k.toFixed(0)} K · lat ${surfaceHex.latitude_deg.toFixed(1)}°`

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
            X
          </button>
        </header>
        <div class="region-canvas-wrap" style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT }}>
          <canvas ref={canvasRef} class="region-canvas" />
          {labels.map((l, i) => (
            <div
              key={i}
              class={`region-label region-label-${l.kind} region-label-tier-${l.tier}`}
              style={{ left: `${l.x}px`, top: `${l.y}px` }}
            >
              {l.text}
            </div>
          ))}
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
