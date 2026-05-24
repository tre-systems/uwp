import type { ComponentChildren } from 'preact'
import { useState } from 'preact/hooks'
import { params, rerollPlanet, rerollSystemSeed, setSystemSeed, uwp } from '../appState'
import { deriveTradeCodes, tradeCodeName, type TradeCode } from '../domain/cepheus'
import type { AsteroidBelt, Planet, SolarSystem } from '../domain/system'
import { systemName } from '../domain/names'
import { BodyTypeIcon, bodyTypeLabel } from './Icon'
import { BodyInspector } from './BodyInspector'
import { SeedField } from './SeedField'

interface SystemEditorProps {
  system: SolarSystem
  disabled: boolean
}

export function SystemEditor({ system, disabled }: SystemEditorProps) {
  const star = system.star
  const comp = system.companion
  // Click a row to expand a derived-properties strip beneath it. Reroll
  // clears the selection — the planet you were looking at no longer exists
  // and we don't want to flash stats from a stale seed.
  const [expanded, setExpanded] = useState<number | null>(null)
  // Trade codes are derived from the authored UWP digits, which currently
  // represent the user-edited main world. Once the renderer-side main-world
  // reconciliation lands these will track the generated world automatically.
  const tradeCodes = deriveTradeCodes(uwp.value)
  const name = systemName(system.seed)
  // For the user, the "main world" is the one they're authoring in the
  // UWP/Detail editor, not the unrelated rocky body the climate model
  // happened to pick. Surface those values directly so the System and
  // Surface views agree on what the player's world looks like.
  const authoredParams = params.value
  const authoredWaterPct = (authoredParams.sea_level * 100).toFixed(0)
  const authoredHabitability = uwpHabitabilityEstimate(uwp.value)
  return (
    <>
      <section>
        <h2>System · {name}</h2>
        <dl class="sys-meta">
          <MetaRow label="Primary">
            {star.spectral}-class · {star.mass_solar.toFixed(2)} M⊙ ·
            {' '}{star.luminosity_solar < 0.01
              ? star.luminosity_solar.toExponential(2)
              : star.luminosity_solar.toFixed(2)} L⊙ · {star.temperature_k.toFixed(0)} K
          </MetaRow>
          {comp && (
            <MetaRow label="Companion">
              {comp.star.spectral}-class · {comp.star.mass_solar.toFixed(2)} M⊙ ·
              {' '}separation {comp.separation_au.toFixed(1)} AU
            </MetaRow>
          )}
          <MetaRow label="Habitable zone">
            {system.hz_inner_au.toFixed(2)} – {system.hz_outer_au.toFixed(2)} AU
          </MetaRow>
          <MetaRow label="Snow line">{system.snow_line_au.toFixed(2)} AU</MetaRow>
          <MetaRow label="Age">{system.age_gyr.toFixed(1)} Gyr</MetaRow>
          <MetaRow label="Main world (UWP)">
            Hydrographics {uwp.value.hydro} · {authoredWaterPct}% water
          </MetaRow>
          {(() => {
            const mw = system.main_world >= 0 ? system.planets[system.main_world] : null
            if (!mw) return null
            const rain = mw.climate.mean_rainfall_mm
            const inertia = mw.climate.thermal_inertia
            return (
              <MetaRow label="Climate">
                {rain.toFixed(0)} mm/yr · thermal inertia {Math.round(inertia * 100)}%
              </MetaRow>
            )
          })()}
          <div class="sys-meta-row sys-meta-bar">
            <dt>Habitability</dt>
            <dd>
              <HabitabilityBar value={authoredHabitability} />
            </dd>
          </div>
        </dl>
        {tradeCodes.length > 0 && <TradeCodeChips codes={tradeCodes} />}

        <div class="sys-actions">
          <button onClick={rerollSystemSeed} disabled={disabled}>
            New system
          </button>
          <SeedField
            value={system.seed}
            disabled={disabled}
            onChange={setSystemSeed}
            aria-label="System seed"
          />
        </div>
      </section>

      <section>
        <h2>Planets ({system.planets.length})</h2>
        <table class="sys-table">
          <thead>
            <tr>
              <th class="sys-col-num">#</th>
              <th>Class</th>
              <th class="sys-col-num">Orbit</th>
              <th class="sys-col-num">Mass</th>
              <th class="sys-col-num">T<sub>eq</sub></th>
              <th class="sys-col-num">Moons</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {system.planets.map((p: Planet, i: number) => {
              const isMain = i === system.main_world
              const isOpen = expanded === i
              const rowClass = [
                'sys-row',
                isMain ? 'sys-main' : '',
                isOpen ? 'sys-row-open' : '',
              ].filter(Boolean).join(' ')
              return (
                <>
                  <tr
                    class={rowClass}
                    key={p.seed}
                    onClick={() => setExpanded(isOpen ? null : i)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    aria-label={`Planet ${i + 1} ${bodyTypeLabel(p.body_type)}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setExpanded(isOpen ? null : i)
                      }
                    }}
                  >
                    <td class="sys-col-num">
                      {isMain ? <span class="sys-main-marker" title="Main world">★</span> : null}
                      {i + 1}
                    </td>
                    <td>
                      <span class="body-type">
                        <BodyTypeIcon body={p.body_type} title={bodyTypeLabel(p.body_type)} />
                        <span class="body-type-label">{bodyTypeLabel(p.body_type)}</span>
                      </span>
                    </td>
                    <td class="sys-col-num">
                      {p.orbit_au < 0.1 ? p.orbit_au.toFixed(3) : p.orbit_au.toFixed(2)}
                      <span class="sys-unit">AU</span>
                    </td>
                    <td class="sys-col-num">
                      {p.mass_earth < 1 ? p.mass_earth.toFixed(2) : p.mass_earth.toFixed(0)}
                      <span class="sys-unit">M⊕</span>
                    </td>
                    <td class="sys-col-num">
                      {p.temperature_k.toFixed(0)}
                      <span class="sys-unit">K</span>
                    </td>
                    <td class="sys-col-num">{p.moons.length || '—'}</td>
                    <td class="sys-col-action">
                      <button
                        class="sys-reroll"
                        disabled={disabled}
                        title={`Reroll planet ${i + 1}`}
                        aria-label={`Reroll planet ${i + 1}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setExpanded(null)
                          rerollPlanet(i)
                        }}
                      >
                        <RerollGlyph />
                      </button>
                    </td>
                  </tr>
                  {isOpen && <BodyInspector planet={p} star={star} columnSpan={7} />}
                </>
              )
            })}
          </tbody>
        </table>
      </section>

      {system.belts.length > 0 && (
        <section>
          <h2>Asteroid belts ({system.belts.length})</h2>
          {system.belts.map((b: AsteroidBelt, i: number) => (
            <div class="sys-belt" key={i}>
              <span class="sys-belt-dots" aria-hidden="true">·····</span>
              {b.inner_au.toFixed(2)} – {b.outer_au.toFixed(2)} AU
            </div>
          ))}
        </section>
      )}
    </>
  )
}

