import { useEffect, useState } from 'preact/hooks'
import { viewMode } from '../appState'

// Short cross-fade overlay played whenever `viewMode` flips. Rendering
// between detail and system uses completely different scenes - cutting
// straight is jarring. We can't easily morph the GPU scene mid-frame
// from JS, so a thin black wash hides the cut and gives the brain ~220ms
// to expect a new view. `prefers-reduced-motion` short-circuits to no
// flash at all (the cut is honest, just not animated).

const TRANSITION_MS = 220

export function ViewTransition() {
  const mode = viewMode.value
  const [active, setActive] = useState(false)

  useEffect(() => {
    // First render: no transition. After that, fire one per mode change.
    setActive(true)
    const timer = window.setTimeout(() => setActive(false), TRANSITION_MS)
    return () => window.clearTimeout(timer)
    // We want the effect to refire only on mode change, not on first mount.
    // useState above starts false so the very first mount creates one fade,
    // but the canvas is also showing the loading overlay then, so it's
    // visually inert.
  }, [mode])

  return (
    <div
      class={`view-transition${active ? ' view-transition-active' : ''}`}
      aria-hidden="true"
    />
  )
}
