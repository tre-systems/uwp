import {
  ATM_DESC,
  currentSystem,
  HYDRO_DESC,
  panelOpen,
  params,
  parseUwpDigits,
  POP_DESC,
  randomizeUwp,
  rerollSystemSeed,
  resetUwp,
  setUwpField,
  setUwpFromCode,
  SIZE_DESC,
  STARPORT_OPTIONS,
  systemSeed,
  TECH_DESC,
  updateParams,
  uwp,
  uwpHex,
  uwpToCode,
  viewMode,
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

/** Compact view of the currently-loaded solar system: star, companion (if
 * any), HZ + snow-line + age, planet list, and asteroid belts. Shown in
 * the panel whenever the user is in System view mode. */
function SystemEditor({ system, disabled }: { system: any; disabled: boolean }) {
  const star = system.star
  const comp = system.companion
  return (
    <>
      <section>
        <h2>System</h2>
        <div class="sys-meta">
          <div>
            <strong>Primary:</strong> {star.spectral}-class · {star.mass_solar.toFixed(2)} M⊙ ·
            {' '}{star.luminosity_solar < 0.01
              ? star.luminosity_solar.toExponential(2)
              : star.luminosity_solar.toFixed(2)} L⊙ · {star.temperature_k.toFixed(0)} K
          </div>
          {comp && (
            <div>
              <strong>Companion:</strong> {comp.star.spectral}-class ·
              {' '}{comp.star.mass_solar.toFixed(2)} M⊙ ·
              {' '}separation {comp.separation_au.toFixed(1)} AU
            </div>
          )}
          <div>
            <strong>Habitable zone:</strong> {system.hz_inner_au.toFixed(2)} –
            {' '}{system.hz_outer_au.toFixed(2)} AU
          </div>
          <div>
            <strong>Snow line:</strong> {system.snow_line_au.toFixed(2)} AU ·
            {' '}<strong>Age:</strong> {system.age_gyr.toFixed(1)} Gyr
          </div>
        </div>

        <div class="sys-actions">
          <button onClick={rerollSystemSeed} disabled={disabled}>
            New system
          </button>
          <span class="sys-seed">seed {system.seed}</span>
        </div>
      </section>

      <section>
        <h2>Planets ({system.planets.length})</h2>
        <table class="sys-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Class</th>
              <th>Orbit</th>
              <th>Mass</th>
              <th>T<sub>eq</sub></th>
              <th>Moons</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {system.planets.map((p: any, i: number) => (
              <tr class={i === system.main_world ? 'sys-main' : ''}>
                <td>{i + 1}{i === system.main_world ? ' ★' : ''}</td>
                <td>{p.body_type}</td>
                <td>{p.orbit_au < 0.1 ? p.orbit_au.toFixed(3) : p.orbit_au.toFixed(2)} AU</td>
                <td>{p.mass_earth < 1
                  ? p.mass_earth.toFixed(2)
                  : p.mass_earth.toFixed(0)} M⊕</td>
                <td>{p.temperature_k.toFixed(0)} K</td>
                <td>{p.moons.length || '—'}</td>
                <td>
                  <button
                    class="sys-reroll"
                    disabled={disabled}
                    title={`Reroll planet ${i + 1}`}
                    onClick={() => {
                      const w = window as any
                      const newSeed = Math.floor(Math.random() * 0xffffffff)
                      w.uwp?.rerollPlanet?.(i, newSeed)
                      // Force the panel + render to pick up the new state.
                      currentSystem.value = w.uwp?.getSystem?.() ?? null
                    }}
                  >🎲</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {system.belts.length > 0 && (
        <section>
          <h2>Asteroid belts ({system.belts.length})</h2>
          {system.belts.map((b: any, i: number) => (
            <div class="sys-belt" key={i}>
              {b.inner_au.toFixed(2)} – {b.outer_au.toFixed(2)} AU
            </div>
          ))}
        </section>
      )}
    </>
  )
}

export function ControlPanel() {
  // Accessing .value inside JSX subscribes the component to changes.
  const u = uwp.value
  const p = params.value
  const open = panelOpen.value
  const mode = viewMode.value
  const sys = currentSystem.value
  const _ = systemSeed.value  // subscribe so the panel re-renders on seed change
  void _
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
          <h1>{mode === 'system' ? 'System' : 'UWP'}</h1>
          <div class="panel-actions">
            {mode === 'detail' && (
              <>
                <button onClick={randomizeUwp} disabled={controlsDisabled}>Randomize</button>
                <button class="ghost" onClick={resetUwp} disabled={controlsDisabled}>Reset</button>
              </>
            )}
          </div>
        </header>

        {mode === 'system' && sys && (
          <SystemEditor system={sys} disabled={controlsDisabled} />
        )}

        {mode === 'detail' && (<>

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

        </>)}

        <footer class="panel-footer">
          <span>Drag to orbit · scroll to zoom</span>
        </footer>
      </aside>
    </>
  )
}
