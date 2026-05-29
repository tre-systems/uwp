import { effect, untracked } from '@preact/signals'
import type { SystemBodyTarget } from '../domain/system'
import { isMainWorldTarget, targetExists } from '../systemVisualMapping'
import type { SurfaceHexCoord } from '../domain/surfaceMap'
import {
  decodeOverridesPayload,
  encodeOverridesPayload,
  filterOverridesForSeed,
} from './urlOverrides'
import {
  closeRegionView,
  currentSubsector,
  currentSurfaceMap,
  currentSystem,
  detailTarget,
  focusMainWorldDetail,
  focusSystemTarget,
  regionHex,
  resolvedDetailTarget,
  selectAndFocusSurfaceHex,
  selectedHex,
  selectedSurfaceCell,
  selectedSurfaceHex,
  selectedSurfacePlanetIndex,
  setDetailTarget,
  setSelectedHex,
  setSubsectorDensity,
  setSubsectorOverrides,
  setSubsectorRouteOverrides,
  setSubsectorSeed,
  setSystemSeed,
  setUrlStatePendingDetailBody,
  setViewMode,
  subsectorDensity,
  subsectorOverrides,
  subsectorRouteOverrides,
  subsectorSeed,
  syncUwpFromSelectedHex,
  systemSeed,
  viewMode,
} from '.'
import type { ViewMode } from '.'

// Deep-link URL state.
//
// Encodes the user's current chart selection in `location.hash` so a
// shared link recreates the same view:
//
//   #sub=…&density=…&hex=…&sys=…&body=…&surface=…&ov=…&view=<mode>
//
// All fields are optional; missing keys fall back to defaults. We
// hydrate at boot, then mirror future signal writes back into the
// hash without polluting browser history (replaceState).

interface ParsedState {
  subsectorSeed?: number
  subsectorDensity?: number
  systemSeed?: number
  hex?: { col: number; row: number }
  body?: SystemBodyTarget
  surfaceHex?: SurfaceHexCoord
  overrides?: ReturnType<typeof decodeOverridesPayload>
  view?: ViewMode
  keys: Set<string>
}

const VALID_VIEWS: readonly ViewMode[] = ['subsector', 'system', 'detail', 'surface']

/** Detail body from the URL hash, applied once the solar system snapshot loads. */
let pendingDetailBody: SystemBodyTarget | null = null
/** Surface hex from the URL hash, applied once the surface map is available. */
let pendingSurfaceHex: SurfaceHexCoord | null = null

