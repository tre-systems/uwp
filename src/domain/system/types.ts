export type SpectralClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M'

export type BodyType =
  | 'Rocky'
  | 'Terrestrial'
  | 'SuperEarth'
  | 'MiniNeptune'
  | 'IceGiant'
  | 'GasGiant'
  | 'Inferno'
  | 'Frozen'

export interface Star {
  spectral: SpectralClass
  mass_solar: number
  luminosity_solar: number
  radius_solar: number
  temperature_k: number
  color: [number, number, number]
}

export interface Moon {
  orbit_radii: number
  radius_earth: number
  phase_rad: number
  icy: boolean
}

export interface Planet {
  orbit_au: number
  eccentricity: number
  inclination_deg: number
  radius_earth: number
  mass_earth: number
  temperature_k: number
  body_type: BodyType
  phase_rad: number
  day_seconds: number
  in_habitable_zone: boolean
  moons: Moon[]
  seed: number
  climate: ClimateSummary
}

export interface ClimateSummary {
  mean_surface_temp_k: number
  min_surface_temp_k: number
  max_surface_temp_k: number
  greenhouse_k: number
  liquid_water_fraction: number
  ice_fraction: number
  aridity: number
  habitability: number
  /** 0 = bone dry / no oceans, 1 = ocean world. */
  thermal_inertia: number
  /** Rough global-mean rainfall in mm/yr. */
  mean_rainfall_mm: number
}

export interface AsteroidBelt {
  inner_au: number
  outer_au: number
  density: number
}

export interface Companion {
  star: Star
  separation_au: number
  phase_rad: number
  inclination_deg: number
}

export interface SolarSystem {
  seed: number
  star: Star
  companion?: Companion | null
  planets: Planet[]
  belts: AsteroidBelt[]
  hz_inner_au: number
  hz_outer_au: number
  snow_line_au: number
  age_gyr: number
  main_world: number
}

export interface MainWorldSummary {
  planetIndex: number
  orbitAu: number
  radiusEarth: number
  massEarth: number
  temperatureK: number
  bodyType: BodyType
  moonCount: number
}

export type SystemBodyTarget =
  | { kind: 'planet'; index: number }
  | { kind: 'star'; index: 0 | 1 }
  | { kind: 'belt'; index: number }
