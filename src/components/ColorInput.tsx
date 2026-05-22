type RGB = [number, number, number]

interface ColorInputProps {
  label: string
  value: RGB
  onInput: (v: RGB) => void
}

function toHex(c: RGB): string {
  const b = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, '0')
  return '#' + b(c[0]) + b(c[1]) + b(c[2])
}

function fromHex(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255]
}

export function ColorInput({ label, value, onInput }: ColorInputProps) {
  return (
    <label class="color">
      <span>{label}</span>
      <input
        type="color"
        value={toHex(value)}
        onInput={(e) => onInput(fromHex((e.currentTarget as HTMLInputElement).value))}
      />
    </label>
  )
}
