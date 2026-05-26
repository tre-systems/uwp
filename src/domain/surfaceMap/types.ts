// Mirrors the Rust `domain::surface_map` serde shape. Field names match
// the Rust struct so `serde_wasm_bindgen::to_value` round-trips into
// these interfaces.

export type Terrain =
  | 'Ocean'
  | 'Shoreline'
  | 'Plain'
  | 'Forest'
  | 'Hill'
  | 'Mountain'
  | 'Desert'
  | 'Tundra'
  | 'Ice'
  | 'Volcanic'

export interface SurfaceHexCoord {
  col: number
  row: number
}

export interface SurfaceCellId {
  face: number
  i: number
  j: number
  up: boolean
  resolution: number
}

export interface SurfaceHex {
  coord: SurfaceHexCoord
  cell_id?: SurfaceCellId | null
  terrain: Terrain
  latitude_deg: number
  longitude_deg: number
  temperature_k: number
  elevation: number
}

export interface Settlement {
  coord: SurfaceHexCoord
  cell_id?: SurfaceCellId | null
  /** 0 = village, 1 = town, 2 = city, 3 = metropolis. */
  tier: number
}

export interface SurfaceAtlasCell {
  id: SurfaceCellId
  coord: SurfaceHexCoord
  x: number
  y: number
  latitude_deg: number
  longitude_deg: number
  elevation: number
  elevation_signed: number
  water_depth: number
  slope: number
  moisture: number
  temperature_k: number
  biome_id: number
  terrain: Terrain
  flat_boundary: Array<[number, number]>
}

export interface SurfaceAtlas {
  resolution: number
  hex_radius: number
  net_width: number
  net_height: number
  sea_level_threshold: number
  cells: SurfaceAtlasCell[]
}

export interface SurfaceMap {
  seed: number
  ocean_fraction: number
  atlas?: SurfaceAtlas
  hexes: SurfaceHex[]
  starport: SurfaceHexCoord | null
  starport_cell_id?: SurfaceCellId | null
  cities: Settlement[]
}

export function terrainLabel(t: Terrain): string {
  switch (t) {
    case 'Ocean': return 'Ocean'
    case 'Shoreline': return 'Shoreline'
    case 'Plain': return 'Plain'
    case 'Forest': return 'Forest'
    case 'Hill': return 'Hill'
    case 'Mountain': return 'Mountain'
    case 'Desert': return 'Desert'
    case 'Tundra': return 'Tundra'
    case 'Ice': return 'Ice'
    case 'Volcanic': return 'Volcanic'
  }
}

export function hexCoordLabel(coord: SurfaceHexCoord): string {
  return `${coord.col.toString().padStart(2, '0')}${coord.row.toString().padStart(2, '0')}`
}
