import { uwpHex } from '../appState'

interface UwpSliderFieldProps {
  label: string
  value: number
  max: number
  descriptions: readonly string[]
  disabled?: boolean
  onChange: (v: number) => void
}

export function UwpSliderField({
  label,
  value,
  max,
  descriptions,
  disabled = false,
  onChange,
}: UwpSliderFieldProps) {
  const rounded = Math.max(0, Math.min(max, Math.round(value)))
  const desc = descriptions[rounded] ?? ''
  return (
    <div class="uwp-slider">
      <div class="uwp-slider-row">
        <span class="uwp-slider-label">{label}</span>
        <span class="uwp-slider-code">{uwpHex(value)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={0.1}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={desc ? `${uwpHex(value)} — ${desc}` : uwpHex(value)}
        onInput={(e) => onChange(parseFloat((e.currentTarget as HTMLInputElement).value))}
      />
      <div class="uwp-slider-desc">{desc}</div>
    </div>
  )
}
