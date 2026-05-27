import { useEffect } from 'preact/hooks'
import {
  currentSubsector,
  currentSystem,
  regionHex,
  selectedHex,
  selectedSurfacePlanetIndex,
  setViewMode,
  subsectorSeed,
  viewMode,
} from '../appState'
import { hexLabel } from '../domain/subsector'
import { hexName, systemName } from '../domain/names'
import { formatBodyViewLabel, formatSurfaceCrumbLabel, resolvedDetailTarget } from '../navigation/bodyView'

// Persistent top-of-canvas indicator showing where the user is in the
// Subsector / System / Main World hierarchy. Each crumb is clickable
// and pops back up one level. Escape mirrors the visual affordance.

export function Breadcrumb() {
  const mode = viewMode.value
  const sub = currentSubsector.value
  const sel = selectedHex.value
  const seed = subsectorSeed.value
  const sys = currentSystem.value
  const target = resolvedDetailTarget(sys)
  const canShowSurface = selectedSurfacePlanetIndex(sys, target) != null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (regionHex.value) return
      const pop = (): void => {
        if (mode === 'surface') setViewMode('detail')
        else if (mode === 'detail') setViewMode('system')
        else if (mode === 'system') setViewMode('subsector')
        requestAnimationFrame(() => {
          const active = document.querySelector(
            '.view-mode-toggle .view-mode-segment.active',
          ) as HTMLButtonElement | null
          active?.focus({ preventScroll: true })
        })
      }
      pop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode])

  // Treat the subsector seed like any other system seed for naming so the
  // top crumb reads as a place ("Thrame Sector") rather than a hex code.
  const subsectorLabel = sub ? `${systemName(seed)} Sector` : 'Subsector'
  const hexLabelText = sel ? hexLabel(sel) : null
  const hexNameText = sel ? hexName(seed, sel.col, sel.row) : null
  const systemLabel = sys ? systemName(sys.seed) : 'System'
  const bodyLabel = formatBodyViewLabel(sys, target)
  const surfaceLabel = formatSurfaceCrumbLabel(sys, target)

  // Build the trail. Crumbs after the current mode are dimmed, but
  // only navigable when the underlying data exists.
  const crumbs: Crumb[] = [
    {
      label: subsectorLabel,
      active: mode === 'subsector',
      onClick: () => setViewMode('subsector'),
    },
  ]
  if (hexLabelText && hexNameText && mode !== 'subsector') {
    crumbs.push({
      label: `${hexNameText} · ${hexLabelText}`,
      active: false,
      onClick: () => setViewMode(mode === 'detail' || mode === 'surface' ? 'system' : 'subsector'),
      muted: true,
    })
  }
  if (sys && mode !== 'subsector') {
    crumbs.push({
      label: systemLabel,
      active: mode === 'system',
      onClick: () => setViewMode('system'),
    })
    if (mode === 'detail' || mode === 'surface') {
      crumbs.push({
        label: bodyLabel,
        active: mode === 'detail',
        onClick: () => setViewMode('detail'),
      })
    }
    if (mode === 'surface' && canShowSurface) {
      crumbs.push({
        label: surfaceLabel,
        active: true,
        onClick: () => setViewMode('surface'),
      })
    }
  }

  return (
    <nav class="breadcrumb" aria-label="Breadcrumb">
      {/* WCAG breadcrumb pattern: an ordered list inside a nav. Screen
          readers announce the item count and let users navigate the
          list with the list rotor / quick-key. */}
      <ol class="breadcrumb-list">
        {crumbs.map((c, i) => (
          <li key={c.label} class="breadcrumb-item">
            {i > 0 && <span class="breadcrumb-sep" aria-hidden="true">›</span>}
            <button
              type="button"
              class={`breadcrumb-crumb${c.active ? ' active' : ''}${c.muted ? ' muted' : ''}`}
              onClick={c.onClick}
              aria-current={c.active ? 'page' : undefined}
            >
              {c.label}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}

interface Crumb {
  label: string
  active: boolean
  onClick: () => void
  muted?: boolean
}
