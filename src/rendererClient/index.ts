import { effect } from '@preact/signals'
import init, { Planet } from '../../pkg/planet_render'
import {
  params,
  renderQualityMode,
  registerRendererControls,
  setErrorMessage,
  setRendererStatus,
  setParamsSnapshot,
  setRenderPerformanceSnapshot,
  setSystemSeed,
  setSurfaceMap as setSurfaceMapSnapshot,
  setSystemSnapshot,
  setViewMode,
  systemSeed,
  viewMode,
  type RenderQualityMode,
  type ViewMode,
} from '../appState'
import {
  canvasPixelSize,
  createFrameTimeDownshiftState,
  detectRenderProfile,
  nextRenderProfileForFrameTime,
  renderProfileByName,
  shouldThrottleRenderProfile,
  type FrameTimeDownshiftState,
  type RenderProfile,
} from '../renderProfile'
import type { SolarSystem } from '../domain/system'
import type { SurfaceMap } from '../domain/surfaceMap'

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
  private fpsSampleStartMs = 0
  private fpsSampleFrames = 0
  private lastFps = 0
  private lastFrameMs = 0

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
        setRendererStatus('unsupported')
        setErrorMessage('navigator.gpu is undefined - WebGPU not available')
        return
      }
      setRendererStatus('loading')
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
      this.publishPerformanceSnapshot(0, 0)
      this.startFrameLoop()
      setRendererStatus('ready')
    } catch (err) {
      console.error(err)
      setRendererStatus('error')
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

  pickSystemPlanet(canvasX: number, canvasY: number, timeMs: number): number | null {
    const planet = this.planet
    if (!planet) return null
    // Convert CSS pixels to backbuffer pixels (the renderer thinks in
    // device pixels via the canvas attribute width/height).
    const dpr = window.devicePixelRatio || 1
    const idx = planet.pickSystemPlanet(canvasX * dpr, canvasY * dpr, timeMs)
    return idx < 0 ? null : idx
  }

  getSurfaceMap(): SurfaceMap | null {
    const planet = this.planet
    if (!planet) return null
    return (planet.getSurfaceMap() as SurfaceMap | null | undefined) ?? null
  }

  private renderParams() {
    return { ...params.value, render_quality: this.profile.shaderQuality }
  }

  private refreshSystemSnapshot() {
    setSystemSnapshot(this.getSystem())
    // The surface map is keyed to the main world, so refresh it whenever
    // the system snapshot changes. Cheap (one hex-grid pass) and keeps
    // the Surface view always showing the live main world.
    if (this.planet) {
      setSurfaceMapSnapshot(this.getSurfaceMap())
    }
  }

  private installEffects() {
    this.disposers.push(
      effect(() => {
        this.planet?.setViewMode(viewMode.value)
      }),
      effect(() => {
        this.applyRenderQualityMode(renderQualityMode.value)
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
      pickSystemPlanet: (x, y, t) => this.pickSystemPlanet(x, y, t),
      getSurfaceMap: () => this.getSurfaceMap(),
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
      const minFrameMs = shouldThrottleRenderProfile(this.profile) ? 1000 / this.profile.targetFps : 0
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
      this.sampleFps(time)
      this.animationFrame = requestAnimationFrame(loop)
    }
    this.animationFrame = requestAnimationFrame(loop)
  }

  private setParams(nextParams: typeof params.value) {
    setParamsSnapshot(nextParams)
    this.planet?.setParams(this.renderParams())
  }

  private sampleFrameTime(frameTimeMs: number) {
    if (renderQualityMode.value !== 'auto') return
    const result = nextRenderProfileForFrameTime(this.downshiftState, frameTimeMs)
    this.downshiftState = result.state
    if (!result.changed) return

    this.profile = result.state.profile
    this.sizeCanvas()
    this.planet?.setMeshQuality(this.profile.meshQuality)
    this.planet?.setParams(this.renderParams())
    this.publishPerformanceSnapshot()
  }

  private sampleFps(time: number) {
    if (this.fpsSampleStartMs === 0) {
      this.fpsSampleStartMs = time
      this.fpsSampleFrames = 0
      return
    }

    this.fpsSampleFrames += 1
    const elapsedMs = time - this.fpsSampleStartMs
    if (elapsedMs < 500) return

    const fps = (this.fpsSampleFrames * 1000) / elapsedMs
    this.publishPerformanceSnapshot(fps, 1000 / Math.max(fps, 1))
    this.fpsSampleStartMs = time
    this.fpsSampleFrames = 0
  }

  private applyRenderQualityMode(mode: RenderQualityMode) {
    const nextProfile = mode === 'auto' ? detectRenderProfile() : renderProfileByName(mode)
    this.profile = nextProfile
    this.downshiftState = createFrameTimeDownshiftState(nextProfile)
    this.fpsSampleStartMs = 0
    this.fpsSampleFrames = 0
    this.sizeCanvas()
    this.planet?.setMeshQuality(nextProfile.meshQuality)
    this.planet?.setParams(this.renderParams())
    this.publishPerformanceSnapshot()
  }

  private publishPerformanceSnapshot(fps = this.lastFps, frameMs = this.lastFrameMs) {
    this.lastFps = fps
    this.lastFrameMs = frameMs
    setRenderPerformanceSnapshot({
      mode: renderQualityMode.value,
      profile: this.profile.name,
      fps,
      frameMs,
      targetFps: this.profile.targetFps,
      shaderQuality: this.profile.shaderQuality,
      pixelWidth: this.canvas.width,
      pixelHeight: this.canvas.height,
    })
  }

  private readonly sizeCanvas = () => {
    const cssWidth = this.canvas.clientWidth || window.innerWidth
    const cssHeight = this.canvas.clientHeight || window.innerHeight
    const size = canvasPixelSize(cssWidth, cssHeight, this.profile, window.devicePixelRatio || 1)
    if (this.canvas.width !== size.width) this.canvas.width = size.width
    if (this.canvas.height !== size.height) this.canvas.height = size.height
    this.planet?.resize(size.width, size.height)
    this.publishPerformanceSnapshot()
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
