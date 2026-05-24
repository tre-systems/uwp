import {
  currentSystem,
  uwp,
  uwpToCode,
  viewMode,
} from './appState'
import { deriveTradeCodes, tradeCodeName } from './domain/cepheus'

// PNG export pipeline.
//
// WebGPU canvases produce a valid bitmap from `toBlob()` as long as the
// page rendered into them this frame. We schedule the capture inside a
// requestAnimationFrame so the renderer's render loop has just flushed
// a fresh frame, then either:
//   - "frame"   - download the canvas verbatim, or
//   - "card"    - composite onto a 2D canvas with the UWP + trade codes
//                 painted underneath, suitable for VTT sharing.
//
// No Rust changes needed; the existing surface texture round-trips
// through the browser's canvas snapshot path.

type ExportKind = 'frame' | 'card'

const FRAME_FILENAME = 'uwp-frame.png'
const CARD_FILENAME = 'uwp-planet-card.png'

interface ExportResult {
  ok: boolean
  error?: string
}

export async function exportCanvas(kind: ExportKind): Promise<ExportResult> {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas.planet-canvas')
  if (!canvas) return { ok: false, error: 'Canvas not found' }
  if (canvas.width === 0 || canvas.height === 0) {
    return { ok: false, error: 'Canvas has zero size; try resizing the window.' }
  }
  // requestAnimationFrame ensures the renderer has finished drawing
  // this frame's swap-chain texture before we ask the browser for a
  // snapshot - otherwise WebGPU canvases sometimes serialise an empty
  // bitmap.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  if (kind === 'frame') {
    return downloadFromCanvas(canvas, FRAME_FILENAME)
  }
  return exportPlanetCard(canvas)
}

function downloadFromCanvas(source: HTMLCanvasElement, filename: string): Promise<ExportResult> {
  return new Promise((resolve) => {
    source.toBlob((blob) => {
      if (!blob || blob.size === 0) {
        resolve({ ok: false, error: 'Browser returned an empty image. Try again.' })
        return
      }
      triggerDownload(blob, filename)
      resolve({ ok: true })
    }, 'image/png')
  })
}

