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
  const planet = sys.planets[target.index]
  if (!planet) return null
  const orbit = planet.orbit_au < 0.1
    ? planet.orbit_au.toFixed(3)
    : planet.orbit_au.toFixed(2)
  const mass = planet.mass_earth < 1
    ? planet.mass_earth.toFixed(2)
    : planet.mass_earth.toFixed(0)
  return (
    <div
      class="hover-tooltip"
      style={{ left: `${target.x + 14}px`, top: `${target.y + 14}px` }}
      role="status"
    >
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
      {planet.in_habitable_zone && (
        <div class="hover-tooltip-tag">in habitable zone</div>
      )}
    </div>
  )
}
