import { Breadcrumb } from './components/Breadcrumb'
import { Canvas } from './components/Canvas'
import { ControlPanel } from './components/ControlPanel'
import { LoadingOverlay } from './components/LoadingOverlay'
import { ErrorOverlay } from './components/ErrorOverlay'
import { HoverTooltip } from './components/HoverTooltip'
import { OnboardingHint } from './components/OnboardingHint'
import { SubsectorMap } from './components/SubsectorMap'
import { SurfaceMap } from './components/SurfaceMap'
import { ViewModeToggle } from './components/ViewModeToggle'
import { ViewTransition } from './components/ViewTransition'
import {
  currentSubsector,
  currentSurfaceMap,
  errorMessage,
  rendererStatus,
  viewMode,
} from './appState'

export function App() {
  const error = errorMessage.value
  const status = rendererStatus.value
  const mode = viewMode.value
  const subsector = currentSubsector.value
  const surfaceMap = currentSurfaceMap.value

  return (
    <div class="app">
      <Canvas />
      {mode === 'subsector' && (
        <div class="subsector-overlay" role="region" aria-label="Subsector view">
          <SubsectorMap subsector={subsector} />
        </div>
      )}
      {mode === 'surface' && (
        <div class="subsector-overlay" role="region" aria-label="Surface view">
          <SurfaceMap map={surfaceMap} />
        </div>
      )}
      <ViewTransition />
      {status === 'loading' && <LoadingOverlay />}
      {status === 'unsupported' && <ErrorOverlay kind="unsupported" />}
      {status === 'error' && <ErrorOverlay kind="error" detail={error} />}
      <HoverTooltip />
      <Breadcrumb />
      <ViewModeToggle />
      <ControlPanel />
      {status === 'ready' && <OnboardingHint />}
    </div>
  )
}
