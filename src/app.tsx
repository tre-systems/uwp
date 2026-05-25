import { Breadcrumb } from './components/Breadcrumb'
import { Canvas } from './components/Canvas'
import { ControlPanel } from './components/ControlPanel'
import { LoadingOverlay } from './components/LoadingOverlay'
import { ErrorOverlay } from './components/ErrorOverlay'
import { HoverTooltip } from './components/HoverTooltip'
import { OnboardingHint } from './components/OnboardingHint'
import { RegionView } from './components/RegionView'
import { SubsectorMap } from './components/SubsectorMap'
import { SurfaceMap } from './components/SurfaceMap'
import { ViewModeToggle } from './components/ViewModeToggle'
import { ViewTransition } from './components/ViewTransition'
import {
  currentSubsector,
  currentSurfaceMap,
  errorMessage,
  panelOpen,
  rendererStatus,
  viewMode,
} from './appState'

export function App() {
  const error = errorMessage.value
  const status = rendererStatus.value
  const mode = viewMode.value
  const subsector = currentSubsector.value
  const surfaceMap = currentSurfaceMap.value
  const panelClass = panelOpen.value ? ' panel-open' : ''
  // Both overlay views stay MOUNTED across tab switches so we don't pay
  // the cost of remounting hundreds of SVG hex elements every time the
  // user changes view mode. The inactive overlay is hidden via CSS
  // (display:none) so it neither paints nor catches pointer events, but
  // its Preact subtree survives - making tab swaps essentially instant.
  const subsectorHidden = mode === 'subsector' ? '' : ' overlay-hidden'
  const surfaceHidden = mode === 'surface' ? '' : ' overlay-hidden'

  return (
    <div class="app">
      {/* The Canvas + flat overlays are the primary content; wrap them
          in <main> so screen-reader landmark navigation can skip past
          the panel aside, breadcrumb nav, and view-mode tablist to
          reach the visualization in one jump. */}
      <main class="app-main" aria-label="Chart view">
        <Canvas />
        <div
          class={`subsector-overlay${panelClass}${subsectorHidden}`}
          role="region"
          aria-label="Subsector view"
          aria-hidden={mode !== 'subsector'}
        >
          <SubsectorMap subsector={subsector} />
        </div>
        <div
          class={`subsector-overlay${panelClass}${surfaceHidden}`}
          role="region"
          aria-label="Surface view"
          aria-hidden={mode !== 'surface'}
        >
          <SurfaceMap map={surfaceMap} />
        </div>
        <ViewTransition />
        {status === 'loading' && <LoadingOverlay />}
        {status === 'unsupported' && <ErrorOverlay kind="unsupported" />}
        {status === 'error' && <ErrorOverlay kind="error" detail={error} />}
        <HoverTooltip />
      </main>
      <Breadcrumb />
      <ViewModeToggle />
      <ControlPanel />
      <RegionView />
      {status === 'ready' && <OnboardingHint />}
    </div>
  )
}
