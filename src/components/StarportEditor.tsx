import { STARPORT_OPTIONS, type UwpDigits } from '../appState'

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
            title={sp === 'X' ? 'No starport' : `Class ${sp}`}
          >
            {sp}
          </button>
        ))}
      </div>
    </section>
  )
}
