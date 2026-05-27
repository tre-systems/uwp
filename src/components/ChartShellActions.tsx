import { currentSystem, rendererStatus, viewMode } from '../appState'
import { resolvedDetailTarget } from '../navigation/bodyView'
import { ExportPanel } from './ExportPanel'
import { ShareButton } from './ShareButton'

// Share (and export on GPU views) live outside the collapsible panel so
// mobile users can copy links or save frames without opening the menu first.

export function ChartShellActions() {
  const mode = viewMode.value
  const sys = currentSystem.value
  const target = resolvedDetailTarget(sys)
  const showExport = mode === 'detail' || mode === 'system'
  const exportDisabled = rendererStatus.value !== 'ready'

  return (
    <div class="chart-shell-actions" aria-label="Chart actions">
      <ShareButton />
      {showExport && (
        <ExportPanel
          disabled={exportDisabled}
          allowCard={mode === 'detail' && !target}
          compact
        />
      )}
    </div>
  )
}
