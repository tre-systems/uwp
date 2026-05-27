import { useEffect, useState } from 'preact/hooks'

// Tiny numeric input for an unsigned 32-bit seed. Commits on Enter or
// blur; while the user types we keep the draft in local state so the
// signal isn't yanked every keystroke. Pasting hex (0xCAFE) works too.

interface SeedFieldProps {
  value: number
  disabled?: boolean
  onChange: (next: number) => void
  ['aria-label']?: string
}

export function SeedField({ value, disabled, onChange, 'aria-label': ariaLabel }: SeedFieldProps) {
  const [draft, setDraft] = useState(value.toString(10))
  // External signal updates rehydrate the draft when the user isn't editing.
  useEffect(() => {
    setDraft(value.toString(10))
  }, [value])

  const commit = () => {
    const trimmed = draft.trim()
    if (!trimmed) {
      setDraft(value.toString(10))
      return
    }
    const parsed = trimmed.startsWith('0x') || trimmed.startsWith('0X')
      ? parseInt(trimmed.slice(2), 16)
      : parseInt(trimmed, 10)
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraft(value.toString(10))
      return
    }
    onChange(parsed >>> 0)
  }

  return (
    <label class="seed-field">
      <span class="seed-field-label">seed</span>
      <input
        type="text"
        inputMode="numeric"
        spellcheck={false}
        autoComplete="off"
        value={draft}
        disabled={disabled}
        aria-label={ariaLabel}
        onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            setDraft(value.toString(10))
            ;(e.currentTarget as HTMLInputElement).blur()
          }
        }}
      />
    </label>
  )
}
