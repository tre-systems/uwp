import { detailTarget, params } from '../appState'
import type { Params } from '../params'
import { systemName } from '../domain/names'
import type { BodyType, SolarSystem, SystemBodyTarget } from '../domain/system'
import { isMainWorldTarget, targetExists } from '../systemVisualMapping'

/** Resolve which system body the detail renderer is showing. */
export function resolvedDetailTarget(
  system: SolarSystem | null,
  target: SystemBodyTarget | null = detailTarget.value,
): SystemBodyTarget | null {
  if (!system) return null
  if (target && targetExists(system, target)) return target
  return inferDetailTargetFromParams(system, params.value)
}

function inferDetailTargetFromParams(
  system: SolarSystem,
  p: Params,
): SystemBodyTarget | null {
  const seed = p.seed >>> 0
  const planetIndex = system.planets.findIndex((planet) => (planet.seed >>> 0) === seed)
  if (planetIndex >= 0) {
    return { kind: 'planet', index: planetIndex }
  }
  if ((system.seed >>> 0) === seed) {
    const mainIndex = system.main_world
    if (mainIndex >= 0 && system.planets[mainIndex]) {
      return { kind: 'planet', index: mainIndex }
    }
    return { kind: 'star', index: 0 }
  }
  if (system.companion && ((system.seed ^ 0xA51CE5ED) >>> 0) === seed) {
    return { kind: 'star', index: 1 }
  }
  for (let i = 0; i < system.belts.length; i++) {
    const beltSeed = (system.seed ^ ((i + 1) * 0x9E3779B1)) >>> 0
    if (beltSeed === seed) return { kind: 'belt', index: i }
  }
  return null
}

export function formatBodyViewLabel(
  system: SolarSystem | null,
  target: SystemBodyTarget | null = resolvedDetailTarget(system),
): string {
  if (!system || !target) return 'Main World'
  if (target.kind === 'planet') {
    const planet = system.planets[target.index]
    if (!planet) return 'Body Detail'
    const name = systemName(planet.seed)
    if (isMainWorldTarget(system, target)) return name
    return `${name} · ${bodyTypeShortLabel(planet.body_type)} ${target.index + 1}`
  }
  if (target.kind === 'star') {
    return target.index === 0 ? 'Primary Star' : 'Companion Star'
  }
  return `Asteroid Belt ${target.index + 1}`
}

const BODY_TYPE_LABELS: Record<BodyType, string> = {
  Rocky: 'Rocky',
  Terrestrial: 'Terrestrial',
  SuperEarth: 'Super-Earth',
  MiniNeptune: 'Mini-Neptune',
  GasGiant: 'Gas Giant',
  IceGiant: 'Ice Giant',
  Frozen: 'Frozen',
  Inferno: 'Inferno',
}

function bodyTypeShortLabel(body: BodyType): string {
  return BODY_TYPE_LABELS[body] ?? body
}

export function formatSurfaceCrumbLabel(
  system: SolarSystem | null,
  target: SystemBodyTarget | null = resolvedDetailTarget(system),
): string {
  if (!system || !target || target.kind !== 'planet') return 'Surface'
  const planet = system.planets[target.index]
  if (!planet) return 'Surface'
  if (isMainWorldTarget(system, target)) return 'Surface'
  return `Surface · ${systemName(planet.seed)}`
}