function parseHash(hash: string): ParsedState {
  const keys = new Set<string>()
  const out: ParsedState = { keys }
  const stripped = hash.replace(/^#/, '')
  if (!stripped) return out
  const params = new URLSearchParams(stripped)
  for (const key of params.keys()) {
    keys.add(key)
  }
  const sub = params.get('sub')
  if (sub) {
    const n = parseSeed(sub)
    if (n != null) out.subsectorSeed = n
  }
  const density = params.get('density')
  if (density) {
    const n = parseDensity(density)
    if (n != null) out.subsectorDensity = n
  }
  const ov = params.get('ov')
  if (ov) {
    const decoded = decodeOverridesPayload(ov)
    if (decoded) out.overrides = decoded
  }
  const sys = params.get('sys')
  if (sys) {
    const n = parseSeed(sys)
    if (n != null) out.systemSeed = n
  }
  const hex = params.get('hex')
  if (hex) {
    const m = hex.match(/^(\d+),(\d+)$/)
    if (m) out.hex = { col: parseInt(m[1], 10), row: parseInt(m[2], 10) }
  }
  const body = params.get('body')
  if (body) {
    const target = decodeDetailBody(body)
    if (target) out.body = target
  }
  const surface = params.get('surface')
  if (surface) {
    const m = surface.match(/^(\d+),(\d+)$/)
    if (m) out.surfaceHex = { col: parseInt(m[1], 10), row: parseInt(m[2], 10) }
  }
  const view = params.get('view')
  if (view && (VALID_VIEWS as readonly string[]).includes(view)) {
    out.view = view as ViewMode
  }
  return out
}

function parseSeed(raw: string): number | null {
  // Accept either decimal or 0xHEX. Clamp to u32.
  const value = raw.startsWith('0x') ? parseInt(raw.slice(2), 16) : parseInt(raw, 10)
  if (!Number.isFinite(value)) return null
  return value >>> 0
}

function parseDensity(raw: string): number | null {
  const value = Number(raw)
  if (!Number.isFinite(value)) return null
  if (value > 1) return Math.max(0, Math.min(1, value / 100))
  return Math.max(0, Math.min(1, value))
}

export function encodeDetailBody(target: SystemBodyTarget | null): string | null {
  if (!target) return null
  if (target.kind === 'planet') return `p${target.index}`
  if (target.kind === 'star') return target.index === 0 ? 'star' : 'companion'
  return `belt${target.index}`
}

export function decodeDetailBody(raw: string): SystemBodyTarget | null {
  if (raw === 'star') return { kind: 'star', index: 0 }
  if (raw === 'companion') return { kind: 'star', index: 1 }
  const planet = raw.match(/^p(\d+)$/)
  if (planet) return { kind: 'planet', index: parseInt(planet[1], 10) }
  const belt = raw.match(/^belt(\d+)$/)
  if (belt) return { kind: 'belt', index: parseInt(belt[1], 10) }
  return null
}

function buildHash(): string {
  const params = new URLSearchParams()
  params.set('sub', subsectorSeed.value.toString(10))
  const density = subsectorDensity.value
  if (Math.abs(density - 0.5) > 0.001) {
    params.set('density', String(Math.round(density * 100)))
  }
  params.set('sys', systemSeed.value.toString(10))
  const ov = encodeOverridesPayload(filterOverridesForSeed(
    subsectorSeed.value,
    subsectorOverrides.value,
    subsectorRouteOverrides.value,
  ))
  if (ov) params.set('ov', ov)
  const h = selectedHex.value
  if (h) params.set('hex', `${h.col},${h.row}`)
  const sys = currentSystem.value
  const target = resolvedDetailTarget(sys, detailTarget.value)
  if (target && !isMainWorldTarget(sys, target)) {
    const encoded = encodeDetailBody(target)
    if (encoded) params.set('body', encoded)
  }
  if (viewMode.value === 'surface') {
    const surface = selectedSurfaceHex.value
    if (surface) params.set('surface', `${surface.col},${surface.row}`)
  }
  params.set('view', viewMode.value)
  return params.toString()
}

/** Write the current chart address into the URL immediately (no debounce). */
export function flushChartUrlHash(): void {
  if (typeof window === 'undefined') return
  const next = `#${buildHash()}`
  if (window.location.hash !== next) {
    window.history.replaceState(null, '', next)
  }
}

/** Apply the URL hash to live signals. Called once at boot. */
export function loadUrlState(): void {
  if (typeof window === 'undefined') return
  const parsed = parseHash(window.location.hash)
  const { keys } = parsed

  pendingDetailBody = null
  pendingSurfaceHex = null
  setUrlStatePendingDetailBody(false)
  closeRegionView()

  if (parsed.subsectorSeed != null) setSubsectorSeed(parsed.subsectorSeed)
  if (keys.has('density') && parsed.subsectorDensity != null) {
    setSubsectorDensity(parsed.subsectorDensity)
  }
  if (keys.has('ov') && parsed.overrides) {
    setSubsectorOverrides(parsed.overrides.h)
    setSubsectorRouteOverrides(parsed.overrides.r)
  } else if (keys.has('ov')) {
    setSubsectorOverrides({})
    setSubsectorRouteOverrides({})
  }
  if (parsed.systemSeed != null) setSystemSeed(parsed.systemSeed)

  if (keys.has('hex') && parsed.hex) {
    setSelectedHex(parsed.hex)
  } else if (keys.has('hex')) {
    setSelectedHex(null)
  }

  if (keys.has('body') && parsed.body) {
    pendingDetailBody = parsed.body
    setUrlStatePendingDetailBody(true)
  } else if (keys.has('body')) {
    setDetailTarget(null)
  }

  if (keys.has('surface') && parsed.surfaceHex) {
    pendingSurfaceHex = parsed.surfaceHex
  } else if (keys.has('surface')) {
    selectedSurfaceHex.value = null
    selectedSurfaceCell.value = null
  }

  if (parsed.view) setViewMode(parsed.view)
}

function applyPendingSurfaceHex(): void {
  const map = currentSurfaceMap.value
  const coord = pendingSurfaceHex
  if (!map || !coord) return
  pendingSurfaceHex = null
  const cell = map.hexes.find((h) => h.coord.col === coord.col && h.coord.row === coord.row) ?? null
  selectAndFocusSurfaceHex(coord, cell)
}

function applyPendingDetailBody(): void {
  const sys = currentSystem.value
  const body = pendingDetailBody
  if (!sys || !body) return
  pendingDetailBody = null
  setUrlStatePendingDetailBody(false)
  if (!targetExists(sys, body)) return
  if (isMainWorldTarget(sys, body)) {
    focusMainWorldDetail()
  } else {
    focusSystemTarget(body)
  }
}

/** Subscribe to signal changes and mirror them into the URL hash. */
export function installUrlStateMirror(): void {
  if (typeof window === 'undefined') return

  effect(() => {
    currentSubsector.value
    selectedHex.value
    systemSeed.value
    // Defer so hex/system selection can finish flushing renderer
    // effects before we rewrite params from the hex UWP.
    queueMicrotask(() => untracked(() => syncUwpFromSelectedHex()))
  })

  effect(() => {
    currentSystem.value
    applyPendingDetailBody()
  })

  effect(() => {
    currentSurfaceMap.value
    viewMode.value
    applyPendingSurfaceHex()
  })

  effect(() => {
    if (viewMode.value === 'surface' && selectedSurfacePlanetIndex() == null) {
      setViewMode('detail')
    }
  })

  // Debounce hash writes so dragging a slider doesn't spam history.
  let pending: number | null = null
  effect(() => {
    // Touch every signal we care about so the effect re-runs when any
    // of them changes.
    subsectorSeed.value
    subsectorDensity.value
    subsectorOverrides.value
    subsectorRouteOverrides.value
    systemSeed.value
    viewMode.value
    selectedHex.value
    detailTarget.value
    currentSystem.value
    void regionHex.value
    selectedSurfaceHex.value

    if (pending != null) window.clearTimeout(pending)
    pending = window.setTimeout(() => {
      pending = null
      flushChartUrlHash()
    }, 80)
  })

  // React to browser back/forward / manual hash edits.
  window.addEventListener('hashchange', () => {
    loadUrlState()
  })
}
