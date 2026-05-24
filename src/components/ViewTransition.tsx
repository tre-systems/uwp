import { useEffect, useRef, useState } from 'preact/hooks'
import { viewMode, type ViewMode } from '../appState'

// Brief overlay fade played when the user swaps view mode.
//
// We only flash when transitioning between two GPU-canvas views
// (`system` <-> `detail`) - those share the WebGPU canvas and would
// otherwise expose a single-frame snap as the renderer reconfigures
// camera + uniforms. Subsector and Surface views are SVG overlays
// that mount / unmount cleanly via Preact, so no veil is needed:
// adding one there was producing a 240 ms black flash where the
// snap would have been imperceptible.
//
// The first mount also skips the transition so loading the app
// doesn't briefly black out the canvas.

const TRANSITION_MS = 140

function isGpuView(m: ViewMode): boolean {
  return m === 'system' || m === 'detail'
}

export function ViewTransition() {
  const mode = viewMode.value
  const [active, setActive] = useState(false)
  const prevMode = useRef<ViewMode | null>(null)

  useEffect(() => {
    const prev = prevMode.current
    prevMode.current = mode
    // Skip on first mount and on overlay transitions.
    if (prev == null) return
    if (!isGpuView(prev) || !isGpuView(mode)) return
    if (prev === mode) return

    setActive(true)
    const timer = window.setTimeout(() => setActive(false), TRANSITION_MS)
    return () => window.clearTimeout(timer)
  }, [mode])

  return (
    <div
      class={`view-transition${active ? ' view-transition-active' : ''}`}
      aria-hidden="true"
    />
  )
}
