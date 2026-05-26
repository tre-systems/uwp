# Surface Alignment Review

The globe, icosahedral world map, and selected-hex region view should all
describe the same physical surface. The globe and world map now share the
Rust surface pre-bake for coastlines, major terrain, and biome classification,
and the visible world-map cells are Rust-owned atlas cells with stable ids.
The selected-hex region view now uses the selected atlas cell plus neighbouring
atlas cells as its low-frequency terrain and biome source, then adds local
high-frequency detail as visual garnish.

## Current Performance Correction

The first fully shared pre-bake pass proved too eager: changing world controls
could regenerate the 1024 x 512 Rust heightmap through the renderer, the hidden
surface map, and the JS preview path even when the user was not looking at the
Surface view. The app now treats surface-map generation as a visible/lazy path:

- `surface_prebake::generate` caches the latest `(seed, water)` bake so the
  renderer atlas, Rust surface map, and JS preview can share one computation.
- `RendererClient` caches the normalized JS preview bake and its sea-level
  threshold.
- `SurfaceMap` requests the preview bake once per seed/water setting, reuses it
  for grid classification and background rendering, and delays the raster
  background until after the tab can paint.
- Mobile and touch backgrounds use a smaller raster target; the hex grid stays
  vector/pickable.

This is the preferred near-term approach: keep Rust authoritative for the heavy
surface data, but do not eagerly run that work from every UI mutation. If the
surface still feels wrong after this pass, the next decision should be visual
model quality (palette/terrain algorithm), not more synchronous generation.

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
  coordinates for compatibility, but clicks from the icosahedral map now carry
  the exact visual cell id, latitude, longitude, terrain, temperature, and
  elevation into the region view.
- Region view samples the selected atlas neighbourhood and the atlas sea-level
  threshold for its local height field, so coastlines and neighbouring terrain
  enter the zoomed card from the same direction as on the world map.
- Dry hydro-0 worlds use a barren biome path with smaller polar caps and no
  highland snow override, matching Mars/Moon-style references more closely.
- The SVG background blends neighbouring biome colours and uses gentler
  dry-world/ocean hillshade so the map reads as shaded orbital terrain rather
  than hard categorical polygons.

## Alignment Risks

1. **Globe versus map detail.** The globe and map now share the pre-bake, but
   the GPU path samples the raw height atlas at shader resolution while the map
   samples it through coarser icosahedral cells. Coastlines and major terrain
   agree; very small shader-only cloud, grain, city-light, and normal-detail
   effects can still differ by design.
2. **Region view versus selected map cell.** The region renderer now samples the
   selected atlas neighbourhood for its base terrain, but high-frequency detail,
   rivers, and biome flourishes are still procedural per-card embellishments.
   They should stay visually subordinate to the atlas field.
3. **Photorealism at every level.** The globe, atlas, and region view should
   use different rendering techniques, but they should share elevation,
   waterline, biome, climate, settlement, and lighting inputs.

## Target Architecture

The first Rust-owned `SurfaceAtlas` slice now ships with `SurfaceMap`:

- `SurfaceCellId`: stable id containing face, cell coordinates, and resolution.
- `SurfaceCell`: centre latitude/longitude, flat net boundary, elevation,
  signed elevation, water depth, slope, moisture, temperature, biome, and
  projected terrain.
- `SurfaceAtlas`: all visible world-map cells at the current legacy 2d6-style
  12-subdivision resolution, serialized from Rust beside the compatibility
  32 x 16 grid.

The surface generator also has a v1 geomorphology pass inspired by the
references below: dry barren worlds get impact basins in the actual height
field, while wet vegetated worlds get a cheap drainage accumulation / valley
carving pass after tectonic uplift. This is not a full hydrology simulator, but
it moves the app away from pure noise while preserving the lazy cached
generation model.

Every layer should consume this atlas:

- **Globe:** upload the pre-bake / atlas buffers to the GPU and sample them in
  `planet.wgsl` for land/ocean/coastline/biome decisions. The v1 GPU upload is
  in place for elevation and biomes. Atlas-cell metadata is serialized for the
  Surface UI; richer GPU buffer upload remains conditional.
- **World map:** render cells from serialized Rust `SurfaceCell` centres and
  boundaries. TypeScript still presents the SVG but no longer owns the visible
  cell identities.
- **Inspector:** select by `SurfaceCellId` when available, with rounded
  latitude/longitude only as a legacy fallback.
- **Region view:** receives the selected atlas cell id, samples nearby atlas
  cells for base elevation/biome, and uses the atlas sea-level threshold for
  local shoreline decisions. The remaining work is to move more local detail
  channels (river candidates, hazards, settlement micro-position) into Rust
  when those become gameplay data.
- **Exports:** use the same atlas state for globe cards, world-map exports, and
  referee region handouts.

## Research Anchors

- NASA Blue Marble Next Generation is the visual reference for Earth-like
  colour relationships: ocean depth, vegetation belts, seasonal snow, and
  cloud-haze balance.
- NOAA ETOPO is the morphology reference for topography plus bathymetry and
  shoreline continuity.
- NASA MGS/MOLA Mars maps are the reference for dry, cratered, basin-heavy
  rocky worlds.
- OGC DGGS and H3 are the data-model references: spherical surface cells should
  have stable ids and explicit boundaries, not only screen-space SVG positions.
- Cordonnier et al. and Genevaux et al. are the procedural terrain references:
  large-scale terrain should combine tectonic uplift, drainage, and erosion
  instead of relying on FBM noise alone.

References:

- <https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/>
- <https://www.ncei.noaa.gov/products/etopo-global-relief-model>
- <https://science.nasa.gov/photojournal/mola-topographic-map>
- <https://www.ogc.org/standards/dggs/>
- <https://h3geo.org/docs/core-library/overview>
- <https://researchportal.ip-paris.fr/fr/publications/large-scale-terrain-generation-from-tectonic-uplift-and-fluvial-e/>
- <https://cgvlab.github.io/cgvlab/www/publications/Genevaux13ToG/>

## Implementation Sequence

1. **Shipped.** Move pointy-top surface-cell generation from TypeScript into
   Rust as a serialized atlas with stable ids and cell centres.
2. **Shipped.** Add the atlas beside the 32 x 16 `SurfaceMap` DTO while keeping
   compatibility helpers for existing inspector code during the transition.
3. **Shipped.** Update `SurfaceMap.tsx` to render Rust-provided cells and select
   by `SurfaceCellId`.
4. **Shipped.** Update starport and city placement to store `SurfaceCellId`
   directly and snap markers to atlas-cell centres.
5. **Shipped v1.** Upload the Rust pre-bake to the GPU and make `planet.wgsl`
   sample it, so the globe and atlas agree on coastlines and major terrain.
6. **Shipped.** Rework `RegionView` to generate from the selected cell and
   neighbouring atlas cells rather than a standalone FBM landscape.
7. Continue contract tests:
   - same seed + water fraction produces deterministic atlas ids and terrain,
   - settlement ids always refer to valid cells,
   - selected-cell centre projects to the rendered map centre,
   - atlas sampling and shader CPU-reference sampling agree at representative
     points.
8. Add visual regression screenshots for globe, world map, selected region, and
   export views for the same seed.

This is the path that makes the app feel scientifically coherent rather than
just visually similar across levels.
