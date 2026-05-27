import { useState } from 'preact/hooks'
import { exportCanvas } from '../exporter'

// Two-click export. The user picks a preset, we async-trigger the
// download, and we show a short success/error line so they aren't
// guessing whether the click worked. Keeping it simple: no separate
// modal, just two buttons in the panel footer-ish region.

type Status = 'idle' | 'busy' | 'ok' | 'error'

interface ExportPanelProps {
  disabled: boolean
  allowCard?: boolean
  /** Toolbar variant beside the panel toggle (no section heading). */
  compact?: boolean
}

export function ExportPanel({ disabled, allowCard = true, compact = false }: ExportPanelProps) {
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string | null>(null)

  const run = (kind: 'frame' | 'card') => async () => {
    setStatus('busy')
    setMessage(null)
    const result = await exportCanvas(kind)
    if (result.ok) {
      setStatus('ok')
      setMessage(kind === 'frame' ? 'Frame saved.' : 'Planet card saved.')
      setTimeout(() => setStatus('idle'), 2200)
    } else {
      setStatus('error')
      setMessage(result.error ?? 'Export failed.')
    }
  }

  if (compact) {
    return (
      <div class="export-toolbar" aria-label="Export">
        <button
          type="button"
          class="export-toolbar-btn"
          disabled={disabled || status === 'busy'}
          onClick={run('frame')}
          title="Save PNG frame"
          aria-label="Save frame"
        >
          {status === 'busy' ? '…' : 'PNG'}
        </button>
        {allowCard && (
          <button
            type="button"
            class="export-toolbar-btn"
            disabled={disabled || status === 'busy'}
            onClick={run('card')}
            title="Save planet card"
            aria-label="Save planet card"
          >
            Card
          </button>
        )}
        <span class="visually-hidden" aria-live="polite" role="status">
          {status === 'busy' ? 'Composing PNG' : message ?? ''}
        </span>
      </div>
    )
  }

  return (
    <section>
      <h2>Export</h2>
      <div class="export-row">
        <button
          type="button"
          class="export-btn"
          disabled={disabled || status === 'busy'}
          onClick={run('frame')}
        >
          Save frame
        </button>
        {allowCard && (
          <button
            type="button"
            class="export-btn"
            disabled={disabled || status === 'busy'}
            onClick={run('card')}
          >
            Planet card
          </button>
        )}
      </div>
      <p class={`export-status export-status-${status}`} aria-live="polite">
        {status === 'busy' && 'Composing PNG…'}
        {status !== 'busy' && message}
      </p>
    </section>
  )
}
