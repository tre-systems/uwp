interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  disabled?: boolean
  format?: (v: number) => string
  onInput: (v: number) => void
}

const defaultFormat = (v: number) =>
  Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)

export function Slider({ label, value, min, max, step = 0.001, disabled = false, format, onInput }: SliderProps) {
  const fmt = format ?? defaultFormat
  return (
    <div class="slider">
      <div class="slider-row">
        <label>{label}</label>
        <span class="slider-value">{fmt(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onInput={(e) => onInput(parseFloat((e.currentTarget as HTMLInputElement).value))}
      />
    </div>
  )
}
