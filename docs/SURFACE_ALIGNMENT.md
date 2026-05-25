# Surface Alignment Review

The globe, icosahedral world map, and selected-hex region view should all
describe the same physical surface. The globe and world map now share the
Rust surface pre-bake for coastlines and major terrain; the remaining work is
to replace coarse logical surface cells with a Rust-owned atlas of stable cell
ids and to make region views sample local atlas patches.

## Research Notes

- Modern spherical hex systems are usually discrete global grid systems (DGGS)
  built on an icosahedron, not a flat SVG grid later projected onto a globe.
  H3 is the best-known production example: it lays a hexagonal hierarchy over
  the icosahedron and accepts twelve pentagons because a sphere cannot be tiled
  by hexagons alone.
- ISEA / Snyder Equal Area grids solve a related problem by defining
  equal-area cells through an icosahedral projection. This is a better mental
  model for us than an equirectangular raster if we want map cells, globe
  pixels, and local regions to agree.
- legacy 2d6-style world maps are visually an unfolded icosahedron with
  pointy-top hexes clipped by the triangular faces. That is a good UI target,
  but the data still needs a stable spherical cell id under it.

References:

- <https://h3geo.org/docs/3.x/core-library/overview/>
- <https://www.uber.com/en-US/blog/h3/>
- <https://proj.org/en/stable/operations/projections/isea.html>
- <https://discreteglobalgrids.org/wp-content/uploads/2019/05/dggridManualV64.pdf>
- <https://www.profantasy.com/products/cos3-world-map.asp>

## Current State

- The main-world globe uploads the Rust surface pre-bake as a GPU texture and
  samples it in `planet.wgsl` for elevation, coastline, and waterline decisions.
- Rust already computes a surface pre-bake heightmap, and the SVG world-map
  background samples that same pre-bake through the icosahedral net. The
  current bake is 1024 x 512 and all three samplers use centre-aligned bilinear
  lookup so texel centres match the cells Rust generated.
- Plate baseline elevation is blended between the two nearest plates at
  boundaries, so continental/oceanic transitions no longer become hard
  Voronoi-edge coastlines.
- Hydrographics is treated as the authored target ocean fraction. The globe
  receives the raw height atlas plus the same quantile-derived sea threshold
  used by the map's sea-level pass.
- The visible world-map grid is now a pointy-top hex lattice clipped by the
  20 faces of the net, using 12 subdivisions per face over an adaptive
  high-resolution raster background.
- Starports and cities are now snapped to the centre of the visible surface
  hexes, so markers no longer float between cells.
- The surface inspector still exposes the older 32 x 16 `SurfaceMap` DTO
  coordinates, but clicks from the icosahedral map now carry the exact visual
  cell's latitude, longitude, terrain, temperature, and elevation into the
  region view.

## Alignment Risks

1. **Globe versus map detail.** The globe and map now share the pre-bake, but
   the GPU path samples the raw height atlas at shader resolution while the map
   samples it through coarser icosahedral cells. Coastlines and major terrain
   should agree more closely after the centre-aligned sampling pass; biome
   colouring and small-scale detail can still drift.
2. **Visual hexes versus logical cells.** The current pointy-top cells are
   generated in TypeScript from the net. The clicked cell now drives the
   region view directly, but the cells are not yet Rust-owned canonical ids.
3. **Region view versus selected map cell.** The region renderer receives the
   clicked visual cell's terrain/elevation summary, but it still paints a
   procedural local landscape rather than a patch sampled from the same
   authoritative surface buffer.
4. **Photorealism at every level.** The globe, atlas, and region view should
   use different rendering techniques, but they should share elevation,
   waterline, biome, climate, settlement, and lighting inputs.

## Target Architecture

Introduce a Rust-owned `SurfaceAtlas` that is generated with the planet:

- `SurfaceCellId`: stable id containing face, cell coordinates, and resolution.
- `SurfaceCell`: centre latitude/longitude, spherical boundary vertices, flat
  net vertices, elevation, water depth, biome, climate bands, habitability,
  hazards, settlement score, and optional features.
- `SurfaceAtlas`: all visible world-map cells plus summary textures/buffers for
  the renderer.

Every layer should consume this atlas:

- **Globe:** upload the pre-bake / atlas buffers to the GPU and sample them in
  `planet.wgsl` for land/ocean/coastline/biome decisions. The v1 GPU upload is
  in place for elevation and coastlines; biome and atlas-cell metadata remain.
- **World map:** render cells from serialized Rust `SurfaceCell` centres and
  boundaries; no TypeScript-only geometry decisions beyond presentation.
- **Inspector:** select by `SurfaceCellId`, not by rounded latitude/longitude.
- **Region view:** generate local terrain from the selected cell's atlas patch
  and nearby cells, so rivers, coastlines, cities, and hazards match the world
  map.
- **Exports:** use the same atlas state for globe cards, world-map exports, and
  referee region handouts.

## Implementation Sequence

1. Move pointy-top surface-cell generation from TypeScript into Rust as a
   serialized atlas with stable ids and cell centres.
2. Replace the 32 x 16 `SurfaceMap` DTO with an atlas-backed DTO while keeping
   compatibility helpers for existing inspector code during the transition.
3. Update `SurfaceMap.tsx` to render Rust-provided cells and select by
   `SurfaceCellId`.
4. Update starport and city placement to store `SurfaceCellId` directly.
5. Upload the Rust pre-bake to the GPU and make `planet.wgsl` sample it, so the
   globe and atlas agree on coastlines and major terrain. **v1 shipped for the
   existing pre-bake heightmap; extend it when the Rust atlas lands.**
6. Rework `RegionView` to generate from the selected cell and neighboring atlas
   cells rather than a standalone FBM landscape.
7. Add contract tests:
   - same seed + water fraction produces deterministic atlas ids and terrain,
   - settlement ids always refer to valid cells,
   - selected-cell centre projects to the rendered map centre,
   - atlas sampling and shader CPU-reference sampling agree at representative
     points.
8. Add visual regression screenshots for globe, world map, selected region, and
   export views for the same seed.

This is the path that makes the app feel scientifically coherent rather than
just visually similar across levels.
