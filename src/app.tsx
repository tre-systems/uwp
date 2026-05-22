import { Canvas } from './components/Canvas'
import { ControlPanel } from './components/ControlPanel'
import { errorMessage } from './state'

export function App() {
  const error = errorMessage.value

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
      <ControlPanel />
    </div>
  )
}
