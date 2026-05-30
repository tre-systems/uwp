import { effect, untracked } from '@preact/signals'
import { Planet } from '../../pkg/planet_render'
import {
  currentSystem,
  focusMainWorldDetail,
  focusSystemTarget,
  params,
  renderQualityMode,
  registerRendererControls,
  setErrorMessage,
  setRendererStatus,
  setParamsSnapshot,
  setRenderPerformanceSnapshot,
  setSystemSeed,
  selectedSurfacePlanetIndex,
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
  upgradeForCapableGpu,
  type FrameTimeDownshiftState,
  type RenderProfile,
} from '../renderProfile'
import { probeGpu } from '../gpuProbe'
import { popChartWork, pushChartWork, yieldToPaint } from '../appState/chartWork'
import type { Params } from '../params'
import type { SolarSystem, SystemBodyTarget } from '../domain/system'
import type { SurfaceMap } from '../domain/surfaceMap'
import { ensureWasmReady } from '../wasm'
import { SurfacePrebakeCache, type SurfacePrebakeSnapshot } from './surfacePrebake'

declare global {
  interface Window {
    uwp?: {
      setMode(mode: ViewMode): void
      setSeed(seed: number): void
      getSystem(): SolarSystem | null
      rerollPlanet(index: number, seed?: number): void
      /** Freeze the detail view at a fixed sim-time (ms) for byte-stable
       *  visual-regression captures; pass null to resume live animation. */
      setFrozen(timeMs: number | null): void
      /** Focus a system body in the detail view (null = main world). Used by
       *  visual-regression tests to address a body class deterministically. */
      focusBody(target: SystemBodyTarget | null): void
      /** Read the current GPU frame back as RGBA8 pixels — lets headless visual
       *  tests capture the canvas a page screenshot can't composite. */
      readPixels(): Promise<{ width: number; height: number; data: Uint8Array }>
      /** The current body_visual_mode (0 terrain, 1.x fluid giant, 2 star,
       *  3 belt) — lets a test confirm focusBody applied the body's mode. */
      detailMode(): number
    }
  }
}

