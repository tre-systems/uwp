import { useEffect } from 'preact/hooks'
import {
  currentSurfaceMap,
  currentSystem,
  setViewMode,
  viewMode,
  type ViewMode,
} from '../appState'

// Four-state segmented control. Detail and Surface stay disabled until a
// system loads (and Surface additionally requires a main world) so the
// user can't drop into a blank view.

interface ModeOption {
  mode: ViewMode
  label: string
  hint: string
}

const OPTIONS: readonly ModeOption[] = [
  { mode: 'subsector', label: 'Subsector', hint: 'Browse the subsector hex grid' },
  { mode: 'system', label: 'System', hint: 'Overview of the current solar system' },
  { mode: 'detail', label: 'Main World', hint: 'Render the selected main world' },
  { mode: 'surface', label: 'Surface', hint: 'Cepheus hex world map for the main world' },
]

export function ViewModeToggle() {
  const mode = viewMode.value
  const sys = currentSystem.value
  const surface = currentSurfaceMap.value

  useEffect(() => {
    // 1 / 2 / 3 / 4 keys jump straight to a view. We intentionally
    // ignore the press when the user is typing into an input or has a
    // modal open (the focused element will not be `body` then), so
    // tag-jumping shortcuts never steal a numeric keystroke.
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (
          tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable ||
          target.closest('.glossary-modal, .region-modal')
        ) return
      }
      const idx =
        e.key === '1' ? 0 :
        e.key === '2' ? 1 :
        e.key === '3' ? 2 :
        e.key === '4' ? 3 : -1
      if (idx < 0) return
      const opt = OPTIONS[idx]
      const hasMainWorld = sys != null && sys.main_world >= 0
      const disabled =
        (opt.mode === 'detail' && !sys) ||
        (opt.mode === 'surface' && !hasMainWorld && !surface)
      if (disabled) return
      e.preventDefault()
      setViewMode(opt.mode)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sys, surface])

  return (
    <div class="view-mode-toggle" role="tablist" aria-label="View mode">
      {OPTIONS.map((opt) => {
        const hasMainWorld = sys != null && sys.main_world >= 0
        const disabled = (opt.mode === 'detail' && !sys) || (opt.mode === 'surface' && !hasMainWorld)
        const isActive = mode === opt.mode
        return (
          <button
            key={opt.mode}
            class={`view-mode-segment${isActive ? ' active' : ''}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={opt.hint}
            title={opt.hint}
            disabled={disabled}
            onClick={() => setViewMode(opt.mode)}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
