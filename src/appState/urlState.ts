import { effect } from '@preact/signals'
import type { SystemBodyTarget } from '../domain/system'
import { resolvedDetailTarget } from '../navigation/bodyView'
import { isMainWorldTarget, targetExists } from '../systemVisualMapping'
import type { SurfaceHexCoord } from '../domain/surfaceMap'
import {
  currentSubsector,
  currentSurfaceMap,
  currentSystem,
  detailTarget,
  focusMainWorldDetail,
  focusSystemTarget,
  regionHex,
  selectAndFocusSurfaceHex,
  selectedHex,
  selectedSurfaceHex,
  selectedSurfacePlanetIndex,
  setSelectedHex,
  setSubsectorSeed,
  setSystemSeed,
  setViewMode,
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
//   #sub=…&hex=…&sys=…&body=…&surface=…&view=<mode>
//
// All fields are optional; missing keys fall back to defaults. We
// hydrate at boot, then mirror future signal writes back into the
// hash without polluting browser history (replaceState).

interface ParsedState {
  subsectorSeed?: number
  systemSeed?: number
  hex?: { col: number; row: number }
  body?: SystemBodyTarget
  surfaceHex?: SurfaceHexCoord
  view?: ViewMode
}

const VALID_VIEWS: readonly ViewMode[] = ['subsector', 'system', 'detail', 'surface']

/** Detail body from the URL hash, applied once the solar system snapshot loads. */
let pendingDetailBody: SystemBodyTarget | null = null
/** Surface hex from the URL hash, applied once the surface map is available. */
let pendingSurfaceHex: SurfaceHexCoord | null = null

function parseHash(hash: string): ParsedState {
  const out: ParsedState = {}
  const stripped = hash.replace(/^#/, '')
  if (!stripped) return out
  const params = new URLSearchParams(stripped)
  const sub = params.get('sub')
  if (sub) {
    const n = parseSeed(sub)
    if (n != null) out.subsectorSeed = n
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
  params.set('sys', systemSeed.value.toString(10))
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

/** Apply the URL hash to live signals. Called once at boot. */
export function loadUrlState(): void {
  if (typeof window === 'undefined') return
  const parsed = parseHash(window.location.hash)
  pendingDetailBody = null
  pendingSurfaceHex = null
  if (parsed.subsectorSeed != null) setSubsectorSeed(parsed.subsectorSeed)
  if (parsed.systemSeed != null) setSystemSeed(parsed.systemSeed)
  if (parsed.hex) setSelectedHex(parsed.hex)
  if (parsed.body) pendingDetailBody = parsed.body
  if (parsed.surfaceHex) pendingSurfaceHex = parsed.surfaceHex
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
    syncUwpFromSelectedHex()
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
      const next = `#${buildHash()}`
      if (window.location.hash !== next) {
        window.history.replaceState(null, '', next)
      }
    }, 80)
  })

  // React to browser back/forward / manual hash edits.
  window.addEventListener('hashchange', () => {
    loadUrlState()
  })
}
