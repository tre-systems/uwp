import { effect } from '@preact/signals'
import { Planet, generateSurfacePrebake } from '../../pkg/planet_render'
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
  systemTimeSpeed,
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
import { ensureWasmReady } from '../wasm'

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
  private readonly activePointers = new Map<number, { x: number; y: number }>()
  private pinchDistance: number | null = null
  // Simulation clock the renderer reads from. Advances every frame
  // either at 1x (detail mode) or systemTimeSpeed (system mode), so
  // a paused system view freezes planet positions while picking and
  // hover stay aligned with the visible state. Initialised lazily on
  // the first real frame.
  private simTimeMs = 0
  private simInitialised = false
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
      await ensureWasmReady()
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

  pickSystemPlanet(canvasX: number, canvasY: number, _timeMs: number): number | null {
    const planet = this.planet
    if (!planet) return null
    // Convert CSS pixels to the actual canvas backing store. Render profiles
    // may cap DPR / total pixels, so window.devicePixelRatio is not enough.
    const rect = this.canvas.getBoundingClientRect()
    const scaleX = this.canvas.width / Math.max(rect.width, 1)
    const scaleY = this.canvas.height / Math.max(rect.height, 1)
    // Ignore the wall-clock time the caller passed - the visible
    // planet positions are anchored to the simulation clock the frame
    // loop is feeding the renderer. Using wall-clock here would
    // de-sync picking from the visible position whenever the user
    // paused or sped up the system view.
    const idx = planet.pickSystemPlanet(canvasX * scaleX, canvasY * scaleY, this.simTimeMs)
    return idx < 0 ? null : idx
  }

  getSurfaceMap(): SurfaceMap | null {
    const planet = this.planet
    if (!planet) return null
    return (planet.getSurfaceMap() as SurfaceMap | null | undefined) ?? null
  }

  pointAtSurface(latDeg: number, lonDeg: number): void {
    this.planet?.pointAtSurface(latDeg, lonDeg)
  }

  getSurfacePrebake(): { lon_cells: number; lat_cells: number; heightmap: Float32Array | number[] } | null {
    // The Rust surface_map::generate path uses params.seed (the visual
    // appearance seed) - NOT the main world's per-planet seed - when
    // it calls surface_prebake::generate. The background here has to
    // use the same seed or the rendered continents won't line up with
    // the hex grid's terrain classifications.
    const planet = this.planet
    if (!planet) return null
    try {
      const bake = generateSurfacePrebake(params.value.seed, params.value.sea_level)
      return bake as { lon_cells: number; lat_cells: number; heightmap: Float32Array | number[] }
    } catch (err) {
      console.warn('generateSurfacePrebake failed', err)
      return null
    }
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
      getSurfacePrebake: () => this.getSurfacePrebake(),
      pointAtSurface: (lat, lon) => this.pointAtSurface(lat, lon),
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
      // Skip the GPU pass entirely when an SVG overlay is covering the
      // canvas. Saves battery on long Subsector / Surface sessions
      // without affecting the user-visible scene.
      const mode = viewMode.value
      const gpuVisible = mode === 'system' || mode === 'detail'
      if (!gpuVisible) {
        lastRenderMs = time
        this.animationFrame = requestAnimationFrame(loop)
        return
      }
      const minFrameMs = shouldThrottleRenderProfile(this.profile) ? 1000 / this.profile.targetFps : 0
      if (minFrameMs > 0 && time - lastRenderMs < minFrameMs) {
        this.animationFrame = requestAnimationFrame(loop)
        return
      }
      const frameTimeMs = lastRenderMs > 0 ? time - lastRenderMs : 0
      lastRenderMs = time

      if (!this.simInitialised) {
        this.simTimeMs = time
        this.simInitialised = true
      } else {
        // Pause / speed control only applies in system mode. In detail
        // mode the simulation clock always advances at 1x so clouds
        // and waves animate normally even if the user paused the
        // system view earlier.
        const speed = mode === 'system' ? systemTimeSpeed.value : 1
        this.simTimeMs += frameTimeMs * speed
      }

      try {
        this.planet.render(this.simTimeMs)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setRendererStatus('error')
        setErrorMessage(message)
        this.cancelled = true
        this.animationFrame = 0
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
    // Surface map depends on sea_level / ice_latitude / atmosphere - both
    // for hex terrain and inspector readouts. Refresh so the Surface view
    // tracks the planet the user is editing.
    if (this.planet) {
      setSurfaceMapSnapshot(this.getSurfaceMap())
    }
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
    this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    this.lastPointer = { x: event.clientX, y: event.clientY }
    try {
      this.canvas.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic mobile tests and a few touch browsers can report pointer
      // events after capture eligibility has already passed. Interaction
      // still works because we track active pointers ourselves.
    }
    if (this.activePointers.size === 2) {
      const [a, b] = [...this.activePointers.values()]
      this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y)
      this.dragging = false
    } else {
      this.dragging = true
    }
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    if (!this.activePointers.has(event.pointerId)) return
    this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (this.activePointers.size >= 2 && this.pinchDistance != null) {
      const [a, b] = [...this.activePointers.values()]
      const nextDistance = Math.hypot(a.x - b.x, a.y - b.y)
      if (nextDistance > 0) {
        const ratio = nextDistance / Math.max(this.pinchDistance, 1)
        this.pinchDistance = nextDistance
        // `Planet.zoom` consumes wheel-like deltas: negative zooms in,
        // positive zooms out. Convert a two-finger distance ratio into
        // the same multiplicative camera-distance factor.
        const wheelDelta = ((1 / ratio) - 1) / 0.0015
        this.planet?.zoom(wheelDelta)
      }
      return
    }

    if (!this.dragging) return
    const dx = event.clientX - this.lastPointer.x
    const dy = event.clientY - this.lastPointer.y
    this.lastPointer = { x: event.clientX, y: event.clientY }
    this.planet?.drag(dx, dy)
  }

  private readonly endDrag = (event: PointerEvent) => {
    this.activePointers.delete(event.pointerId)
    if (this.activePointers.size < 2) this.pinchDistance = null
    this.dragging = this.activePointers.size === 1
    const remaining = [...this.activePointers.values()][0]
    if (remaining) this.lastPointer = remaining
    try {
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId)
    } catch {
      // See setPointerCapture guard above.
    }
  }

  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault()
    this.planet?.zoom(event.deltaY)
  }
}
