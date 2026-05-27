import { useState } from 'preact/hooks'
import { flushChartUrlHash } from '../appState/urlState'

// Copies the current page URL (including the deep-link hash) to the
// clipboard. The short success/fail toast lives in-place so the user
// doesn't have to look elsewhere for confirmation.

interface ShareButtonProps {
  disabled: boolean
}

type Status = 'idle' | 'copied' | 'error'

export function ShareButton({ disabled }: ShareButtonProps) {
  const [status, setStatus] = useState<Status>('idle')

  const onCopy = async () => {
    try {
      flushChartUrlHash()
      const url = window.location.href
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
      } else {
        // Older browsers - fall back to a transient textarea + execCommand.
        const ta = document.createElement('textarea')
        ta.value = url
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setStatus('copied')
    } catch {
      setStatus('error')
    }
    setTimeout(() => setStatus('idle'), 1800)
  }

  // Screen readers see the visual icon swap (🔗 → ✓ / !) as nothing —
  // expose the same signal through aria-live on a visually-hidden
  // sibling so keyboard / SR users get confirmation when they activate
  // the button.
  const liveMessage =
    status === 'copied' ? 'Link copied to clipboard'
    : status === 'error' ? 'Copy failed'
    : ''
  return (
    <>
      <button
        type="button"
        class={`ghost share-trigger share-status-${status}`}
        onClick={onCopy}
        disabled={disabled}
        title="Copy a shareable link to this chart"
        aria-label="Copy chart link"
      >
        {status === 'copied' ? '✓' : status === 'error' ? '!' : '🔗'}
      </button>
      <span class="visually-hidden" aria-live="polite" role="status">
        {liveMessage}
      </span>
    </>
  )
}
