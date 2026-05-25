import { useEffect, useRef } from 'preact/hooks'
import {
  pickSystemPlanet,
  setHoverTarget,
  setViewMode,
  viewMode,
} from '../appState'
import { RendererClient } from '../rendererClient'

// The renderer only owns the GPU pipeline. Pointer routing for hover
// tooltips and click-to-zoom lives here so the renderer client stays
// canvas-agnostic.

const HOVER_THROTTLE_MS = 50

export function Canvas() {
  const ref = useRef<HTMLCanvasElement>(null)
  const lastHoverPick = useRef<{ x: number; y: number; t: number }>({ x: 0, y: 0, t: 0 })

  useEffect(() => {
    const canvas = ref.current!
    const client = new RendererClient(canvas)
    void client.start()

    function canvasPoint(event: PointerEvent | MouseEvent): { x: number; y: number } {
      const rect = canvas.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }

    function onMove(e: PointerEvent) {
      if (viewMode.value !== 'system') {
        if (lastHoverPick.current.t !== 0) {
          setHoverTarget(null)
          lastHoverPick.current.t = 0
        }
        return
      }
      const now = performance.now()
      if (now - lastHoverPick.current.t < HOVER_THROTTLE_MS) return
      const { x, y } = canvasPoint(e)
      lastHoverPick.current = { x, y, t: now }
      const idx = pickSystemPlanet(x, y, now)
      if (idx == null) {
        setHoverTarget(null)
      } else {
        setHoverTarget({ index: idx, x, y })
      }
    }

    function onLeave() {
      setHoverTarget(null)
    }

    function onClick(e: MouseEvent) {
      if (viewMode.value !== 'system') return
      const { x, y } = canvasPoint(e)
      const idx = pickSystemPlanet(x, y, performance.now())
      if (idx != null) {
        // Click-to-zoom: drop into Main World view, focused on the picked
        // planet's host star. (Per-planet camera-fly is the next step.)
        setViewMode('detail')
      }
    }

    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('click', onClick)

    return () => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('click', onClick)
      setHoverTarget(null)
      client.dispose()
    }
  }, [])

  return (
    <canvas
      ref={ref}
      class="planet-canvas"
      role="img"
      aria-label="Interactive 3D rendering of the generated planet or solar system. Drag to orbit, pinch or scroll to zoom."
      tabIndex={0}
    />
  )
}
