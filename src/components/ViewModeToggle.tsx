import {
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
