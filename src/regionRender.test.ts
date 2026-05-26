import { describe, expect, it } from 'vitest'
import type { SurfaceAtlas, SurfaceAtlasCell, SurfaceCellId, SurfaceHex } from './domain/surfaceMap'
import { buildRegionHeightmapForTest } from './regionRender'

describe('region atlas sampling', () => {
  it('anchors the selected region to the same atlas cell used by the world map', () => {
    const selectedId: SurfaceCellId = { face: 2, i: 4, j: 3, up: true, resolution: 12 }
    const atlas = fakeAtlas(selectedId)
    const hex: SurfaceHex = {
      coord: { col: 12, row: 7 },
      cell_id: selectedId,
      terrain: 'Plain',
      latitude_deg: 5,
      longitude_deg: 10,
      temperature_k: 288,
      elevation: 0.62,
    }

    const map = buildRegionHeightmapForTest({
      hex,
      worldSeed: 123,
      authoredHydroFraction: 0.55,
      width: 760,
      height: 600,
      atlas,
      selectedCellId: selectedId,
    })

    const mid = Math.floor(map.height / 2) * map.width + Math.floor(map.width / 2)
    expect(map.data[mid]).toBeCloseTo(0.24, 6)
    expect(map.biome?.[mid]).toBe(3)
    expect(map.temperatureK?.[mid]).toBe(288)
  })

  it('pulls neighbouring atlas terrain into the local detail frame', () => {
    const selectedId: SurfaceCellId = { face: 2, i: 4, j: 3, up: true, resolution: 12 }
    const atlas = fakeAtlas(selectedId)
    const hex: SurfaceHex = {
      coord: { col: 12, row: 7 },
      cell_id: selectedId,
      terrain: 'Shoreline',
      latitude_deg: 5,
      longitude_deg: 10,
      temperature_k: 288,
      elevation: 0.62,
    }

    const map = buildRegionHeightmapForTest({
      hex,
      worldSeed: 123,
      authoredHydroFraction: 0.55,
      width: 760,
      height: 600,
      atlas,
      selectedCellId: selectedId,
    })

    const row = Math.floor(map.height / 2)
    const west = row * map.width + 2
    const east = row * map.width + map.width - 3

    expect(map.data[west]).toBeLessThan(0)
    expect(map.data[east]).toBeGreaterThan(map.data[west])
    expect(map.biome?.[west]).toBe(0)
    expect(map.biome?.[east]).toBe(9)
  })
})

function fakeAtlas(selectedId: SurfaceCellId): SurfaceAtlas {
  const radius = 10
  return {
    resolution: 12,
    hex_radius: radius,
    net_width: 1100,
    net_height: 520,
    sea_level_threshold: 0,
    cells: [
      fakeCell(selectedId, 0, 0, 0.24, 3, 'Plain'),
      fakeCell({ ...selectedId, i: 5 }, radius * 1.8, 0, 0.72, 9, 'Mountain'),
      fakeCell({ ...selectedId, i: 3 }, -radius * 1.8, 0, -0.44, 0, 'Ocean'),
      fakeCell({ ...selectedId, j: 4 }, 0, radius * 1.6, 0.16, 5, 'Forest'),
      fakeCell({ ...selectedId, j: 2 }, 0, -radius * 1.6, 0.05, 2, 'Shoreline'),
    ],
  }
}

function fakeCell(
  id: SurfaceCellId,
  x: number,
  y: number,
  elevationSigned: number,
  biomeId: number,
  terrain: SurfaceAtlasCell['terrain'],
): SurfaceAtlasCell {
  return {
    id,
    coord: { col: 12, row: 7 },
    x,
    y,
    latitude_deg: 5,
    longitude_deg: 10,
    elevation: elevationSigned * 0.5 + 0.5,
    elevation_signed: elevationSigned,
    water_depth: Math.max(0, -elevationSigned),
    slope: 0.1,
    moisture: 0.5,
    temperature_k: 288,
    biome_id: biomeId,
    terrain,
    flat_boundary: [],
  }
}
