import { useEffect } from 'preact/hooks'
import {
  currentSubsector,
  currentSystem,
  selectedHex,
  setViewMode,
  subsectorSeed,
  viewMode,
} from '../appState'
import { hexLabel } from '../domain/subsector'
import { hexName, systemName } from '../domain/names'

// Persistent top-of-canvas indicator showing where the user is in the
// Subsector / System / Main World hierarchy. Each crumb is clickable
// and pops back up one level. Escape mirrors the visual affordance.

export function Breadcrumb() {
  const mode = viewMode.value
  const sub = currentSubsector.value
  const sel = selectedHex.value
  const seed = subsectorSeed.value
  const sys = currentSystem.value

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Only pop if no modal is open. Modals already consume Escape
      // before bubbling up, so reaching this handler means the user
      // means to pop a view level.
      if (mode === 'detail') setViewMode('system')
      else if (mode === 'system') setViewMode('subsector')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode])

  const subsectorLabel = sub ? `Subsector ${seed.toString(16).toUpperCase().padStart(4, '0').slice(-6)}` : 'Subsector'
  const hexLabelText = sel ? hexLabel(sel) : null
  const hexNameText = sel ? hexName(seed, sel.col, sel.row) : null
  const systemLabel = sys ? systemName(sys.seed) : 'System'
  const mainLabel = 'Main World'

  // Build the trail. Crumbs after the current mode are dimmed, but
  // only navigable when the underlying data exists.
  const crumbs: Crumb[] = [
    {
      label: subsectorLabel,
      active: mode === 'subsector',
      onClick: () => setViewMode('subsector'),
    },
  ]
  if (hexLabelText && hexNameText) {
    crumbs.push({
      label: `${hexNameText} · ${hexLabelText}`,
      active: false,
      onClick: () => setViewMode('subsector'),
      muted: true,
    })
  }
  if (sys) {
    crumbs.push({
      label: systemLabel,
      active: mode === 'system',
      onClick: () => setViewMode('system'),
    })
    if (sys.main_world >= 0) {
      crumbs.push({
        label: mainLabel,
        active: mode === 'detail',
        onClick: () => setViewMode('detail'),
      })
    }
  }

  return (
    <nav class="breadcrumb" aria-label="Navigation depth">
      {crumbs.map((c, i) => (
        <span key={c.label} class="breadcrumb-item">
          {i > 0 && <span class="breadcrumb-sep" aria-hidden="true">›</span>}
          <button
            type="button"
            class={`breadcrumb-crumb${c.active ? ' active' : ''}${c.muted ? ' muted' : ''}`}
            onClick={c.onClick}
            aria-current={c.active ? 'page' : undefined}
          >
            {c.label}
          </button>
        </span>
      ))}
    </nav>
  )
}

interface Crumb {
  label: string
  active: boolean
  onClick: () => void
  muted?: boolean
}
