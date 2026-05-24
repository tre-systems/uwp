import { Canvas } from './components/Canvas'
import { ControlPanel } from './components/ControlPanel'
import { errorMessage, setViewMode, viewMode } from './appState'

export function App() {
  const error = errorMessage.value
  const mode = viewMode.value

  return (
    <div class="app">
      <Canvas />
      {error ? (
        <div class="error-overlay">
          <h2>Can't start the renderer</h2>
          <p>{error}</p>
          <p class="hint">
            UWP needs WebGPU. Try Chrome, Edge, or Safari 18+. In Firefox you'll need
            to enable <code>dom.webgpu.enabled</code> in about:config.
          </p>
        </div>
      ) : null}
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
