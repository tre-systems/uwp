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
          onInput={(e) => {
            const v = (e.currentTarget as HTMLInputElement).value
            setDraftCode(v)
            onCodeChange(v)
          }}
          onBlur={() => setDraftCode(codeText)}
        />
      </div>
      <div class="uwp-legend">
        Starport · Size · Atmosphere · Hydrographics · Pop · Gov · Law — Tech
      </div>
    </section>
  )
}