async function exportPlanetCard(source: HTMLCanvasElement): Promise<ExportResult> {
  // Width slightly wider than the source so the metadata column fits
  // beside the render. Height grows to accommodate trade-code chips.
  const renderW = Math.min(source.width, 1024)
  const renderH = Math.round((renderW / source.width) * source.height)
  const cardW = renderW + 320
  const cardH = Math.max(renderH, 420) + 80
  const card = document.createElement('canvas')
  card.width = cardW
  card.height = cardH
  const ctx = card.getContext('2d')
  if (!ctx) return { ok: false, error: 'Browser refused a 2D context.' }

  // Background gradient that matches the dark UI surface.
  const grad = ctx.createLinearGradient(0, 0, 0, cardH)
  grad.addColorStop(0, '#0a0e16')
  grad.addColorStop(1, '#020408')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, cardW, cardH)

  // Render area: draw the canvas content via createImageBitmap so the
  // GPU-backed canvas content is copied verbatim onto our 2D ctx.
  try {
    const bitmap = await createImageBitmap(source)
    ctx.drawImage(bitmap, 40, 40, renderW, renderH)
    bitmap.close()
  } catch (err) {
    return { ok: false, error: `Snapshot failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  // Subtle border around the render.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
  ctx.lineWidth = 1
  ctx.strokeRect(40, 40, renderW, renderH)

  // Metadata column on the right.
  paintMetadata(ctx, renderW + 60, 40, cardW - renderW - 100, cardH - 80)

  // Footer credit.
  ctx.fillStyle = 'rgba(141, 150, 168, 0.7)'
  ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  ctx.fillText('uwp.tre.systems', 40, cardH - 24)

  return new Promise<ExportResult>((resolve) => {
    card.toBlob((blob) => {
      if (!blob || blob.size === 0) {
        resolve({ ok: false, error: 'Composite blob came back empty.' })
        return
      }
      triggerDownload(blob, CARD_FILENAME)
      resolve({ ok: true })
    }, 'image/png')
  })
}

function paintMetadata(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, _h: number) {
  const mode = viewMode.value
  const u = uwp.value
  const sys = currentSystem.value
  const codeText = uwpToCode(u)
  const tradeCodes = deriveTradeCodes(u)

  let cursorY = y + 12
  ctx.fillStyle = '#d8dde7'
  ctx.font = '600 18px -apple-system, BlinkMacSystemFont, Inter, "Segoe UI", Roboto, sans-serif'
  const headerText = mode === 'subsector' ? 'Subsector' : mode === 'system' ? 'System' : 'Main World'
  ctx.fillText(headerText, x, cursorY + 16)
  cursorY += 36

  if (mode === 'detail' || mode === 'system') {
    ctx.fillStyle = '#6ea4ff'
    ctx.font = '700 24px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    ctx.fillText(codeText, x, cursorY + 22)
    cursorY += 44

    ctx.fillStyle = 'rgba(141, 150, 168, 1)'
    ctx.font = '12px -apple-system, BlinkMacSystemFont, Inter, sans-serif'
    ctx.fillText('UNIVERSAL WORLD PROFILE', x, cursorY + 12)
    cursorY += 32
  }

  if (sys) {
    const star = sys.star
    const lines = [
      `Primary: ${star.spectral}-class · ${star.mass_solar.toFixed(2)} M⊙`,
      `Luminosity: ${star.luminosity_solar < 0.01 ? star.luminosity_solar.toExponential(2) : star.luminosity_solar.toFixed(2)} L⊙`,
      `T_eff: ${star.temperature_k.toFixed(0)} K`,
      `Habitable zone: ${sys.hz_inner_au.toFixed(2)} – ${sys.hz_outer_au.toFixed(2)} AU`,
      `Snow line: ${sys.snow_line_au.toFixed(2)} AU`,
      `Age: ${sys.age_gyr.toFixed(1)} Gyr`,
      `Planets: ${sys.planets.length}`,
    ]
    ctx.fillStyle = 'rgba(216, 221, 231, 0.85)'
    ctx.font = '13px -apple-system, BlinkMacSystemFont, Inter, sans-serif'
    for (const line of lines) {
      ctx.fillText(line, x, cursorY + 14)
      cursorY += 20
    }
    cursorY += 8
  }

  if (tradeCodes.length > 0) {
    ctx.fillStyle = 'rgba(141, 150, 168, 1)'
    ctx.font = '11px -apple-system, BlinkMacSystemFont, Inter, sans-serif'
    ctx.fillText('TRADE CODES', x, cursorY + 12)
    cursorY += 22

    // Chips
    let chipX = x
    ctx.font = '700 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    for (const code of tradeCodes) {
      const label = code
      const metrics = ctx.measureText(label)
      const chipW = Math.max(28, Math.round(metrics.width + 16))
      const chipH = 22
      if (chipX + chipW > x + w) {
        chipX = x
        cursorY += chipH + 6
      }
      ctx.fillStyle = 'rgba(110, 164, 255, 0.18)'
      drawRoundedRect(ctx, chipX, cursorY, chipW, chipH, 4)
      ctx.fill()
      ctx.strokeStyle = 'rgba(110, 164, 255, 0.50)'
      ctx.stroke()
      ctx.fillStyle = '#d8dde7'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, chipX + 8, cursorY + chipH / 2 + 1)
      ctx.textBaseline = 'alphabetic'
      // Inline title in a faded subtitle below the chip is too noisy;
      // keep the chip standalone like the on-screen UI.
      void tradeCodeName(code)
      chipX += chipW + 6
    }
    cursorY += 30
  }
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Defer the revoke until the browser has finished its download
  // bookkeeping; immediate revoke can lose the blob in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}
