import { useEffect, useState } from 'preact/hooks'
import { viewMode } from '../appState'

// Tiny first-run nudge. Shown once per browser, dismissed automatically
// the first time the user interacts with the canvas (drag/scroll/touch)
// or the controls toggle. Once dismissed we set a localStorage flag so
// the hint never returns - small-touch, large-impact.

const DISMISSED_KEY = 'uwp.onboarding.dismissed.v1'

function readDismissed(): boolean {
  if (typeof localStorage === 'undefined') return true
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return true
  }
}

function markDismissed(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    // best-effort
  }
}

function detectCoarsePointer(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(pointer: coarse)').matches
}

export function OnboardingHint() {
  const mode = viewMode.value
  const [visible, setVisible] = useState(false)
  const [coarse, setCoarse] = useState(false)

  useEffect(() => {
    setCoarse(detectCoarsePointer())
    if (readDismissed()) return
    const showTimer = window.setTimeout(() => setVisible(true), 600)

    const dismiss = () => {
      setVisible(false)
      markDismissed()
      cleanup()
    }

    const events: Array<keyof WindowEventMap> = [
      'pointerdown',
      'wheel',
      'keydown',
      'touchstart',
    ]
    const onInteract = () => dismiss()
    for (const ev of events) {
      window.addEventListener(ev, onInteract, { once: true, passive: true })
    }

    const autoTimer = window.setTimeout(dismiss, 12_000)

    function cleanup() {
      window.clearTimeout(showTimer)
      window.clearTimeout(autoTimer)
      for (const ev of events) window.removeEventListener(ev, onInteract)
    }
    return cleanup
  }, [])

  if (!visible) return null

  const mapMode = mode === 'subsector' || mode === 'surface'
  const zoomVerb = coarse ? 'pinch' : 'scroll'

  return (
    <div class="onboarding-hint" role="note">
      <span class="onboarding-hint-row">
        <kbd>drag</kbd> {mapMode ? 'pan map' : 'orbit'}
      </span>
      <span class="onboarding-hint-row">
        <kbd>{zoomVerb}</kbd> zoom
      </span>
      <span class="onboarding-hint-row">
        <kbd>menu</kbd> open controls
      </span>
    </div>
  )
}
