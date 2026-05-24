import { effect } from '@preact/signals'
import {
  regionHex,
  selectedHex,
  selectedSurfaceHex,
  setSelectedHex,
  setSubsectorSeed,
  setSystemSeed,
  setViewMode,
  subsectorSeed,
  systemSeed,
  viewMode,
} from '.'
import type { ViewMode } from '.'

// Deep-link URL state.
//
// Encodes the user's current chart selection in `location.hash` so a
// shared link recreates the same view:
//
//   #sub=<subsectorSeed>&hex=<col>,<row>&sys=<systemSeed>&view=<mode>
//
// All fields are optional; missing keys fall back to defaults. We
// hydrate at boot, then mirror future signal writes back into the
// hash without polluting browser history (replaceState).

interface ParsedState {
  subsectorSeed?: number
  systemSeed?: number
  hex?: { col: number; row: number }
  view?: ViewMode
}

const VALID_VIEWS: readonly ViewMode[] = ['subsector', 'system', 'detail', 'surface']

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

function buildHash(): string {
  const params = new URLSearchParams()
  params.set('sub', subsectorSeed.value.toString(10))
  params.set('sys', systemSeed.value.toString(10))
  const h = selectedHex.value
  if (h) params.set('hex', `${h.col},${h.row}`)
  params.set('view', viewMode.value)
  return params.toString()
}

/** Apply the URL hash to live signals. Called once at boot. */
export function loadUrlState(): void {
  if (typeof window === 'undefined') return
  const parsed = parseHash(window.location.hash)
  if (parsed.subsectorSeed != null) setSubsectorSeed(parsed.subsectorSeed)
  if (parsed.systemSeed != null) setSystemSeed(parsed.systemSeed)
  if (parsed.hex) setSelectedHex(parsed.hex)
  if (parsed.view) setViewMode(parsed.view)
}

/** Subscribe to signal changes and mirror them into the URL hash. */
export function installUrlStateMirror(): void {
  if (typeof window === 'undefined') return
  // Debounce hash writes so dragging a slider doesn't spam history.
  let pending: number | null = null
  effect(() => {
    // Touch every signal we care about so the effect re-runs when any
    // of them changes.
    subsectorSeed.value
    systemSeed.value
    viewMode.value
    selectedHex.value
    // Don't mirror region modal state (regionHex / selectedSurfaceHex)
    // - they're transient view state, not part of the persistent chart
    // address.
    void regionHex.value
    void selectedSurfaceHex.value

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
