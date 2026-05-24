import { STARPORT_OPTIONS, type UwpDigits } from '../appState'
import { StarportIcon, starportLabel } from './Icon'

interface StarportEditorProps {
  starport: UwpDigits['starport']
  disabled: boolean
  onChange: (starport: UwpDigits['starport']) => void
}

export function StarportEditor({ starport, disabled, onChange }: StarportEditorProps) {
  return (
    <section>
      <h2>Starport</h2>
      <div class="starport-row">
        {STARPORT_OPTIONS.map((sp) => (
          <button
            class={`starport-btn ${starport === sp ? 'active' : ''}`}
            onClick={() => onChange(sp)}
            disabled={disabled}
            title={starportLabel(sp)}
            aria-label={starportLabel(sp)}
          >
            <StarportIcon code={sp} />
            <span class="starport-btn-label">{sp}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
