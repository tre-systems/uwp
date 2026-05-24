import { ATM_DESC, HYDRO_DESC, SIZE_DESC, type UwpDigits } from '../appState'
import { UwpSliderField } from './UwpSliderField'

interface WorldProfileEditorProps {
  uwp: UwpDigits
  disabled: boolean
  onFieldChange: <K extends keyof UwpDigits>(field: K, value: UwpDigits[K]) => void
}

export function WorldProfileEditor({ uwp, disabled, onFieldChange }: WorldProfileEditorProps) {
  return (
    <section>
      <h2>World profile</h2>
      <UwpSliderField
        label="Size"
        value={uwp.size}
        max={10}
        descriptions={SIZE_DESC}
        disabled={disabled}
        onChange={(v) => onFieldChange('size', v)}
      />
      <UwpSliderField
        label="Atmosphere"
        value={uwp.atm}
        max={15}
        descriptions={ATM_DESC}
        disabled={disabled}
        onChange={(v) => onFieldChange('atm', v)}
      />
      <UwpSliderField
        label="Hydrographics"
        value={uwp.hydro}
        max={10}
        descriptions={HYDRO_DESC}
        disabled={disabled}
        onChange={(v) => onFieldChange('hydro', v)}
      />
    </section>
  )
}
