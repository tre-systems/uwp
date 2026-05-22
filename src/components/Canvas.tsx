import { useEffect, useRef } from 'preact/hooks'
import { effect } from '@preact/signals'
import init, { Planet } from '../../pkg/planet_render'
import { errorMessage, params } from '../state'

let wasmReady: Promise<void> | null = null
function ensureWasm() {
  if (!wasmReady) wasmReady = init().then(() => undefined)
  return wasmReady
}

export function Canvas() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current!
    let planet: Planet | null = null
    let raf = 0
    let disposeSignal: (() => void) | null = null
    let cancelled = false

    const sizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr))
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
      planet?.resize(w, h)
    }

    const ro = new ResizeObserver(sizeCanvas)
    ro.observe(canvas)

    let lastPointer = { x: 0, y: 0 }
    let dragging = false
    const onPointerDown = (e: PointerEvent) => {
      dragging = true
      lastPointer = { x: e.clientX, y: e.clientY }
      canvas.setPointerCapture(e.pointerId)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return
      const dx = e.clientX - lastPointer.x
      const dy = e.clientY - lastPointer.y
      lastPointer = { x: e.clientX, y: e.clientY }
      planet?.drag(dx, dy)
    }
    const endDrag = (e: PointerEvent) => {
      dragging = false
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      planet?.zoom(e.deltaY)
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', endDrag)
    canvas.addEventListener('pointercancel', endDrag)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    ;(async () => {
      try {
        if (!('gpu' in navigator)) {
          throw new Error('navigator.gpu is undefined — WebGPU not available')
        }
        await ensureWasm()
        if (cancelled) return
        sizeCanvas()
        planet = await Planet.create(canvas)
        if (cancelled) {
          planet.free?.()
          return
        }
        planet.setParams({ ...params.value })
        disposeSignal = effect(() => {
          // Read .value inside the effect so it re-runs on changes.
          planet?.setParams({ ...params.value })
        })
        const loop = (t: number) => {
          if (!planet || cancelled) return
          try {
            planet.render(t)
          } catch (err) {
            errorMessage.value = String(err)
            return
          }
          raf = requestAnimationFrame(loop)
        }
        raf = requestAnimationFrame(loop)
      } catch (err) {
        console.error(err)
        errorMessage.value = err instanceof Error ? err.message : String(err)
      }
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      disposeSignal?.()
      ro.disconnect()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', endDrag)
      canvas.removeEventListener('pointercancel', endDrag)
      canvas.removeEventListener('wheel', onWheel)
      planet?.free?.()
    }
  }, [])

  return <canvas ref={ref} class="planet-canvas" />
}
