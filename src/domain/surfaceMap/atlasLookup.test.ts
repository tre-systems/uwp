import { describe, expect, it } from 'vitest'
import { iterFaceSubCells } from '../icosahedron'
import {
  buildSurfaceAtlasLookup,
  surfaceAtlasCellAtNetPoint,
  type SurfaceAtlas,
  type SurfaceAtlasCell,
  type SurfaceCellId,
} from './index'

describe('surface atlas lookup', () => {
  it('maps flat-net sub-cell centres back to their atlas ids without scanning', () => {
    const resolution = 4
    const cells = [...iterFaceSubCells(resolution)].map((cell): SurfaceAtlasCell => {
      const id: SurfaceCellId = {
        face: cell.faceIdx,
        i: cell.i,
        j: cell.j,
        up: cell.subUp,
        resolution,
      }
      return {
        id,
        coord: { col: cell.i, row: cell.j },
        x: cell.flat.x,
        y: cell.flat.y,
        latitude_deg: 0,
        longitude_deg: 0,
        elevation: 0,
        elevation_signed: 0,
        water_depth: 0,
        slope: 0,
        moisture: 0,
        temperature_k: 288,
        biome_id: 3,
        terrain: 'Plain',
        flat_boundary: [],
      }
    })
    const atlas: SurfaceAtlas = {
      resolution,
      hex_radius: 1,
      net_width: 1,
      net_height: 1,
      sea_level_threshold: 0,
      cells,
    }
    const lookup = buildSurfaceAtlasLookup(atlas)

    for (const cell of cells) {
      expect(surfaceAtlasCellAtNetPoint(atlas, lookup, cell.x, cell.y)?.id).toEqual(cell.id)
    }
  })
})
