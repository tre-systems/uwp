import { useEffect, useState } from 'preact/hooks'

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

export function OnboardingHint() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (readDismissed()) return
    // Wait a beat so the hint doesn't pop in over the loading overlay.
    const showTimer = window.setTimeout(() => setVisible(true), 600)

    const dismiss = () => {
      setVisible(false)
      markDismissed()
      cleanup()
    }

    // Any meaningful interaction counts as "they get it now".
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

    // Auto-dismiss after 12 seconds so the hint doesn't linger forever
    // if the user just stares at the planet.
    const autoTimer = window.setTimeout(dismiss, 12_000)

    function cleanup() {
      window.clearTimeout(showTimer)
      window.clearTimeout(autoTimer)
      for (const ev of events) window.removeEventListener(ev, onInteract)
    }
    return cleanup
  }, [])

  if (!visible) return null

  return (
    <div class="onboarding-hint" role="note">
      <span class="onboarding-hint-row">
        <kbd>drag</kbd> orbit
      </span>
      <span class="onboarding-hint-row">
        <kbd>scroll</kbd> zoom
      </span>
      <span class="onboarding-hint-row">
        <kbd>☰</kbd> open controls
      </span>
    </div>
  )
}
