import { useEffect, useRef } from 'preact/hooks'
import { effect } from '@preact/signals'
import init, { Planet } from '../../pkg/planet_render'
import { canvasPixelSize, detectRenderProfile } from '../renderProfile'
import { currentSystem, errorMessage, params, systemSeed, viewMode } from '../state'

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
    const profile = detectRenderProfile()
    const renderParams = () => ({ ...params.value, render_quality: profile.shaderQuality })

    const sizeCanvas = () => {
      // Fall back to viewport size if the canvas hasn't been laid out yet.
      const cw = canvas.clientWidth || window.innerWidth
      const ch = canvas.clientHeight || window.innerHeight
      const { width: w, height: h } = canvasPixelSize(cw, ch, profile, window.devicePixelRatio || 1)
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
      planet?.resize(w, h)
    }

    const ro = new ResizeObserver(sizeCanvas)
    ro.observe(canvas)
    window.addEventListener('resize', sizeCanvas)

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
        planet = await Planet.create(canvas, profile.meshQuality)
        if (cancelled) {
          planet.free?.()
          return
        }
        // After Planet.create, force a resize to the current canvas dims so the
        // wgpu surface is in sync (handles the case where layout settled after
        // Planet.create's initial read of canvas.width).
        planet.resize(canvas.width, canvas.height)
        planet.setParams(renderParams())
        planet.setViewMode(viewMode.value)
        planet.setSystemSeed(systemSeed.value)
        currentSystem.value = planet.getSystem()
        const disposeParams = effect(() => {
          planet?.setParams(renderParams())
        })
        const disposeMode = effect(() => {
          planet?.setViewMode(viewMode.value)
        })
        const disposeSeed = effect(() => {
          if (!planet) return
          planet.setSystemSeed(systemSeed.value)
          currentSystem.value = planet.getSystem()
        })
        disposeSignal = () => {
          disposeParams()
          disposeMode()
          disposeSeed()
        }
        // Console-debug handle: lets us drive the renderer from the dev tools
        // without round-tripping through React. Set window.uwp.setSeed(n),
        // window.uwp.setMode('system'|'detail'), window.uwp.getSystem().
        ;(window as any).uwp = {
          setMode: (m: 'detail' | 'system') => { viewMode.value = m },
          setSeed: (s: number) => planet?.setSystemSeed(s),
          getSystem: () => planet?.getSystem(),
        }
        let lastRenderMs = 0
        const minFrameMs = profile.targetFps >= 59 ? 0 : 1000 / profile.targetFps
        const loop = (t: number) => {
          if (!planet || cancelled) return
          if (minFrameMs > 0 && t - lastRenderMs < minFrameMs) {
            raf = requestAnimationFrame(loop)
            return
          }
          lastRenderMs = t
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
      window.removeEventListener('resize', sizeCanvas)
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
