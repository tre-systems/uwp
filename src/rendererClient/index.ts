import { effect } from '@preact/signals'
import init, { Planet } from '../../pkg/planet_render'
import {
  params,
  registerRendererControls,
  setErrorMessage,
  setParamsSnapshot,
  setSystemSeed,
  setSystemSnapshot,
  setViewMode,
  systemSeed,
  viewMode,
  type ViewMode,
} from '../appState'
import {
  canvasPixelSize,
  createFrameTimeDownshiftState,
  detectRenderProfile,
  nextRenderProfileForFrameTime,
  type FrameTimeDownshiftState,
  type RenderProfile,
} from '../renderProfile'
import type { SolarSystem } from '../domain/system'

let wasmReady: Promise<void> | null = null

function ensureWasm() {
  if (!wasmReady) wasmReady = init().then(() => undefined)
  return wasmReady
}

declare global {
  interface Window {
    uwp?: {
      setMode(mode: ViewMode): void
      setSeed(seed: number): void
      getSystem(): SolarSystem | null
      rerollPlanet(index: number, seed?: number): void
    }
  }
}

export class RendererClient {
  private planet: Planet | null = null
  private animationFrame = 0
  private cancelled = false
  private profile: RenderProfile
  private downshiftState: FrameTimeDownshiftState
  private readonly disposers: Array<() => void> = []
  private readonly resizeObserver: ResizeObserver
  private debugHandle: Window['uwp'] | null = null
  private lastPointer = { x: 0, y: 0 }
  private dragging = false

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.profile = detectRenderProfile()
    this.downshiftState = createFrameTimeDownshiftState(this.profile)
    this.resizeObserver = new ResizeObserver(this.sizeCanvas)
  }

  async start() {
    this.installInputHandlers()
    this.resizeObserver.observe(this.canvas)
    window.addEventListener('resize', this.sizeCanvas)

    try {
      if (!('gpu' in navigator)) {
        throw new Error('navigator.gpu is undefined - WebGPU not available')
      }
      await ensureWasm()
      if (this.cancelled) return
      this.sizeCanvas()
      this.planet = await Planet.create(this.canvas, this.profile.meshQuality)
      if (this.cancelled) {
        this.planet.free?.()
        return
      }
      this.planet.resize(this.canvas.width, this.canvas.height)
      this.planet.setParams(this.renderParams())
      this.planet.setViewMode(viewMode.value)
      this.planet.setSystemSeed(systemSeed.value)
      this.refreshSystemSnapshot()
      this.installEffects()
      this.installControls()
      this.startFrameLoop()
    } catch (err) {
      console.error(err)
      setErrorMessage(err instanceof Error ? err.message : String(err))
    }
  }

  dispose() {
    this.cancelled = true
    cancelAnimationFrame(this.animationFrame)
    for (const dispose of this.disposers) dispose()
    this.resizeObserver.disconnect()
    window.removeEventListener('resize', this.sizeCanvas)
    this.removeInputHandlers()
    registerRendererControls(null)
    if (window.uwp === this.debugHandle) window.uwp = undefined
    this.planet?.free?.()
    this.planet = null
  }

  rerollPlanet(index: number, seed = Math.floor(Math.random() * 0xffffffff)) {
    this.planet?.rerollPlanet(index, seed)
    this.refreshSystemSnapshot()
  }

  getSystem(): SolarSystem | null {
    return (this.planet?.getSystem() as SolarSystem | undefined) ?? null
  }

  private renderParams() {
    return { ...params.value, render_quality: this.profile.shaderQuality }
  }

  private refreshSystemSnapshot() {
    setSystemSnapshot(this.getSystem())
  }

  private installEffects() {
    this.disposers.push(
      effect(() => {
        this.planet?.setViewMode(viewMode.value)
      }),
      effect(() => {
        if (!this.planet) return
        this.planet.setSystemSeed(systemSeed.value)
        this.refreshSystemSnapshot()
      }),
    )
  }

  private installControls() {
    registerRendererControls({
      rerollPlanet: (index, seed) => this.rerollPlanet(index, seed),
      getSystem: () => this.getSystem(),
      setParams: (nextParams) => this.setParams(nextParams),
    })
    this.debugHandle = {
      setMode: (mode) => {
        setViewMode(mode)
      },
      setSeed: (seed) => {
        setSystemSeed(seed)
      },
      getSystem: () => this.getSystem(),
      rerollPlanet: (index, seed) => this.rerollPlanet(index, seed),
    }
    window.uwp = this.debugHandle
  }

  private startFrameLoop() {
    let lastRenderMs = 0
    const loop = (time: number) => {
      if (!this.planet || this.cancelled) return
      const minFrameMs = this.profile.targetFps >= 59 ? 0 : 1000 / this.profile.targetFps
      if (minFrameMs > 0 && time - lastRenderMs < minFrameMs) {
        this.animationFrame = requestAnimationFrame(loop)
        return
      }
      const frameTimeMs = lastRenderMs > 0 ? time - lastRenderMs : 0
      lastRenderMs = time
      try {
        this.planet.render(time)
      } catch (err) {
        setErrorMessage(String(err))
        return
      }
      this.sampleFrameTime(frameTimeMs)
      this.animationFrame = requestAnimationFrame(loop)
    }
    this.animationFrame = requestAnimationFrame(loop)
  }

  private setParams(nextParams: typeof params.value) {
    setParamsSnapshot(nextParams)
    this.planet?.setParams(this.renderParams())
  }

  private sampleFrameTime(frameTimeMs: number) {
    const result = nextRenderProfileForFrameTime(this.downshiftState, frameTimeMs)
    this.downshiftState = result.state
    if (!result.changed) return

    this.profile = result.state.profile
    this.sizeCanvas()
    this.planet?.setParams(this.renderParams())
  }

  private readonly sizeCanvas = () => {
    const cssWidth = this.canvas.clientWidth || window.innerWidth
    const cssHeight = this.canvas.clientHeight || window.innerHeight
    const size = canvasPixelSize(cssWidth, cssHeight, this.profile, window.devicePixelRatio || 1)
    if (this.canvas.width !== size.width) this.canvas.width = size.width
    if (this.canvas.height !== size.height) this.canvas.height = size.height
    this.planet?.resize(size.width, size.height)
  }

  private installInputHandlers() {
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerup', this.endDrag)
    this.canvas.addEventListener('pointercancel', this.endDrag)
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false })
  }

  private removeInputHandlers() {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.endDrag)
    this.canvas.removeEventListener('pointercancel', this.endDrag)
    this.canvas.removeEventListener('wheel', this.onWheel)
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    this.dragging = true
    this.lastPointer = { x: event.clientX, y: event.clientY }
    this.canvas.setPointerCapture(event.pointerId)
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    if (!this.dragging) return
    const dx = event.clientX - this.lastPointer.x
    const dy = event.clientY - this.lastPointer.y
    this.lastPointer = { x: event.clientX, y: event.clientY }
    this.planet?.drag(dx, dy)
  }

  private readonly endDrag = (event: PointerEvent) => {
    this.dragging = false
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId)
  }

  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault()
    this.planet?.zoom(event.deltaY)
  }
}
