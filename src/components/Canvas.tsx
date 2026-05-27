import { useEffect, useRef } from 'preact/hooks'
import {
  focusSystemTarget,
  pickSystemBody,
  setHoverTarget,
  viewMode,
} from '../appState'
import { RendererClient } from '../rendererClient'

// The renderer only owns the GPU pipeline. Pointer routing for hover
// tooltips and click-to-zoom lives here so the renderer client stays
// canvas-agnostic.

const HOVER_THROTTLE_MS = 50
const PICK_DRAG_THRESHOLD_PX = 8

export function Canvas() {
  const ref = useRef<HTMLCanvasElement>(null)
  const lastHoverPick = useRef<{ x: number; y: number; t: number }>({ x: 0, y: 0, t: 0 })
  const pointerDown = useRef<{ x: number; y: number } | null>(null)

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
      const target = pickSystemBody(x, y, now)
      if (target == null) {
        setHoverTarget(null)
      } else {
        setHoverTarget({ ...target, x, y })
      }
    }

    function onLeave() {
      setHoverTarget(null)
      pointerDown.current = null
    }

    function onPointerDown(e: PointerEvent) {
      if (viewMode.value !== 'system' || e.button !== 0) return
      const { x, y } = canvasPoint(e)
      pointerDown.current = { x, y }
    }

    function onPointerUp(e: PointerEvent) {
      if (viewMode.value !== 'system') return
      if (e.button !== 0) return
      const start = pointerDown.current
      pointerDown.current = null
      if (!start) return
      const { x, y } = canvasPoint(e)
      const dx = x - start.x
      const dy = y - start.y
      if (dx * dx + dy * dy > PICK_DRAG_THRESHOLD_PX * PICK_DRAG_THRESHOLD_PX) return
      const target = pickSystemBody(x, y, performance.now())
      if (target != null) {
        focusSystemTarget(target)
      }
    }

    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)

    return () => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
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
      tabIndex={-1}
    />
  )
}
