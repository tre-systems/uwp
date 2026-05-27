import { effect } from '@preact/signals'
import {
  panelOpen,
  renderQualityMode,
  resolveViewMode,
  setPanelOpen,
  setRenderQualityMode,
  setViewMode,
  viewMode,
  type RenderQualityMode,
  type ViewMode,
} from '.'

// Single localStorage key so we can version the persisted shape and drop
// stale shapes on read rather than juggling per-field keys.
const STORAGE_KEY = 'uwp.prefs.v1'

interface Persisted {
  viewMode?: ViewMode
  panelOpen?: boolean
  renderQuality?: RenderQualityMode
}

const VIEW_MODES: readonly ViewMode[] = ['subsector', 'system', 'detail', 'surface']
const QUALITY_MODES: readonly RenderQualityMode[] = ['auto', 'low', 'balanced', 'high']

function safeRead(): Persisted | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as Persisted
  } catch {
    // SecurityError in sandboxed iframes, QuotaExceededError, parse errors, …
    return null
  }
}

function safeWrite(state: Persisted): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore — persistence is best-effort.
  }
}

// Apply persisted preferences to the live signals. Run once at startup,
// before the renderer reads `viewMode` / `renderQualityMode`, so the
// first frame already reflects the user's choices.
export function loadPersistedPreferences(): void {
  const persisted = safeRead()
  if (!persisted) return
  if (persisted.viewMode && VIEW_MODES.includes(persisted.viewMode)) {
    setViewMode(resolveViewMode(persisted.viewMode))
  }
  if (persisted.renderQuality && QUALITY_MODES.includes(persisted.renderQuality)) {
    setRenderQualityMode(persisted.renderQuality)
  }
  if (typeof persisted.panelOpen === 'boolean') {
    setPanelOpen(persisted.panelOpen)
  }
}

// Subscribe to the persisted signals. Writes are debounced into a single
// JSON blob; one `effect` per signal would clobber sibling fields because
// we serialise the whole object each time.
export function installPreferencePersistence(): void {
  effect(() => {
    safeWrite({
      viewMode: viewMode.value,
      panelOpen: panelOpen.value,
      renderQuality: renderQualityMode.value,
    })
  })
}
