export type RGB = [number, number, number]

export interface Params {
  seed: number
  sea_level: number
  mountain_height: number
  noise_frequency: number
  noise_octaves: number
  atmosphere_density: number
  atmosphere_color: RGB
  ocean_color: RGB
  land_color: RGB
  mountain_color: RGB
  sand_color: RGB
  snow_color: RGB
  ice_latitude: number
  sun_angle: number
  auto_rotate: number
  cloud_coverage: number
  crater_density: number
  population_intensity: number
  vegetation_richness: number
  atm_banding: number
  /** 0 = terrain world, 1 = fluid gas/ice giant, 2 = stellar photosphere,
   *  3 = small irregular asteroid/planetoid. */
  body_visual_mode: number
  /** 0 means derive from the current main-world climate in Rust. Non-zero
   *  lets clicked non-main bodies carry their own climate/temperature. */
  surface_temp_k: number
  planet_radius: number
  render_quality: number
}

export const defaultParams: Params = {
  seed: 1337,
  sea_level: 0.52,
  mountain_height: 0.05,
  noise_frequency: 1.5,
  noise_octaves: 7,
  atmosphere_density: 0.45,
  atmosphere_color: [0.46, 0.68, 1.0],
  ocean_color: [0.03, 0.15, 0.42],
  land_color: [0.18, 0.55, 0.20],
  mountain_color: [0.40, 0.32, 0.24],
  sand_color: [0.86, 0.76, 0.52],
  snow_color: [0.97, 0.98, 1.0],
  ice_latitude: 0.82,
  sun_angle: 0.45,
  auto_rotate: 0.05,
  cloud_coverage: 0.22,
  crater_density: 0.0,
  population_intensity: 0.0,
  vegetation_richness: 0.65,
  atm_banding: 0.0,
  body_visual_mode: 0,
  surface_temp_k: 0,
  planet_radius: 1.0,
  render_quality: 1.0,
}

export function randomizeParams(current: Params, random: () => number = Math.random): Params {
  const rand = (a: number, b: number) => a + random() * (b - a)
  return {
    ...current,
    seed: Math.floor(random() * 0xFFFFFFFF),
    sea_level: rand(0.35, 0.7),
    mountain_height: rand(0.03, 0.12),
    noise_frequency: rand(1.2, 2.6),
    noise_octaves: Math.floor(rand(5, 9)),
    cloud_coverage: rand(0.15, 0.7),
    ice_latitude: rand(0.65, 0.92),
    atmosphere_density: rand(0.35, 0.85),
    sun_angle: rand(0.40, 0.52),
  }
}
