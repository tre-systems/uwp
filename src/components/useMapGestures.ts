import { useEffect, useRef, useState, type StateUpdater } from 'preact/hooks'
import type { RefObject } from 'preact'

// Reusable pinch-zoom + pan controller for any SVG element that wants
// to support touch + wheel gestures.
//
// The hook returns a `viewBox` string the caller hands to its <svg>
// element. Listeners attach with { passive: false } so pinch/drag can
// call preventDefault and win over browser page zoom on mobile.

export interface MapGestures {
  viewBox: string
  reset: () => void
}

export function useMapGestures(
  containerRef: RefObject<HTMLElement>,
  srcW: number,
  srcH: number,
): MapGestures {
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const zoomRef = useRef(1)
  const offsetRef = useRef({ x: 0, y: 0 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchDist = useRef<number | null>(null)
  const dragging = useRef(false)
  const lastDrag = useRef({ x: 0, y: 0 })

  zoomRef.current = zoom
  offsetRef.current = offset

  useEffect(() => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }, [srcW, srcH])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

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
      if (next === zoomRef.current) return
      const off = offsetRef.current
      const z = zoomRef.current
      const worldX = off.x + anchorX / z
      const worldY = off.y + anchorY / z
      const nextOffset = clampOffset({
        x: worldX - anchorX / next,
        y: worldY - anchorY / next,
      }, next)
      zoomRef.current = next
      offsetRef.current = nextOffset
      setZoom(next)
      setOffset(nextOffset)
    }

    function screenToViewbox(clientX: number, clientY: number): { x: number; y: number } {
      const rect = el!.getBoundingClientRect()
      const ux = (clientX - rect.left) / rect.width
      const uy = (clientY - rect.top) / rect.height
      return { x: ux * srcW, y: uy * srcH }
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const anchor = screenToViewbox(e.clientX, e.clientY)
      const factor = Math.exp(-e.deltaY * 0.0015)
      applyZoom(zoomRef.current * factor, anchor.x, anchor.y)
    }

    function onPointerDown(e: PointerEvent) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()]
        pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y)
        dragging.current = false
        if (e.cancelable) e.preventDefault()
      } else if (pointers.current.size === 1) {
        dragging.current = false
        lastDrag.current = { x: e.clientX, y: e.clientY }
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (!pointers.current.has(e.pointerId)) return
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.current.size === 2 && pinchDist.current != null) {
        if (e.cancelable) e.preventDefault()
        const [a, b] = [...pointers.current.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        const ratio = d / pinchDist.current
        pinchDist.current = d
        const cx = (a.x + b.x) / 2
        const cy = (a.y + b.y) / 2
        const anchor = screenToViewbox(cx, cy)
        applyZoom(zoomRef.current * ratio, anchor.x, anchor.y)
      } else if (pointers.current.size === 1) {
        const moveX = Math.abs(e.clientX - lastDrag.current.x)
        const moveY = Math.abs(e.clientY - lastDrag.current.y)
        if (!dragging.current && moveX + moveY < 4) return
        if (e.pointerType === 'touch') e.preventDefault()
        dragging.current = true
        if (e.cancelable) e.preventDefault()
        const rect = el!.getBoundingClientRect()
        const dx = (e.clientX - lastDrag.current.x) * (srcW / rect.width) / zoomRef.current
        const dy = (e.clientY - lastDrag.current.y) * (srcH / rect.height) / zoomRef.current
        lastDrag.current = { x: e.clientX, y: e.clientY }
        const next = clampOffset({
          x: offsetRef.current.x - dx,
          y: offsetRef.current.y - dy,
        }, zoomRef.current)
        offsetRef.current = next
        setOffset(next)
      }
    }

    function onPointerUp(e: PointerEvent) {
      pointers.current.delete(e.pointerId)
      if (pointers.current.size < 2) pinchDist.current = null
      if (pointers.current.size === 0) dragging.current = false
    }

    const opts = { passive: false } as const
    el.addEventListener('wheel', onWheel, opts)
    el.addEventListener('pointerdown', onPointerDown, opts)
    el.addEventListener('pointermove', onPointerMove, opts)
    el.addEventListener('pointerup', onPointerUp, opts)
    el.addEventListener('pointercancel', onPointerUp, opts)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
    }
  }, [containerRef, srcW, srcH])

  const visibleW = srcW / zoom
  const visibleH = srcH / zoom
  const viewBox = `${offset.x.toFixed(2)} ${offset.y.toFixed(2)} ${visibleW.toFixed(2)} ${visibleH.toFixed(2)}`

  return {
    viewBox,
    reset: () => {
      zoomRef.current = 1
      offsetRef.current = { x: 0, y: 0 }
      setZoom(1)
      setOffset({ x: 0, y: 0 })
    },
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

export type { StateUpdater }
