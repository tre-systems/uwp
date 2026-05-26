import type { ComponentChildren } from 'preact'
import { currentSystem, hoverTarget, viewMode } from '../appState'
import { systemName } from '../domain/names'
import { BodyTypeIcon, bodyTypeLabel } from './Icon'

// Floating chip rendered near the cursor when the system-view ray-pick
// resolves a body. Stays out of the way (pointer-events: none) and
// auto-clears when the pointer leaves the canvas or the user changes
// view mode.

export function HoverTooltip() {
  const target = hoverTarget.value
  const sys = currentSystem.value
  const mode = viewMode.value
  if (!target || !sys || mode !== 'system') return null
  if (target.kind === 'star') {
    const star = target.index === 0 ? sys.star : sys.companion?.star
    if (!star) return null
    return (
      <TooltipFrame target={target}>
        <div class="hover-tooltip-head">
          <BodyTypeIcon body="SuperEarth" title="Star" />
          <strong>{target.index === 0 ? 'Primary star' : 'Companion star'}</strong>
          <span class="hover-tooltip-idx">{star.spectral}</span>
        </div>
        <div class="hover-tooltip-class">{star.temperature_k.toFixed(0)} K photosphere</div>
        <div class="hover-tooltip-meta">
          <span>{star.mass_solar.toFixed(2)} M⊙</span>
          <span>·</span>
          <span>{star.radius_solar.toFixed(2)} R⊙</span>
          <span>·</span>
          <span>{star.luminosity_solar < 0.01 ? star.luminosity_solar.toExponential(1) : star.luminosity_solar.toFixed(2)} L⊙</span>
        </div>
      </TooltipFrame>
    )
  }
  if (target.kind === 'belt') {
    const belt = sys.belts[target.index]
    if (!belt) return null
    return (
      <TooltipFrame target={target}>
        <div class="hover-tooltip-head">
          <BodyTypeIcon body="Rocky" title="Asteroid belt" />
          <strong>Asteroid belt</strong>
          <span class="hover-tooltip-idx">#{target.index + 1}</span>
        </div>
        <div class="hover-tooltip-class">{(belt.density * 100).toFixed(0)}% visual density</div>
        <div class="hover-tooltip-meta">
          <span>{belt.inner_au.toFixed(2)} AU</span>
          <span>–</span>
          <span>{belt.outer_au.toFixed(2)} AU</span>
        </div>
      </TooltipFrame>
    )
  }
  const planet = sys.planets[target.index]
  if (!planet) return null
  const orbit = planet.orbit_au < 0.1
    ? planet.orbit_au.toFixed(3)
    : planet.orbit_au.toFixed(2)
  const mass = planet.mass_earth < 1
    ? planet.mass_earth.toFixed(2)
    : planet.mass_earth.toFixed(0)
  // Year via Kepler's 3rd in Earth/Sun units. Day comes pre-computed.
  // Show the most natural unit: days/months/years depending on scale.
  const yearYears = Math.sqrt(Math.pow(planet.orbit_au, 3) / Math.max(sys.star.mass_solar, 0.01))
  const yearLabel = yearYears < 0.05
    ? `${(yearYears * 365.25).toFixed(1)} d`
    : yearYears < 1
      ? `${(yearYears * 12).toFixed(1)} mo`
      : `${yearYears.toFixed(yearYears < 10 ? 1 : 0)} yr`
  const dayHours = planet.day_seconds / 3600
  const dayLabel = dayHours < 1
    ? `${(dayHours * 60).toFixed(0)} min`
    : dayHours > 100
      ? `${(dayHours / 24).toFixed(1)} d`
      : `${dayHours.toFixed(1)} h`
  return (
    <TooltipFrame target={target}>
      <div class="hover-tooltip-head">
        <BodyTypeIcon body={planet.body_type} title={bodyTypeLabel(planet.body_type)} />
        <strong>{systemName(planet.seed)}</strong>
        <span class="hover-tooltip-idx">#{target.index + 1}</span>
      </div>
      <div class="hover-tooltip-class">{bodyTypeLabel(planet.body_type)}</div>
      <div class="hover-tooltip-meta">
        <span>{orbit} AU</span>
        <span>·</span>
        <span>{mass} M⊕</span>
        <span>·</span>
        <span>{planet.temperature_k.toFixed(0)} K</span>
      </div>
      <div class="hover-tooltip-meta hover-tooltip-meta-sub">
        <span>year {yearLabel}</span>
        <span>·</span>
        <span>day {dayLabel}</span>
      </div>
      {planet.in_habitable_zone && (
        <div class="hover-tooltip-tag">in habitable zone</div>
      )}
    </TooltipFrame>
  )
}

function TooltipFrame({ target, children }: { target: { x: number; y: number }; children: ComponentChildren }) {
  // Flip the tooltip to the cursor's left / above when it would
  // otherwise clip the viewport edge. 260 = max-width (240) + the 14px
  // gap; 160 is a generous upper bound on the rendered card height.
  // We anchor by `right` / `bottom` so the card slides cleanly past
  // the cursor instead of jumping when its rendered width changes.
  const MARGIN = 14
  const TOOLTIP_MAX_W = 260
  const TOOLTIP_APPROX_H = 160
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768
  const flipX = target.x > vw - TOOLTIP_MAX_W
  const flipY = target.y > vh - TOOLTIP_APPROX_H
  const style: Record<string, string> = {
    left: flipX ? 'auto' : `${target.x + MARGIN}px`,
    right: flipX ? `${vw - target.x + MARGIN}px` : 'auto',
    top: flipY ? 'auto' : `${target.y + MARGIN}px`,
    bottom: flipY ? `${vh - target.y + MARGIN}px` : 'auto',
  }
  return (
    <div class="hover-tooltip" style={style} role="status">
      {children}
    </div>
  )
}
