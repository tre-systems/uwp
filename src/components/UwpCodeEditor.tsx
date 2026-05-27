import { useEffect, useState } from 'preact/hooks'
import { parseUwpDigits } from '../appState'

interface UwpCodeEditorProps {
  codeText: string
  disabled: boolean
  onCodeChange: (code: string) => void
}

export function UwpCodeEditor({ codeText, disabled, onCodeChange }: UwpCodeEditorProps) {
  const [draftCode, setDraftCode] = useState(codeText)
  const codeValid = parseUwpDigits(draftCode) !== null

  useEffect(() => {
    setDraftCode(codeText)
  }, [codeText])

  const commit = () => {
    if (parseUwpDigits(draftCode) != null) {
      onCodeChange(draftCode)
    } else {
      setDraftCode(codeText)
    }
  }

  return (
    <section>
      <h2>UWP code</h2>
      <div class="uwp-row">
        <input
          type="text"
          class={`uwp-input ${codeValid ? '' : 'invalid'}`}
          value={draftCode}
          disabled={disabled}
          spellcheck={false}
          autocapitalize="characters"
          placeholder="A867974-D"
          onInput={(e) => setDraftCode((e.currentTarget as HTMLInputElement).value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
              ;(e.currentTarget as HTMLInputElement).blur()
            } else if (e.key === 'Escape') {
              e.stopPropagation()
              setDraftCode(codeText)
              ;(e.currentTarget as HTMLInputElement).blur()
            }
          }}
        />
      </div>
      <div class="uwp-legend">
        Starport · Size · Atmosphere · Hydrographics · Pop · Gov · Law — Tech
      </div>
    </section>
  )
}
