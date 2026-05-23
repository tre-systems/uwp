import {
  ATM_DESC,
  HYDRO_DESC,
  panelOpen,
  params,
  parseUwpDigits,
  POP_DESC,
  randomizeUwp,
  resetUwp,
  setUwpField,
  setUwpFromCode,
  SIZE_DESC,
  STARPORT_OPTIONS,
  TECH_DESC,
  updateParams,
  uwp,
  uwpHex,
  uwpToCode,
} from '../state'
import { useEffect, useState } from 'preact/hooks'
import { Slider } from './Slider'

interface UwpSliderProps {
  label: string
  value: number
  max: number
  descriptions: readonly string[]
  disabled?: boolean
  onChange: (v: number) => void
}

function UwpSlider({ label, value, max, descriptions, disabled = false, onChange }: UwpSliderProps) {
  const desc = descriptions[value] ?? ''
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
        step={1}
        value={value}
        disabled={disabled}
        onInput={(e) => onChange(parseInt((e.currentTarget as HTMLInputElement).value, 10))}
      />
      <div class="uwp-slider-desc">{desc}</div>
    </div>
  )
}

export function ControlPanel() {
  // Accessing .value inside JSX subscribes the component to changes.
  const u = uwp.value
  const p = params.value
  const open = panelOpen.value
  const toggle = () => (panelOpen.value = !panelOpen.value)
  const codeText = uwpToCode(u)
  const panelId = 'controls-panel'
  const controlsDisabled = !open
  const [draftCode, setDraftCode] = useState(codeText)
  const codeValid = parseUwpDigits(draftCode) !== null

  useEffect(() => {
    setDraftCode(codeText)
  }, [codeText])

  return (
    <>
      <button
        class={`panel-toggle ${open ? 'panel-toggle-open' : ''}`}
        onClick={toggle}
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={open ? 'Hide controls' : 'Show controls'}
        title={open ? 'Hide controls' : 'Show controls'}
      >
        {open ? '✕' : '☰'}
      </button>

      <aside id={panelId} class={`panel ${open ? '' : 'panel-closed'}`} aria-hidden={!open} inert={!open}>
        <header class="panel-header">
          <h1>UWP</h1>
          <div class="panel-actions">
            <button onClick={randomizeUwp} disabled={controlsDisabled}>Randomize</button>
            <button class="ghost" onClick={resetUwp} disabled={controlsDisabled}>Reset</button>
          </div>
        </header>

        <section>
          <h2>UWP code</h2>
          <div class="uwp-row">
            <input
              type="text"
              class={`uwp-input ${codeValid ? '' : 'invalid'}`}
              value={draftCode}
              disabled={controlsDisabled}
              spellcheck={false}
              autocapitalize="characters"
              placeholder="A867974-D"
              onInput={(e) => {
                const v = (e.currentTarget as HTMLInputElement).value
                setDraftCode(v)
                setUwpFromCode(v)
              }}
              onBlur={() => setDraftCode(codeText)}
            />
          </div>
          <div class="uwp-legend">
            Starport · Size · Atmosphere · Hydrographics · Pop · Gov · Law — Tech
          </div>
        </section>

        <section>
          <h2>Starport</h2>
          <div class="starport-row">
            {STARPORT_OPTIONS.map((sp) => (
              <button
                class={`starport-btn ${u.starport === sp ? 'active' : ''}`}
                onClick={() => setUwpField('starport', sp)}
                disabled={controlsDisabled}
                title={sp === 'X' ? 'No starport' : `Class ${sp}`}
              >
                {sp}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>World profile</h2>
          <UwpSlider
            label="Size"
            value={u.size}
            max={10}
            descriptions={SIZE_DESC}
            disabled={controlsDisabled}
            onChange={(v) => setUwpField('size', v)}
          />
          <UwpSlider
            label="Atmosphere"
            value={u.atm}
            max={15}
            descriptions={ATM_DESC}
            disabled={controlsDisabled}
            onChange={(v) => setUwpField('atm', v)}
          />
          <UwpSlider
            label="Hydrographics"
            value={u.hydro}
            max={10}
            descriptions={HYDRO_DESC}
            disabled={controlsDisabled}
            onChange={(v) => setUwpField('hydro', v)}
          />
        </section>

        <section>
          <h2>Society</h2>
          <UwpSlider
            label="Population"
            value={u.pop}
            max={12}
            descriptions={POP_DESC}
            disabled={controlsDisabled}
            onChange={(v) => setUwpField('pop', v)}
          />
          <UwpSlider
            label="Tech level"
            value={u.tech}
            max={15}
            descriptions={TECH_DESC}
            disabled={controlsDisabled}
            onChange={(v) => setUwpField('tech', v)}
          />
        </section>

        <section>
          <h2>View</h2>
          <Slider
            label="Seed"
            value={p.seed}
            min={0}
            max={0xffffffff}
            step={1}
            disabled={controlsDisabled}
            format={(v) => v.toFixed(0)}
            onInput={(v) => updateParams({ seed: v })}
          />
          <Slider
            label="Sun angle"
            value={p.sun_angle}
            min={0}
            max={1}
            disabled={controlsDisabled}
            onInput={(v) => updateParams({ sun_angle: v })}
          />
          <Slider
            label="Auto rotate"
            value={p.auto_rotate}
            min={0}
            max={0.6}
            disabled={controlsDisabled}
            onInput={(v) => updateParams({ auto_rotate: v })}
          />
        </section>

        <footer class="panel-footer">
          <span>Drag to orbit · scroll to zoom</span>
        </footer>
      </aside>
    </>
  )
}
