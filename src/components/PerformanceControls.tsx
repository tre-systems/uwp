import {
  renderPerformance,
  renderQualityMode,
  setRenderQualityMode,
  type RenderQualityMode,
} from '../appState'

const QUALITY_OPTIONS: Array<{ mode: RenderQualityMode; label: string }> = [
  { mode: 'auto', label: 'Auto' },
  { mode: 'high', label: 'High' },
  { mode: 'balanced', label: 'Balanced' },
  { mode: 'low', label: 'Low' },
]

interface PerformanceControlsProps {
  disabled?: boolean
}

export function PerformanceControls({ disabled = false }: PerformanceControlsProps) {
  const mode = renderQualityMode.value
  const perf = renderPerformance.value
  const profileLabel = perf.profile[0].toUpperCase() + perf.profile.slice(1)
  const modeLabel = mode === 'auto' ? `Auto -> ${profileLabel}` : profileLabel

  return (
    <section>
      <h2>Performance</h2>
      <div class="quality-row" role="group" aria-label="Render quality">
        {QUALITY_OPTIONS.map((option) => (
          <button
            key={option.mode}
            type="button"
            class={`quality-btn ${mode === option.mode ? 'active' : ''}`}
            disabled={disabled}
            onClick={() => setRenderQualityMode(option.mode)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div class="perf-grid">
        <span>Quality</span>
        <strong>{modeLabel}</strong>
        <span>FPS</span>
        <strong>{perf.fps > 0 ? perf.fps.toFixed(0) : '--'}</strong>
        <span>Frame</span>
        <strong>{perf.frameMs > 0 ? `${perf.frameMs.toFixed(1)} ms` : '--'}</strong>
        <span>Target</span>
        <strong>{perf.targetFps} fps</strong>
        <span>Canvas</span>
        <strong>{perf.pixelWidth} x {perf.pixelHeight}</strong>
        <span>Shader</span>
        <strong>{Math.round(perf.shaderQuality * 100)}%</strong>
      </div>
    </section>
  )
}
