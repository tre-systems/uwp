import type { ComponentChildren } from 'preact'
import { focusMainWorldDetail } from '../appState'
import type { SolarSystem, SystemBodyTarget } from '../domain/system'
import { systemName } from '../domain/names'
import { BodyTypeIcon, bodyTypeLabel } from './Icon'

interface DetailTargetPanelProps {
  system: SolarSystem
  target: SystemBodyTarget
  disabled: boolean
}

export function DetailTargetPanel({ system, target, disabled }: DetailTargetPanelProps) {
  if (target.kind === 'planet') {
    const planet = system.planets[target.index]
    if (!planet) return null
    return (
      <section>
        <h2>Body detail</h2>
        <div class="detail-target-card">
          <div class="detail-target-head">
            <BodyTypeIcon body={planet.body_type} title={bodyTypeLabel(planet.body_type)} />
            <div>
              <strong>{systemName(planet.seed)}</strong>
              <span>{bodyTypeLabel(planet.body_type)} · planet {target.index + 1}</span>
            </div>
          </div>
          <dl class="detail-target-grid">
            <Meta label="Orbit">{planet.orbit_au.toFixed(planet.orbit_au < 0.1 ? 3 : 2)} AU</Meta>
            <Meta label="Radius">{planet.radius_earth.toFixed(2)} R⊕</Meta>
            <Meta label="Mass">{planet.mass_earth < 1 ? planet.mass_earth.toFixed(2) : planet.mass_earth.toFixed(0)} M⊕</Meta>
            <Meta label="Temperature">{planet.temperature_k.toFixed(0)} K</Meta>
            <Meta label="Day">{formatDuration(planet.day_seconds / 3600)}</Meta>
            <Meta label="Moons">{planet.moons.length}</Meta>
          </dl>
        </div>
        <button type="button" class="detail-target-return" onClick={focusMainWorldDetail} disabled={disabled}>
          Main world
        </button>
      </section>
    )
  }

  if (target.kind === 'star') {
    const star = target.index === 0 ? system.star : system.companion?.star
    if (!star) return null
    return (
      <section>
        <h2>Star detail</h2>
        <div class="detail-target-card">
          <div class="detail-target-head">
            <span class="detail-target-star" aria-hidden="true">✦</span>
            <div>
              <strong>{target.index === 0 ? 'Primary star' : 'Companion star'}</strong>
              <span>{star.spectral}-class photosphere</span>
            </div>
          </div>
          <dl class="detail-target-grid">
            <Meta label="Mass">{star.mass_solar.toFixed(2)} M⊙</Meta>
            <Meta label="Radius">{star.radius_solar.toFixed(2)} R⊙</Meta>
            <Meta label="Luminosity">{star.luminosity_solar < 0.01 ? star.luminosity_solar.toExponential(2) : star.luminosity_solar.toFixed(2)} L⊙</Meta>
            <Meta label="Temperature">{star.temperature_k.toFixed(0)} K</Meta>
          </dl>
        </div>
        <button type="button" class="detail-target-return" onClick={focusMainWorldDetail} disabled={disabled}>
          Main world
        </button>
      </section>
    )
  }

  const belt = system.belts[target.index]
  if (!belt) return null
  return (
    <section>
      <h2>Asteroid detail</h2>
      <div class="detail-target-card">
        <div class="detail-target-head">
          <BodyTypeIcon body="Rocky" title="Asteroid belt" />
          <div>
            <strong>Asteroid belt {target.index + 1}</strong>
            <span>Representative planetoid</span>
          </div>
        </div>
        <dl class="detail-target-grid">
          <Meta label="Inner">{belt.inner_au.toFixed(2)} AU</Meta>
          <Meta label="Outer">{belt.outer_au.toFixed(2)} AU</Meta>
          <Meta label="Density">{Math.round(belt.density * 100)}%</Meta>
        </dl>
      </div>
      <button type="button" class="detail-target-return" onClick={focusMainWorldDetail} disabled={disabled}>
        Main world
      </button>
    </section>
  )
}

function Meta({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`
  if (hours > 96) return `${(hours / 24).toFixed(1)} d`
  return `${hours.toFixed(1)} h`
}
