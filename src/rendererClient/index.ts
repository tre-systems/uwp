import { effect, untracked } from '@preact/signals'
import { Planet, generateSurfacePrebake, generateSurfacePrebakeFull } from '../../pkg/planet_render'
import {
  currentSystem,
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
  type FrameTimeDownshiftState,
  type RenderProfile,
} from '../renderProfile'
import type { SolarSystem, SystemBodyTarget } from '../domain/system'
import type { SurfaceMap } from '../domain/surfaceMap'
import { ensureWasmReady } from '../wasm'

interface SurfacePrebakeSnapshot {
  lon_cells: number
  lat_cells: number
  heightmap: Float32Array
  biome_id?: Uint8Array
  sea_level_threshold: number
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
  private surfacePrebakeCache: {
    planetIndex: number
    seed: number
    waterFraction: number
    iceLatitude: number
    meanTempK: number
    vegetationRichness: number
    bake: SurfacePrebakeSnapshot
  } | null = null

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
    // The Rust surface_map::generate path uses params.seed (the visual
    // appearance seed) - NOT the selected planet's per-body seed - when
    // it calls surface_prebake::generate. The background here has to
    // use the same seed or the rendered continents won't line up with
    // the hex grid's terrain classifications.
    const planet = this.planet
    if (!planet) return null
    const selectedPlanetIndex = planetIndex ?? selectedSurfacePlanetIndex()
    if (selectedPlanetIndex == null) return null
    const system = currentSystem.value
    const selectedPlanet = system?.planets[selectedPlanetIndex] ?? null
    if (!selectedPlanet) return null
    const seed = params.value.seed >>> 0
    const waterFraction = params.value.sea_level
    const iceLatitude = params.value.ice_latitude
    const vegetationRichness = params.value.vegetation_richness
    // Pull the selected planet's mean surface temperature from the latest
    // system snapshot so biome classification on the painted background
    // matches what the renderer's atlas produces for the globe.
    const meanTempK = effectiveSurfaceMeanTempK(
      selectedPlanet.climate?.mean_surface_temp_k ?? selectedPlanet.temperature_k ?? 288,
      params.value.atmosphere_density,
    )
    const cached = this.surfacePrebakeCache
    if (
      cached &&
      cached.planetIndex === selectedPlanetIndex &&
      cached.seed === seed &&
      Math.abs(cached.waterFraction - waterFraction) < 0.0005 &&
      Math.abs(cached.iceLatitude - iceLatitude) < 0.0005 &&
      Math.abs(cached.meanTempK - meanTempK) < 0.05 &&
      Math.abs(cached.vegetationRichness - vegetationRichness) < 0.0005
    ) {
      return cached.bake
    }
    try {
      // Prefer the climate-aware bridge; it produces biome ids that
      // match the renderer atlas + Rust surface_map exactly.
      const bake = generateSurfacePrebakeFull(
        seed,
        waterFraction,
        iceLatitude,
        meanTempK,
        vegetationRichness,
      ) as {
        lon_cells: number
        lat_cells: number
        heightmap: Float32Array | number[]
        biome_id?: Uint8Array | number[]
        sea_level?: number
      }
      const heightmap = bake.heightmap instanceof Float32Array
        ? bake.heightmap
        : Float32Array.from(bake.heightmap)
      const biome_id = bake.biome_id instanceof Uint8Array
        ? bake.biome_id
        : bake.biome_id
          ? Uint8Array.from(bake.biome_id)
          : undefined
      // The Rust pre-bake now ships its own sea_level threshold; prefer
      // that over recomputing the quantile here so the JS map and the
      // Rust surface_map agree to the bit.
      const sea_level_threshold = typeof bake.sea_level === 'number'
        ? bake.sea_level
        : quantileHeight(heightmap, waterFraction)
      const snapshot: SurfacePrebakeSnapshot = {
        lon_cells: bake.lon_cells,
        lat_cells: bake.lat_cells,
        heightmap,
        biome_id,
        sea_level_threshold,
      }
      this.surfacePrebakeCache = {
        planetIndex: selectedPlanetIndex,
        seed,
        waterFraction,
        iceLatitude,
        meanTempK,
        vegetationRichness,
        bake: snapshot,
      }
      return snapshot
    } catch (err) {
      console.warn('generateSurfacePrebakeFull failed', err)
      // Fallback to the legacy two-arg signature; surface still
      // renders, just with Earth-default biome classification.
      try {
        const bake = generateSurfacePrebake(seed, waterFraction) as {
          lon_cells: number
          lat_cells: number
          heightmap: Float32Array | number[]
          biome_id?: Uint8Array | number[]
          sea_level?: number
        }
        const heightmap = bake.heightmap instanceof Float32Array
          ? bake.heightmap
          : Float32Array.from(bake.heightmap)
        const biome_id = bake.biome_id instanceof Uint8Array
          ? bake.biome_id
          : bake.biome_id
            ? Uint8Array.from(bake.biome_id)
            : undefined
        const sea_level_threshold = typeof bake.sea_level === 'number'
          ? bake.sea_level
          : quantileHeight(heightmap, waterFraction)
        return {
          lon_cells: bake.lon_cells,
          lat_cells: bake.lat_cells,
          heightmap,
          biome_id,
          sea_level_threshold,
        }
      } catch (err2) {
        console.warn('generateSurfacePrebake fallback failed', err2)
        return null
      }
    }
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
    // Surface map depends on sea_level / ice_latitude / atmosphere, but
    // generating it also runs the Rust pre-bake. Refresh it while visible
    // and let tab entry lazily regenerate it otherwise.
    if (this.planet && viewMode.value === 'surface') {
      this.refreshSurfaceMapSnapshot()
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

function quantileHeight(heightmap: Float32Array, q: number): number {
  if (heightmap.length === 0) return 0
  const sorted = Array.from(heightmap)
  sorted.sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))
  return sorted[idx] ?? 0
}

function effectiveSurfaceMeanTempK(baseMeanTempK: number, atmosphereDensity: number): number {
  const warmthFromAtm = atmosphereDensity * 30
  return Number.isFinite(baseMeanTempK) && baseMeanTempK > 0
    ? baseMeanTempK + warmthFromAtm * 0.3
    : 270 + warmthFromAtm
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