/// Rough habitability score from the user's UWP digits. Mirrors the
/// system editor's previous Rust-side bar so a tweak to atmosphere /
/// hydrographics / pop visibly updates the chip.
function uwpHabitabilityEstimate(u: import('../uwp').UwpDigits): number {
  const atmFit = u.atm >= 4 && u.atm <= 9 ? 1.0 : u.atm === 3 || u.atm === 13 ? 0.4 : 0
  const hydroFit = u.hydro >= 2 && u.hydro <= 9 ? 1.0 : 0.3
  const sizeFit = u.size >= 4 && u.size <= 10 ? 1.0 : 0.5
  const popBoost = u.pop >= 5 ? 0.15 : 0
  return Math.min(1, 0.85 * atmFit * hydroFit * sizeFit + popBoost)
}

function MetaRow({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="sys-meta-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function HabitabilityBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value))
  const tone = pct >= 0.6 ? 'good' : pct >= 0.3 ? 'fair' : 'poor'
  return (
    <div class={`hab-bar hab-bar-${tone}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
      <div class="hab-bar-fill" style={{ width: `${pct * 100}%` }} />
      <span class="hab-bar-label">{Math.round(pct * 100)}%</span>
    </div>
  )
}

function RerollGlyph() {
  // 14x14 circular-arrow refresh glyph - reads as "regenerate" without the
  // gambling overtone of a die.
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M13.5 8a5.5 5.5 0 1 1-1.8-4.1" />
      <path d="M13 2v3h-3" />
    </svg>
  )
}

function TradeCodeChips({ codes }: { codes: readonly TradeCode[] }) {
  return (
    <div class="trade-codes" aria-label="Trade codes for the main world">
      <span class="trade-codes-label">Trade codes</span>
      <span class="trade-codes-list">
        {codes.map((code) => (
          <abbr
            key={code}
            class="trade-chip"
            title={tradeCodeName(code)}
            tabIndex={0}
          >
            {code}
          </abbr>
        ))}
      </span>
    </div>
  )
}
