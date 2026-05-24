import { Canvas } from './components/Canvas'
import { ControlPanel } from './components/ControlPanel'
import { LoadingOverlay } from './components/LoadingOverlay'
import { ErrorOverlay } from './components/ErrorOverlay'
import { OnboardingHint } from './components/OnboardingHint'
import { ViewTransition } from './components/ViewTransition'
import { errorMessage, rendererStatus, setViewMode, viewMode } from './appState'

export function App() {
  const error = errorMessage.value
  const status = rendererStatus.value
  const mode = viewMode.value

  return (
    <div class="app">
      <Canvas />
      <ViewTransition />
      {status === 'loading' && <LoadingOverlay />}
      {status === 'unsupported' && <ErrorOverlay kind="unsupported" />}
      {status === 'error' && <ErrorOverlay kind="error" detail={error} />}
      <button
        class="view-toggle"
        title={mode === 'detail' ? 'Switch to system overview' : 'Switch to the main world'}
        aria-label={mode === 'detail' ? 'Switch to system overview' : 'Switch to the main world'}
        aria-pressed={mode === 'system'}
        onClick={() => setViewMode(mode === 'detail' ? 'system' : 'detail')}
      >
        {mode === 'detail' ? '☉ System' : '◉ Main World'}
      </button>
      <ControlPanel />
      {status === 'ready' && <OnboardingHint />}
    </div>
  )
}
