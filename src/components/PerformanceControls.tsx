import {
  renderPerformance,
  renderQualityMode,
  setRenderQualityMode,
  type RenderQualityMode,
} from '../appState'

const QUALITY_OPTIONS: Array<{ mode: RenderQualityMode; label: string; hint: string }> = [
  { mode: 'auto', label: 'Auto', hint: 'Adapt to the device' },
  { mode: 'high', label: 'High', hint: 'Maximum visual quality' },
  { mode: 'balanced', label: 'Balanced', hint: 'Smooth on most hardware' },
  { mode: 'low', label: 'Low', hint: 'Best chance to stay above 30 fps' },
]

interface PerformanceControlsProps {
  disabled?: boolean
}

// FPS thresholds for the indicator pill - chosen so 60 fps reads green
// on a 60 Hz panel, 45+ amber for "fine but degraded", and anything
// below 30 sits in the red.
const FPS_GOOD = 50
const FPS_FAIR = 30

function fpsTone(fps: number): 'good' | 'fair' | 'poor' | 'idle' {
  if (fps <= 0) return 'idle'
  if (fps >= FPS_GOOD) return 'good'
  if (fps >= FPS_FAIR) return 'fair'
  return 'poor'
}

export function PerformanceControls({ disabled = false }: PerformanceControlsProps) {
  const mode = renderQualityMode.value
  const perf = renderPerformance.value
  const profileLabel = perf.profile[0].toUpperCase() + perf.profile.slice(1)
  const isAuto = mode === 'auto'
  const tone = fpsTone(perf.fps)
  const fpsDisplay = perf.fps > 0 ? perf.fps.toFixed(0) : '—'
  const cadence = perf.frameMs > 0 ? `${perf.frameMs.toFixed(1)} ms` : '—'

  return (
    <section>
      <h2>Performance</h2>

      <div class={`perf-fps perf-fps-${tone}`} aria-live="polite">
        <div class="perf-fps-number">
          <span class="perf-fps-value">{fpsDisplay}</span>
          <span class="perf-fps-unit">fps</span>
        </div>
        <div class="perf-fps-meta">
          <span>{cadence}</span>
          <span>target {perf.targetFps}</span>
        </div>
      </div>

      <div class="perf-profile">
        <span class="perf-profile-label">Profile</span>
        <span class="perf-profile-value">
          {profileLabel}
          {isAuto && <span class="perf-profile-auto"> · auto</span>}
        </span>
      </div>

      <div
        class="quality-segments"
        role="radiogroup"
        aria-label="Render quality"
      >
        {QUALITY_OPTIONS.map((option) => {
          const active = mode === option.mode
          return (
            <button
              key={option.mode}
              type="button"
              role="radio"
              aria-checked={active}
              class={`quality-segment${active ? ' active' : ''}`}
              disabled={disabled}
              title={option.hint}
              onClick={() => setRenderQualityMode(option.mode)}
            >
              {option.label}
            </button>
          )
        })}
      </div>

      <div class="perf-grid">
        <span>Canvas</span>
        <strong>{perf.pixelWidth} × {perf.pixelHeight}</strong>
        <span>Shader</span>
        <strong>{Math.round(perf.shaderQuality * 100)}%</strong>
      </div>
    </section>
  )
}
