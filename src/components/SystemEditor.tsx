import type { ComponentChildren } from 'preact'
import { rerollPlanet, rerollSystemSeed, uwp } from '../appState'
import { deriveTradeCodes, tradeCodeName, type TradeCode } from '../domain/cepheus'
import type { AsteroidBelt, Planet, SolarSystem } from '../domain/system'
import { systemName } from '../domain/names'
import { BodyTypeIcon, bodyTypeLabel } from './Icon'

interface SystemEditorProps {
  system: SolarSystem
  disabled: boolean
}

export function SystemEditor({ system, disabled }: SystemEditorProps) {
  const star = system.star
  const comp = system.companion
  const mainWorld = system.main_world >= 0 ? system.planets[system.main_world] : null
  // Trade codes are derived from the authored UWP digits, which currently
  // represent the user-edited main world. Once the renderer-side main-world
  // reconciliation lands these will track the generated world automatically.
  const tradeCodes = deriveTradeCodes(uwp.value)
  const name = systemName(system.seed)
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
          {mainWorld && (
            <MetaRow label="Main world climate">
              {mainWorld.climate.mean_surface_temp_k.toFixed(0)} K mean ·
              {' '}water {(mainWorld.climate.liquid_water_fraction * 100).toFixed(0)}%
            </MetaRow>
          )}
          {mainWorld && (
            <div class="sys-meta-row sys-meta-bar">
              <dt>Habitability</dt>
              <dd>
                <HabitabilityBar value={mainWorld.climate.habitability} />
              </dd>
            </div>
          )}
        </dl>
        {tradeCodes.length > 0 && <TradeCodeChips codes={tradeCodes} />}

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
              return (
                <tr class={isMain ? 'sys-row sys-main' : 'sys-row'} key={p.seed}>
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
                      onClick={() => rerollPlanet(i)}
                    >
                      <RerollGlyph />
                    </button>
                  </td>
                </tr>
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
