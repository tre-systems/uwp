import { signal } from '@preact/signals'

export const errorMessage = signal<string | null>(null)
export const panelOpen = signal(true)

export interface Params {
  seed: number
  sea_level: number
  mountain_height: number
  noise_frequency: number
  noise_octaves: number
  atmosphere_density: number
  atmosphere_color: [number, number, number]
  ocean_color: [number, number, number]
  land_color: [number, number, number]
  mountain_color: [number, number, number]
  sand_color: [number, number, number]
  snow_color: [number, number, number]
  ice_latitude: number
  sun_angle: number
  auto_rotate: number
  cloud_coverage: number
}

export const defaultParams: Params = {
  seed: 1337,
  sea_level: 0.52,
  mountain_height: 0.14,
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
  sun_angle: 0.55,
  auto_rotate: 0.05,
  cloud_coverage: 0.22,
}

export const params = signal<Params>({ ...defaultParams })

export function updateParams(patch: Partial<Params>) {
  params.value = { ...params.value, ...patch }
}

export function reset() {
  params.value = { ...defaultParams }
}

// Picks a new seed and randomizes the climate-y dials so each press feels different.
// Palette colors are left alone — the user usually wants those stable.
export function randomize() {
  const rand = (a: number, b: number) => a + Math.random() * (b - a)
  params.value = {
    ...params.value,
    seed: Math.floor(Math.random() * 0xFFFFFFFF),
    sea_level: rand(0.35, 0.7),
    mountain_height: rand(0.08, 0.32),
    noise_frequency: rand(1.2, 2.6),
    noise_octaves: Math.floor(rand(5, 9)),
    cloud_coverage: rand(0.15, 0.7),
    ice_latitude: rand(0.65, 0.92),
    atmosphere_density: rand(0.35, 0.85),
    sun_angle: rand(0, 1),
  }
}
