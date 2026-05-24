import { POP_DESC, TECH_DESC, type UwpDigits } from '../appState'
import { UwpSliderField } from './UwpSliderField'

interface SocietyEditorProps {
  uwp: UwpDigits
  disabled: boolean
  onFieldChange: <K extends keyof UwpDigits>(field: K, value: UwpDigits[K]) => void
}

export function SocietyEditor({ uwp, disabled, onFieldChange }: SocietyEditorProps) {
  return (
    <section>
      <h2>Society</h2>
      <UwpSliderField
        label="Population"
        value={uwp.pop}
        max={12}
        descriptions={POP_DESC}
        disabled={disabled}
        onChange={(v) => onFieldChange('pop', v)}
      />
      <UwpSliderField
        label="Tech level"
        value={uwp.tech}
        max={15}
        descriptions={TECH_DESC}
        disabled={disabled}
        onChange={(v) => onFieldChange('tech', v)}
      />
    </section>
  )
}