// Idle frame-rate cap. Drifting clouds and waves read fine at 30fps, so the
// full profile target is reserved for active interaction (drag / pinch / zoom)
// where cadence is what makes the view feel responsive. LOW / MINIMUM already
// sit at 30fps, so this only relaxes the idle cadence on the higher tiers.
const IDLE_FPS = 30
// Keep rendering at the interaction rate for a short tail after the last input
// so flick-drags and successive zoom steps don't dip to the idle cadence
// between events.
const INTERACTION_KEEPALIVE_MS = 600
// Clamp the per-frame delta so returning from a backgrounded tab (rAF paused
// for seconds) neither jumps the cloud/orbit clock forward nor feeds the
// frame-time downshifter a false "slow frame" spike.
const MAX_FRAME_MS = 100

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
  private lastInteractionMs = 0
  private readonly surfacePrebakeCache = new SurfacePrebakeCache()
  private terrainParamsTimer: ReturnType<typeof setTimeout> | null = null
  private surfaceMapTimer: ReturnType<typeof setTimeout> | null = null
  private lastCommittedParams: Params | null = null
  private systemLoadGeneration = 0
  private gpuCapable = false

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
      this.lastCommittedParams = { ...params.value }
      this.planet.setViewMode(viewMode.value)
      this.planet.setSystemSeed(systemSeed.value)
      this.refreshSystemSnapshot()
      this.installEffects()
      this.installControls()
      this.publishPerformanceSnapshot(0, 0)
      this.startFrameLoop()
      setRendererStatus('ready')
      // Probe the GPU off the critical path: if it's a capable desktop part,
      // upgrade an auto HIGH session to ULTRA (supersampling + extra detail).
      void this.probeAndMaybeUpgrade()
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

  pickSystemBody(canvasX: number, canvasY: number, _timeMs: number): SystemBodyTarget | null {
    const planet = this.planet
    if (!planet) return null
    const rect = this.canvas.getBoundingClientRect()
    const scaleX = this.canvas.width / Math.max(rect.width, 1)
    const scaleY = this.canvas.height / Math.max(rect.height, 1)
    const picker = (planet as Planet & {
      pickSystemBody?: (canvasX: number, canvasY: number, timeMs: number) => SystemBodyTarget | null
    }).pickSystemBody
    if (!picker) {
      const idx = this.pickSystemPlanet(canvasX, canvasY, this.simTimeMs)
      return idx == null ? null : { kind: 'planet', index: idx }
    }
    const hit = picker.call(planet, canvasX * scaleX, canvasY * scaleY, this.simTimeMs)
    return isSystemBodyTarget(hit) ? hit : null
  }

  getSurfaceMap(planetIndex?: number | null): SurfaceMap | null {
    const planet = this.planet
    if (!planet) return null
    if (planetIndex != null) {
      const getForPlanet = (planet as Planet & {
        getSurfaceMapForPlanet?: (index: number) => SurfaceMap | null | undefined
      }).getSurfaceMapForPlanet
      if (!getForPlanet) return null
      return getForPlanet.call(planet, planetIndex) ?? null
    }
    return (planet.getSurfaceMap() as SurfaceMap | null | undefined) ?? null
  }

  pointAtSurface(latDeg: number, lonDeg: number): void {
    this.planet?.pointAtSurface(latDeg, lonDeg)
  }

  getSurfacePrebake(planetIndex?: number | null): SurfacePrebakeSnapshot | null {
    const planet = this.planet
    if (!planet) return null
    const selectedPlanetIndex = planetIndex ?? selectedSurfacePlanetIndex()
    if (selectedPlanetIndex == null) return null
    const system = currentSystem.value
    const selectedPlanet = system?.planets[selectedPlanetIndex] ?? null
    if (!selectedPlanet) return null
    return this.surfacePrebakeCache.get({
      planetIndex: selectedPlanetIndex,
      selectedPlanet,
      params: params.value,
    })
  }

  private renderParams() {
    return { ...params.value, render_quality: this.profile.shaderQuality }
  }

  private refreshSystemSnapshot() {
    setSystemSnapshot(this.getSystem())
    // Surface map generation includes the surface pre-bake, so keep it
    // lazy: update it immediately only while the Surface view is visible.
    if (this.planet && viewMode.value === 'surface') {
      this.refreshSurfaceMapSnapshot()
    }
  }

  private refreshSurfaceMapSnapshot(planetIndex: number | null = selectedSurfacePlanetIndex()) {
    setSurfaceMapSnapshot(planetIndex == null ? null : this.getSurfaceMap(planetIndex))
  }

  private installEffects() {
    this.disposers.push(
      effect(() => {
        const mode = viewMode.value
        const surfacePlanetIndex = selectedSurfacePlanetIndex()
        this.planet?.setViewMode(mode)
        if (this.planet && mode === 'surface') {
          this.refreshSurfaceMapSnapshot(surfacePlanetIndex)
        }
      }),
      effect(() => {
        const mode = renderQualityMode.value
        // Quality changes resize the canvas and refresh GPU params, but
        // must not subscribe to `params` — hex selection and URL sync
        // update params while the renderer is reacting to `systemSeed`,
        // which would re-enter this effect and trip Preact's cycle guard.
        untracked(() => this.applyRenderQualityMode(mode))
      }),
      effect(() => {
        if (!this.planet) return
        const seed = systemSeed.value
        const generation = ++this.systemLoadGeneration
        void (async () => {
          pushChartWork('Loading star system…')
          await yieldToPaint()
          try {
            if (generation !== this.systemLoadGeneration) return
            this.planet?.setSystemSeed(seed)
            if (generation !== this.systemLoadGeneration) return
            this.refreshSystemSnapshot()
            this.lastCommittedParams = { ...params.value }
          } finally {
            if (generation === this.systemLoadGeneration) popChartWork()
          }
        })()
      }),
    )
  }

  private installControls() {
    registerRendererControls({
      rerollPlanet: (index, seed) => this.rerollPlanet(index, seed),
      getSystem: () => this.getSystem(),
      setParams: (nextParams) => this.setParams(nextParams),
      pickSystemPlanet: (x, y, t) => this.pickSystemPlanet(x, y, t),
      pickSystemBody: (x, y, t) => this.pickSystemBody(x, y, t),
      getSurfaceMap: (planetIndex) => this.getSurfaceMap(planetIndex),
      getSurfacePrebake: (planetIndex) => this.getSurfacePrebake(planetIndex),
      pointAtSurface: (lat, lon) => this.pointAtSurface(lat, lon),
    })
    this.debugHandle = {
      setMode: (mode) => {
        setViewMode(mode)
      },
      setSeed: (seed) => {
        setSystemSeed(seed)
      },
      // Return the currentSystem *signal*, not the renderer's live system —
      // focusBody/focusSystemTarget read the signal, so polling this lets a test
      // confirm the signal has caught up before focusing a body.
      getSystem: () => currentSystem.value,
      rerollPlanet: (index, seed) => this.rerollPlanet(index, seed),
      setFrozen: (timeMs) => {
        this.planet?.setFrozen(timeMs != null, timeMs ?? 0)
      },
      focusBody: (target) => {
        if (target) focusSystemTarget(target)
        else focusMainWorldDetail()
      },
      readPixels: () =>
        this.planet
          ? (this.planet.readPixels() as Promise<{ width: number; height: number; data: Uint8Array }>)
          : Promise.reject(new Error('renderer not ready')),
      // Read the renderer's committed mode, not the params signal — the signal
      // leads the GPU by the terrain debounce, so a test polling it could freeze
      // a frame before a focused giant actually reaches the shader.
      detailMode: () => this.planet?.bodyVisualMode() ?? 0,
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
      const interacting = time - this.lastInteractionMs < INTERACTION_KEEPALIVE_MS
      // While interacting, run at the profile target (uncapped vsync on the
      // higher tiers, the explicit 30fps cap on LOW / MINIMUM). While idle,
      // cap every tier at IDLE_FPS so a planet left drifting doesn't burn the
      // GPU at full refresh rate.
      const interactingCapFps = shouldThrottleRenderProfile(this.profile) ? this.profile.targetFps : 0
      const capFps = interacting ? interactingCapFps : Math.min(this.profile.targetFps, IDLE_FPS)
      const minFrameMs = capFps > 0 ? 1000 / capFps : 0
      if (minFrameMs > 0 && time - lastRenderMs < minFrameMs) {
        this.animationFrame = requestAnimationFrame(loop)
        return
      }
      const frameTimeMs = lastRenderMs > 0 ? Math.min(time - lastRenderMs, MAX_FRAME_MS) : 0
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
      // Only judge frames we tried to render at full speed; idle-capped frames
      // sit at ~IDLE_FPS by construction and would read as "slow" against a
      // 60fps target, tripping a spurious quality downshift.
      if (interacting) this.sampleFrameTime(frameTimeMs)
      this.sampleFps(time)
      this.animationFrame = requestAnimationFrame(loop)
    }
    this.animationFrame = requestAnimationFrame(loop)
  }

  private paramsAffectTerrain(a: Params, b: Params): boolean {
    return (
      a.seed !== b.seed
      || a.sea_level !== b.sea_level
      || a.ice_latitude !== b.ice_latitude
      || a.vegetation_richness !== b.vegetation_richness
      || (a.surface_temp_k ?? 0) !== (b.surface_temp_k ?? 0)
    )
  }

  private setParams(nextParams: Params) {
    setParamsSnapshot(nextParams)
    const planet = this.planet
    if (!planet) return

    const prev = this.lastCommittedParams ?? params.value
    const renderParams = this.renderParams()
    if (!this.paramsAffectTerrain(prev, params.value)) {
      planet.setParams(renderParams)
      this.lastCommittedParams = { ...params.value }
      return
    }

    if (this.terrainParamsTimer != null) clearTimeout(this.terrainParamsTimer)
    this.terrainParamsTimer = setTimeout(() => {
      this.terrainParamsTimer = null
      if (!this.planet) return
      pushChartWork('Updating terrain…')
      void yieldToPaint().then(() => {
        try {
          const latest = this.renderParams()
          this.planet?.setParams(latest)
          this.lastCommittedParams = { ...params.value }
        } finally {
          popChartWork()
        }
      })
    }, 140)

    if (viewMode.value === 'surface') {
      this.scheduleSurfaceMapRefresh()
    }
  }

  private scheduleSurfaceMapRefresh(): void {
    if (this.surfaceMapTimer != null) clearTimeout(this.surfaceMapTimer)
    this.surfaceMapTimer = setTimeout(() => {
      this.surfaceMapTimer = null
      this.refreshSurfaceMapSnapshot()
    }, 220)
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
    const nextProfile =
      mode === 'auto'
        ? upgradeForCapableGpu(detectRenderProfile(), this.gpuCapable)
        : renderProfileByName(mode)
    this.profile = nextProfile
    this.downshiftState = createFrameTimeDownshiftState(nextProfile)
    this.fpsSampleStartMs = 0
    this.fpsSampleFrames = 0
    this.sizeCanvas()
    this.planet?.setMeshQuality(nextProfile.meshQuality)
    this.planet?.setParams(this.renderParams())
    this.publishPerformanceSnapshot()
  }

  private async probeAndMaybeUpgrade() {
    const report = await probeGpu()
    if (this.cancelled) return
    this.gpuCapable = report.capable
    const tier = report.capable ? 'capable → ULTRA eligible' : 'standard'
    console.info(`UWP GPU: ${report.vendor ?? 'unknown'} ${report.architecture ?? ''} (${tier})`.trim())
    if (!report.capable) return
    if (untracked(() => renderQualityMode.value) !== 'auto') return
    if (this.profile.name !== 'high') return
    // Re-apply 'auto': now that the GPU is known capable it resolves to ULTRA.
    this.applyRenderQualityMode('auto')
  }

  private publishPerformanceSnapshot(
    fps = this.lastFps,
    frameMs = this.lastFrameMs,
    mode = untracked(() => renderQualityMode.value),
  ) {
    this.lastFps = fps
    this.lastFrameMs = frameMs
    setRenderPerformanceSnapshot({
      mode,
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
    this.lastInteractionMs = performance.now()
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
    this.lastInteractionMs = performance.now()
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
    // SVG map overlays sit above the canvas; guard anyway so wheel
    // never gets swallowed when the GPU view is inactive.
    const mode = viewMode.value
    if (mode !== 'system' && mode !== 'detail') return
    event.preventDefault()
    this.lastInteractionMs = performance.now()
    this.planet?.zoom(event.deltaY)
  }
}

function isSystemBodyTarget(value: unknown): value is SystemBodyTarget {
  if (!value || typeof value !== 'object') return false
  const target = value as { kind?: unknown; index?: unknown }
  return (
    (target.kind === 'planet' || target.kind === 'star' || target.kind === 'belt') &&
    typeof target.index === 'number' &&
    Number.isInteger(target.index) &&
    target.index >= 0
  )
}
