import { Breadcrumb } from './components/Breadcrumb'
import { Canvas } from './components/Canvas'
import { ControlPanel } from './components/ControlPanel'
import { LoadingOverlay } from './components/LoadingOverlay'
import { ErrorOverlay } from './components/ErrorOverlay'
import { OnboardingHint } from './components/OnboardingHint'
import { SubsectorMap } from './components/SubsectorMap'
import { ViewModeToggle } from './components/ViewModeToggle'
import { ViewTransition } from './components/ViewTransition'
import {
  currentSubsector,
  errorMessage,
  rendererStatus,
  viewMode,
} from './appState'

export function App() {
  const error = errorMessage.value
  const status = rendererStatus.value
  const mode = viewMode.value
  const subsector = currentSubsector.value

  return (
    <div class="app">
      <Canvas />
      {mode === 'subsector' && (
        <div class="subsector-overlay" role="region" aria-label="Subsector view">
          <SubsectorMap subsector={subsector} />
        </div>
      )}
      <ViewTransition />
      {status === 'loading' && <LoadingOverlay />}
      {status === 'unsupported' && <ErrorOverlay kind="unsupported" />}
      {status === 'error' && <ErrorOverlay kind="error" detail={error} />}
      <Breadcrumb />
      <ViewModeToggle />
      <ControlPanel />
      {status === 'ready' && <OnboardingHint />}
    </div>
  )
}
