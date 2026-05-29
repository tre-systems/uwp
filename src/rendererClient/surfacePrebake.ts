import { generateSurfacePrebake, generateSurfacePrebakeFull } from '../../pkg/planet_render'
import type { SurfacePrebake } from '../domain/surfaceMap'
import type { Planet } from '../domain/system'
import type { Params } from '../params'

export interface SurfacePrebakeSnapshot extends SurfacePrebake {
  heightmap: Float32Array
  biome_id?: Uint8Array
  sea_level_threshold: number
}

interface CacheEntry {
  planetIndex: number
  seed: number
  waterFraction: number
  iceLatitude: number
  meanTempK: number
  vegetationRichness: number
  bake: SurfacePrebakeSnapshot
}

export class SurfacePrebakeCache {
  private cached: CacheEntry | null = null

  get(request: {
    planetIndex: number
    selectedPlanet: Planet
    params: Params
  }): SurfacePrebakeSnapshot | null {
    const { planetIndex, selectedPlanet, params } = request
    // The Rust surface_map::generate path uses params.seed (the visual
    // appearance seed), not the selected planet's per-body seed. The
    // background must use the same seed or continents drift away from
    // the hex grid terrain classifications.
    const seed = params.seed >>> 0
    const waterFraction = params.sea_level
    const iceLatitude = params.ice_latitude
    const vegetationRichness = params.vegetation_richness
    const meanTempK = effectiveSurfaceMeanTempK(
      selectedPlanet.climate?.mean_surface_temp_k ?? selectedPlanet.temperature_k ?? 288,
      params.atmosphere_density,
    )
    const cached = this.cached
    if (
      cached &&
      cached.planetIndex === planetIndex &&
      cached.seed === seed &&
      Math.abs(cached.waterFraction - waterFraction) < 0.0005 &&
      Math.abs(cached.iceLatitude - iceLatitude) < 0.0005 &&
      Math.abs(cached.meanTempK - meanTempK) < 0.05 &&
      Math.abs(cached.vegetationRichness - vegetationRichness) < 0.0005
    ) {
      return cached.bake
    }

    const bake = generateClimateAwarePrebake(
      seed,
      waterFraction,
      iceLatitude,
      meanTempK,
      vegetationRichness,
    )
    if (!bake) return null
    this.cached = {
      planetIndex,
      seed,
      waterFraction,
      iceLatitude,
      meanTempK,
      vegetationRichness,
      bake,
    }
    return bake
  }
}

function generateClimateAwarePrebake(
  seed: number,
  waterFraction: number,
  iceLatitude: number,
  meanTempK: number,
  vegetationRichness: number,
): SurfacePrebakeSnapshot | null {
  try {
    // Prefer the climate-aware bridge; it produces biome ids that
    // match the renderer atlas and Rust surface_map exactly.
    return normalizePrebake(generateSurfacePrebakeFull(
      seed,
      waterFraction,
      iceLatitude,
      meanTempK,
      vegetationRichness,
    ) as RawPrebake, waterFraction)
  } catch (err) {
    console.warn('generateSurfacePrebakeFull failed', err)
  }

  try {
    return normalizePrebake(generateSurfacePrebake(seed, waterFraction) as RawPrebake, waterFraction)
  } catch (err) {
    console.warn('generateSurfacePrebake fallback failed', err)
    return null
  }
}

interface RawPrebake {
  lon_cells: number
  lat_cells: number
  heightmap: Float32Array | number[]
  biome_id?: Uint8Array | number[]
  sea_level?: number
}

function normalizePrebake(raw: RawPrebake, waterFraction: number): SurfacePrebakeSnapshot {
  const heightmap = raw.heightmap instanceof Float32Array
    ? raw.heightmap
    : Float32Array.from(raw.heightmap)
  const biome_id = raw.biome_id instanceof Uint8Array
    ? raw.biome_id
    : raw.biome_id
      ? Uint8Array.from(raw.biome_id)
      : undefined
  // Rust normally ships its own sea-level threshold; only fall back to
  // the quantile for compatibility with older generated bindings.
  const sea_level_threshold = typeof raw.sea_level === 'number'
    ? raw.sea_level
    : quantileHeight(heightmap, waterFraction)
  return {
    lon_cells: raw.lon_cells,
    lat_cells: raw.lat_cells,
    heightmap,
    biome_id,
    sea_level_threshold,
  }
}

function quantileHeight(heightmap: Float32Array, q: number): number {
  if (heightmap.length === 0) return 0
  const sorted = Array.from(heightmap)
  sorted.sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))
  return sorted[idx] ?? 0
}

function effectiveSurfaceMeanTempK(baseMeanTempK: number, atmosphereDensity: number): number {
  const warmthFromAtm = atmosphereDensity * 30
  return Number.isFinite(baseMeanTempK) && baseMeanTempK > 0
    ? baseMeanTempK + warmthFromAtm * 0.3
    : 270 + warmthFromAtm
}
