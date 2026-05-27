import type { ComponentChildren } from 'preact'
import type { Planet, Star, Moon } from '../domain/system/types'

// Inline expansion row for the System editor's Planets table. The compute side
// already produced day length, mass, radius, eccentricity etc. - the inspector
// just derives the human-facing numbers a Referee actually quotes
// (year, gravity, density, escape velocity) and pulls the moon list out so it
// stops hiding behind a count.

const EARTH_RADIUS_KM = 6371
const EARTH_ESC_VEL_KMS = 11.186
const EARTH_DENSITY_GCC = 5.514

interface BodyInspectorProps {
  planet: Planet
  star: Star
  columnSpan: number
}

export function BodyInspector({ planet, star, columnSpan }: BodyInspectorProps) {
  // Kepler's third law in units where Earth/Sun = 1 yr at 1 AU around 1 Msun.
  const yearYears = Math.sqrt(Math.pow(planet.orbit_au, 3) / Math.max(star.mass_solar, 0.01))
  const dayHours = planet.day_seconds / 3600
  // Surface gravity in g: g/g_earth = M / R^2 (in Earth units).
  const gravityG = planet.mass_earth / Math.max(planet.radius_earth * planet.radius_earth, 1e-6)
  // Density in g/cc, anchored on Earth.
  const densityGcc = (planet.mass_earth / Math.max(Math.pow(planet.radius_earth, 3), 1e-6)) * EARTH_DENSITY_GCC
  // Escape velocity: v_esc / v_esc_earth = sqrt(M/R).
  const escVelKms = EARTH_ESC_VEL_KMS * Math.sqrt(planet.mass_earth / Math.max(planet.radius_earth, 1e-6))
  const radiusKm = planet.radius_earth * EARTH_RADIUS_KM
  const yearLabel = yearYears < 0.05
    ? `${(yearYears * 365.25).toFixed(1)} d`
    : yearYears < 1
      ? `${(yearYears * 12).toFixed(2)} mo`
      : `${yearYears.toFixed(2)} yr`
  const dayLabel = dayHours < 1
    ? `${(dayHours * 60).toFixed(0)} min`
    : dayHours > 100
      ? `${(dayHours / 24).toFixed(1)} d`
      : `${dayHours.toFixed(1)} h`

  return (
    <tr class="sys-inspector-row">
      <td colSpan={columnSpan}>
        <div class="sys-inspector">
          <dl class="sys-inspector-grid">
            <Stat label="Radius">{radiusKm.toFixed(0)} <span class="sys-unit">km</span></Stat>
            <Stat label="Gravity">{gravityG.toFixed(2)} <span class="sys-unit">g</span></Stat>
            <Stat label="Density">{densityGcc.toFixed(2)} <span class="sys-unit">g/cc</span></Stat>
            <Stat label="Escape v.">{escVelKms.toFixed(1)} <span class="sys-unit">km/s</span></Stat>
            <Stat label="Year">{yearLabel}</Stat>
            <Stat label="Day">{dayLabel}</Stat>
            <Stat label="Eccentricity">{planet.eccentricity.toFixed(3)}</Stat>
            <Stat label="Inclination">{planet.inclination_deg.toFixed(1)}<span class="sys-unit">°</span></Stat>
          </dl>
          {planet.moons.length > 0 && <MoonList moons={planet.moons} />}
        </div>
      </td>
    </tr>
  )
}

function Stat({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="sys-inspector-stat">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function MoonList({ moons }: { moons: Moon[] }) {
  return (
    <div class="sys-inspector-moons">
      <h4>Moons</h4>
      <ul>
        {moons.map((m, i) => {
          const radiusKm = m.radius_earth * EARTH_RADIUS_KM
          return (
            <li key={i}>
              <span class={`moon-dot${m.icy ? ' moon-dot-icy' : ''}`} aria-hidden="true" />
              <span class="moon-name">Moon {i + 1}</span>
              <span class="moon-stat">{radiusKm.toFixed(0)} km</span>
              <span class="moon-stat">{m.orbit_radii.toFixed(1)} R<sub>p</sub></span>
              <span class="moon-stat moon-type">{m.icy ? 'icy' : 'rocky'}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
