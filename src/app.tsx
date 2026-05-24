import { Canvas } from './components/Canvas'
import { ControlPanel } from './components/ControlPanel'
import { LoadingOverlay } from './components/LoadingOverlay'
import { ErrorOverlay } from './components/ErrorOverlay'
import { errorMessage, rendererStatus, setViewMode, viewMode } from './appState'

export function App() {
  const error = errorMessage.value
  const status = rendererStatus.value
  const mode = viewMode.value

  return (
    <div class="app">
      <Canvas />
      {status === 'loading' && <LoadingOverlay />}
      {status === 'unsupported' && <ErrorOverlay kind="unsupported" />}
      {status === 'error' && <ErrorOverlay kind="error" detail={error} />}
      <button
        class="view-toggle"
        title={mode === 'detail' ? 'Switch to system overview' : 'Switch to the main world'}
        onClick={() => setViewMode(mode === 'detail' ? 'system' : 'detail')}
      >
        {mode === 'detail' ? '☉ System' : '◉ Main World'}
      </button>
      <ControlPanel />
    </div>
  )
}
