import { rerollPlanet, rerollSystemSeed } from '../appState'
import type { AsteroidBelt, Planet, SolarSystem } from '../domain/system'

interface SystemEditorProps {
  system: SolarSystem
  disabled: boolean
}

export function SystemEditor({ system, disabled }: SystemEditorProps) {
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
            {system.planets.map((p: Planet, i: number) => (
              <tr class={i === system.main_world ? 'sys-main' : ''} key={p.seed}>
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
                    onClick={() => rerollPlanet(i)}
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
          {system.belts.map((b: AsteroidBelt, i: number) => (
            <div class="sys-belt" key={i}>
              {b.inner_au.toFixed(2)} – {b.outer_au.toFixed(2)} AU
            </div>
          ))}
        </section>
      )}
    </>
  )
}
