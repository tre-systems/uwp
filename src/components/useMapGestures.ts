import { useEffect, useRef, useState, type StateUpdater } from 'preact/hooks'
import type { RefObject } from 'preact'

// Reusable pinch-zoom + pan controller for any SVG element that wants
// to support touch + wheel gestures.
//
// The hook returns a `viewBox` string the caller hands to its <svg>
// element, plus pointer + wheel handlers it spreads onto the parent
// container. Internal state tracks an offset (in viewBox units) and a
// zoom factor (1 = fit).
//
// Geometry: the canonical content fits a `[0, 0, srcW, srcH]` viewBox.
// On zoom we shrink that box around the cursor; on pan we shift its
// origin. The SVG element itself does the rest.

export interface MapGestures {
  viewBox: string
  handlers: {
    onWheel: (e: WheelEvent) => void
    onPointerDown: (e: PointerEvent) => void
    onPointerMove: (e: PointerEvent) => void
    onPointerUp: (e: PointerEvent) => void
    onPointerCancel: (e: PointerEvent) => void
  }
  reset: () => void
}

export function useMapGestures(
  containerRef: RefObject<HTMLElement>,
  srcW: number,
  srcH: number,
): MapGestures {
  // `zoom > 1` = zoomed-in; clamp so the user can't shrink the content
  // below the visible bounds or push it ten parsecs sideways.
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchDist = useRef<number | null>(null)
  const dragging = useRef(false)
  const lastDrag = useRef({ x: 0, y: 0 })

  // Reset whenever the container dimensions change (e.g. tab swap that
  // affects layout). Without this an old zoom would carry over to the
  // next map.
  useEffect(() => {
    const reset = () => {
      setZoom(1)
      setOffset({ x: 0, y: 0 })
    }
    reset()
  }, [srcW, srcH])

  function clampOffset(next: { x: number; y: number }, currentZoom: number): { x: number; y: number } {
    const visibleW = srcW / currentZoom
    const visibleH = srcH / currentZoom
    const maxX = srcW - visibleW
    const maxY = srcH - visibleH
    return {
      x: clamp(next.x, 0, Math.max(0, maxX)),
      y: clamp(next.y, 0, Math.max(0, maxY)),
    }
  }

  function applyZoom(rawZoom: number, anchorX: number, anchorY: number) {
    const next = clamp(rawZoom, 1, 6)
    if (next === zoom) return
    // Keep the point under the cursor stable: world point at the
    // anchor stays at the same anchor after the zoom.
    const worldX = offset.x + anchorX / zoom
    const worldY = offset.y + anchorY / zoom
    const nextOffset = clampOffset({
      x: worldX - anchorX / next,
      y: worldY - anchorY / next,
    }, next)
    setZoom(next)
    setOffset(nextOffset)
  }

  function screenToViewbox(clientX: number, clientY: number): { x: number; y: number } {
    const el = containerRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    const ux = (clientX - rect.left) / rect.width
    const uy = (clientY - rect.top) / rect.height
    return { x: ux * srcW, y: uy * srcH }
  }

  const handlers = {
    onWheel: (e: WheelEvent) => {
      e.preventDefault()
      const anchor = screenToViewbox(e.clientX, e.clientY)
      const factor = Math.exp(-e.deltaY * 0.0015)
      applyZoom(zoom * factor, anchor.x, anchor.y)
    },
    onPointerDown: (e: PointerEvent) => {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      // Note: we deliberately do NOT setPointerCapture here. Capturing
      // would steal subsequent click events from inner SVG hex cells,
      // breaking selection. The trade-off is that fast drags that
      // leave the container lose tracking; for our small map sizes
      // that's fine.
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()]
        pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y)
        dragging.current = false
      } else if (pointers.current.size === 1) {
        dragging.current = false  // Promoted to true only after the first move > threshold.
        lastDrag.current = { x: e.clientX, y: e.clientY }
      }
    },
    onPointerMove: (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.current.size === 2 && pinchDist.current != null) {
        const [a, b] = [...pointers.current.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        const ratio = d / pinchDist.current
        pinchDist.current = d
        const cx = (a.x + b.x) / 2
        const cy = (a.y + b.y) / 2
        const anchor = screenToViewbox(cx, cy)
        applyZoom(zoom * ratio, anchor.x, anchor.y)
      } else if (pointers.current.size === 1) {
        // Promote to drag only after the pointer has moved a few pixels
        // - prevents tiny finger / mouse jitter on click from being
        // interpreted as a pan, which would then suppress the click.
        const moveX = Math.abs(e.clientX - lastDrag.current.x)
        const moveY = Math.abs(e.clientY - lastDrag.current.y)
        if (!dragging.current && moveX + moveY < 4) return
        dragging.current = true
        const el = containerRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const dx = (e.clientX - lastDrag.current.x) * (srcW / rect.width) / zoom
        const dy = (e.clientY - lastDrag.current.y) * (srcH / rect.height) / zoom
        lastDrag.current = { x: e.clientX, y: e.clientY }
        setOffset((prev) => clampOffset({ x: prev.x - dx, y: prev.y - dy }, zoom))
      }
    },
    onPointerUp: (e: PointerEvent) => {
      pointers.current.delete(e.pointerId)
      if (pointers.current.size < 2) pinchDist.current = null
      if (pointers.current.size === 0) dragging.current = false
    },
    onPointerCancel: (e: PointerEvent) => {
      pointers.current.delete(e.pointerId)
      if (pointers.current.size < 2) pinchDist.current = null
      if (pointers.current.size === 0) dragging.current = false
    },
  }

  const visibleW = srcW / zoom
  const visibleH = srcH / zoom
  const viewBox = `${offset.x.toFixed(2)} ${offset.y.toFixed(2)} ${visibleW.toFixed(2)} ${visibleH.toFixed(2)}`

  return {
    viewBox,
    handlers,
    reset: () => {
      setZoom(1)
      setOffset({ x: 0, y: 0 })
    },
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

// Re-export the StateUpdater type so files that import this hook
// don't need to pull from preact/hooks separately.
export type { StateUpdater }
