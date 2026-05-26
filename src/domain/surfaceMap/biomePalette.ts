// Canonical biome palette. Mirrors the WGSL `biome_color()` in
// `crates/planet-render/src/shaders/planet.wgsl` and the Rust
// `BiomeId` enum in `crates/planet-render/src/domain/surface_prebake.rs`.
//
// All three render paths (globe shader, surface-map background, region
// view) MUST source their colours from this table — re-deriving biome
// colours from local heuristics is exactly what made the views
// disagree before. If you change a colour here, change it in
// `planet.wgsl::biome_color` too.

export type BiomeId =
  | 0 // DeepOcean
  | 1 // ShallowOcean
  | 2 // Shore
  | 3 // Plain
  | 4 // Grassland
  | 5 // Forest
  | 6 // Savanna
  | 7 // Desert
  | 8 // Hills
  | 9 // Mountain
  | 10 // AlpineRock
  | 11 // Snow
  | 12 // Tundra
  | 13 // Ice
  | 14 // Volcanic
  | 15 // Barren

export const BIOME_NAMES: readonly string[] = [
  'DeepOcean',
  'ShallowOcean',
  'Shore',
  'Plain',
  'Grassland',
  'Forest',
  'Savanna',
  'Desert',
  'Hills',
  'Mountain',
  'AlpineRock',
  'Snow',
  'Tundra',
  'Ice',
  'Volcanic',
  'Barren',
]

export interface PaletteBaseColors {
  /** Linear 0..1 RGB, mirroring `PlanetParams.{ocean,land,mountain,sand,snow}_color`. */
  ocean: readonly [number, number, number]
  land: readonly [number, number, number]
  mountain: readonly [number, number, number]
  sand: readonly [number, number, number]
  snow: readonly [number, number, number]
}

type Rgb01 = [number, number, number]

/** Linear 0..1 RGB for the given biome id. */
export function biomeColorLinear(id: number, base: PaletteBaseColors): Rgb01 {
  switch (id) {
    case 0:
      return scale(base.ocean, 0.34) // DeepOcean
    case 1:
      return scale(base.ocean, 1.55) // ShallowOcean
    case 2:
      return mix3(base.sand, base.land, 0.4) // Shore
    case 3:
      return [base.land[0], base.land[1], base.land[2]] // Plain
    case 4:
      return mul3(base.land, [1.1, 1.1, 0.9]) // Grassland
    case 5:
      return mul3(base.land, [0.55, 0.68, 0.5]) // Forest
    case 6:
      return mix3(base.land, base.sand, 0.7) // Savanna
    case 7:
      return [base.sand[0], base.sand[1], base.sand[2]] // Desert
    case 8:
      return mix3(base.land, base.mountain, 0.3) // Hills
    case 9:
      return [base.mountain[0], base.mountain[1], base.mountain[2]] // Mountain
    case 10:
      return mix3(base.mountain, base.snow, 0.2) // AlpineRock
    case 11:
      return [base.snow[0], base.snow[1], base.snow[2]] // Snow
    case 12:
      return mix3(scale(base.snow, 0.85), scale(base.mountain, 0.7), 0.4) // Tundra
    case 13:
      return scale(base.snow, 0.94) // Ice
    case 14:
      return [0.1, 0.07, 0.05] // Volcanic
    default:
      return mix3(base.mountain, base.sand, 0.55) // Barren
  }
}

export function biomeIsOcean(id: number): boolean {
  return id === 0 || id === 1
}

export function biomeIsIce(id: number): boolean {
  return id === 11 || id === 13
}

/**
 * Encode linear 0..1 RGB to 0..255 sRGB integer. The globe's HDR
 * output goes through AGX tonemap before reaching the sRGB
 * framebuffer; this is the closest cheap approximation Canvas2D can
 * apply so the surface map renders in the same colour space.
 */
export function linearToSrgb8(c: number): number {
  const x = Math.max(0, Math.min(1, c))
  // Standard sRGB transfer.
  const enc = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055
  return Math.max(0, Math.min(255, Math.round(enc * 255)))
}

function scale(c: readonly [number, number, number], s: number): Rgb01 {
  return [c[0] * s, c[1] * s, c[2] * s]
}

function mix3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): Rgb01 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function mul3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): Rgb01 {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2]]
}

/** Best-effort mapping from the existing surface_map Terrain enum to a
 * BiomeId, for legacy callers that haven't migrated to biome ids yet. */
export const TERRAIN_TO_BIOME: Record<string, BiomeId> = {
  Ocean: 0,
  Shoreline: 2,
  Plain: 3,
  Forest: 5,
  Hill: 8,
  Mountain: 9,
  Desert: 7,
  Tundra: 12,
  Ice: 13,
  Volcanic: 14,
}
