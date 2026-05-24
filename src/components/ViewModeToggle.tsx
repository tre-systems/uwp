import {
  currentSystem,
  setViewMode,
  viewMode,
  type ViewMode,
} from '../appState'

// Three-state segmented control. Detail is disabled until a system loads
// so the user can't drop into a blank planet view. Future work can extend
// this to four-way once Surface Map ships.

interface ModeOption {
  mode: ViewMode
  label: string
  hint: string
}

const OPTIONS: readonly ModeOption[] = [
  { mode: 'subsector', label: 'Subsector', hint: 'Browse the subsector hex grid' },
  { mode: 'system', label: 'System', hint: 'Overview of the current solar system' },
  { mode: 'detail', label: 'Main World', hint: 'Render the selected main world' },
]

export function ViewModeToggle() {
  const mode = viewMode.value
  const sys = currentSystem.value
  return (
    <div class="view-mode-toggle" role="tablist" aria-label="View mode">
      {OPTIONS.map((opt) => {
        const disabled = opt.mode === 'detail' && !sys
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
