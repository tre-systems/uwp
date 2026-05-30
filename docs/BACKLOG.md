# Active Backlog

This is the sequential work list for turning UWP into the core system tool for
online Cepheus Engine play.

## Product Goals

- Implement Chapter 12, "Worlds", from the Cepheus Engine SRD as the game-facing
  rules layer: UWP, subsector star mapping, trade codes, bases, travel zones,
  allegiance, PBG, communication routes, and trade routes.
- Present an attractive, functional sector map inspired by classic 2d6 sector
  maps, but tuned for this app: a full 32×40 sector of 16 lettered subsectors
  (A–P), with a subsector view that frames one A–P block so referees can see
  local context and cross-border routes without jumping between screens.
- Keep generated solar systems coherent with modern astronomy and planetary
  science, while nodding to classic survey-generation rules through familiar
  concepts such as star classes, orbital placement, gas giants, belts, worlds,
  and survey-style system data.
- Use Rust for work that benefits from Rust: deterministic simulation,
  numerically testable system generation, climate/surface computation, GPU data
  preparation, and contracts that should not drift silently.
- Produce excellent, photorealistic planet views and useful planetary surface
  maps that agree with each other.
- Grow toward an online play foundation: shareable systems, campaign-ready
  sectors, referee overrides, player-safe exports, and eventually collaborative
  sessions.

## Sequencing Rules

- Keep the app shippable after every chunk. Each step should end with local
  verification passing.
- Do not fork Cepheus rules into several places. The game-facing projection
  should have one domain home and tests.
- Rust owns physical simulation and expensive derived data. TypeScript owns UI,
  app state, interaction flow, and lightweight map presentation.
- Prefer continuous physical/social values internally, then round or bucket them
  into UWP codes for Cepheus compatibility.
- Avoid speculative rewrites. Move boundaries when the next product feature
  needs them.

## Sequential Tasks

### 1. Land The Current Review Fixes

Status: complete (foundational quality fixes long landed; kept for history).

Commit the current quality fixes before starting larger work:

- system-picking coordinate scaling under capped render profiles,
- render-loop error status handling,
- surface-focus app-state synchronization,
- hiding misleading Surface-mode export controls,
- `SurfaceMap` using its prop instead of reaching directly into global state.

Done when:

- `npm run verify` passes,
- the branch is clean except for intentional backlog/docs updates,
- CI is green after push.

### 2. Build A Chapter 12 Rules Coverage Matrix

Status: complete. The matrix lives in `docs/CEPHEUS_CHAPTER_12.md`.

Create a testable matrix for every Chapter 12 rule the app supports or has not
yet implemented:

- UWP fields and pseudo-hex formatting,
- star mapping and occupancy density,
- world size, atmosphere, hydrographics, population, starport, government, law,
  and technology projections,
- trade codes,
- planetoid belts, gas giants, bases, travel zones, allegiance, PBG,
  communication routes, and trade routes.

Done when:

- `docs/CEPHEUS_CHAPTER_12.md` lists each rule, its implementation status, and
  the code/test location,
- missing or approximate rules have explicit follow-up tasks,
- tests cover the rules that are already marked implemented.

### 3. Harden UWP Projection From Continuous Models

Make the continuous-to-UWP layer the canonical bridge between science and
Cepheus rules.

Status: in progress. The PBG subtask is Rust-owned: subsector hexes carry an
actual population estimate plus a serialized PBG triple derived from that
population, asteroid-belt count, and gas/ice-giant count. The projection
hardening pass is also in place: Rust table helpers now pin size / atmosphere /
hydrographics SRD percentage buckets, starport adjusted-roll thresholds,
government/law zero-world rules, population cap `A`, and tech-level
DMs/minimums including Government 7. TypeScript projection now uses Cepheus
hydrographics buckets, lower-bound population exponents capped at `A`,
non-finite input guards, and direct-UWP reconciliation before product UI/export
paths consume the UWP snapshot.

- Audit every UWP field to confirm the app stores richer values where useful and
  only rounds at the UWP boundary.
- Add edge-case tests for remaining rounding thresholds, impossible
  combinations, and referee-entered UWP reconciliation as new invariants land.
- Ensure population modifier/PBG can be derived from actual population, belt
  count, and gas-giant count.

Done when:

- no product UI treats integer UWP digits as the only editable source of truth,
- UWP projection tests cover representative low, normal, extreme, and invalid
  worlds,
- PBG is generated from the physical system rather than invented separately.

### 4. Standard Subsector / Sector Dimensions + Data Interop

Status: shipped. The map now uses standard Cepheus dimensions end to end —
8×10 lettered subsectors (A–P) tiling a full 32×40 sector. Rust generates the
whole 32×40 grid once (`generate_sector`), serializes per-subsector metadata,
and the SVG map / export / editor read the serialized `columns` / `rows`
instead of assuming 80 or 160 hexes. The "subsector view" is a viewport framing
of the one sector grid (A–P quick-jump + focus), so cross-subsector routes and
polity borders work without special-casing a seam. (This supersedes the earlier
16×10 two-subsector-strip target.)

Data interop shipped alongside:

- **Import** pasted sector data — auto-detects T5SS tab-delimited and classic
  `.sec` column formats, tolerant per-line parsing with error reporting, builds
  an 8×10 or 32×40 grid from the hex spread, synthesizes allegiances and
  per-world system seeds.
- **Export** canonical T5SS tab-delimited, round-trip tested
  (`text → import → export` and `subsector → export → import → deep-equal`).
- A real extended-hex (ehex) UWP parser (0–9, A–H, J–N, P–Z) backs both paths.
  Format reference: `docs/sector-data-format.md`.

Map performance + navigation for the larger grid:

- LOD + viewport culling: text/glyphs gate behind zoom, only-visible hexes
  render, so a 1280-hex sector overview stays light (~7k SVG nodes vs ~11k).
- A–P quick-jump bar + collapsible legend; an animated spinner covers
  first-load generation while the worker builds the grid off the main thread.

Map UX shipped on top of this: a "Load sample" button + format hint for import,
a determinate "Generating sector… NN%" spinner, and imported-sector names
carried into the title/header/export. (A copyable share link already exists via
the Share action.) Deferred: true subsector-first progressive generation — it
would pop polity colours/routes when the full grid swaps in, and the map-pass
generation is already lean, so the progress spinner covers the wait instead.

### 5. Complete Chapter 12 Map Semantics

Fill in the remaining referee-facing map data so the map is useful at the table.

Status: in progress. Route semantics v2 is implemented: Rust keeps the
navigation `jump_routes` graph and annotates each edge with selective
communication-route and trade-route metadata plus a trade score. The courier
net now uses a stricter threshold than raw jump connectivity, with a generated
route-density regression test so future tuning remains map-readable instead of
drifting by feel. Polity
semantics v2 is implemented: Rust generates two regional polities plus a neutral
border band as a full 16 x 10 `polity_cells` territory layer, snaps capitals to
occupied controlled worlds when possible, and copies occupied-world allegiance
from that layer. The SVG now lightly tints empty territory, draws continuous
borders across empty hexes, and marks polity capitals; the selected-hex
inspector and text export show occupied-world counts beside claimed territory
counts. The selected-hex inspector now also shows the Chapter 12 PBG triple plus
the generated actual-population estimate behind it. Referee override hooks v1
are implemented for selected-hex travel zone,
allegiance, bases, route visibility, and route communication/trade metadata;
overrides are stored as local deltas keyed by subsector seed plus generated
hex/route endpoint seeds, then applied as a TypeScript overlay so generated Rust
data remains resettable. Route-policy thresholds now have focused Rust tests for
red-zone blocking, jump-2 communication penalties, trade-promoted courier links,
trade-score clamping, and average route-density bands.

- Continue tuning communication routes separately from trade routes after more
  table-map examples are reviewed in play.
- Surface any remaining Chapter 12 data in exports and inspector panels without
  cluttering the main map.

Done when:

- a referee can inspect every occupied hex and understand its UWP, bases, trade
  codes, zone, PBG, allegiance, and route context,
- travel zone, base, allegiance, and route overrides survive regeneration where
  appropriate,
- text export includes the same map facts the UI shows.

### 6. Strengthen Survey-Style System Detail

Use classic survey-style system detail as inspiration for deeper system surveys
while keeping modern science as the source of truth.

- Expand star and companion generation outputs: spectral class, luminosity,
  age, habitable zone, snow line, stability notes, and survey-style descriptors.
- Improve orbital architecture for resonances, belts, moon systems, and gas
  giant placement.
- Add "survey summary" panels that explain why the generated system is
  plausible and game-useful.

Done when:

- generated systems feel like survey records, not just render targets,
- tests pin scientific invariants and deterministic outputs,
- the UI explains relevant physical context without overwhelming play.

### 7. Move Surface Pre-Bake Onto The GPU Render Path

Make the photorealistic globe and the surface map sample the same Rust-generated
surface data.

Status: in progress. The main-world globe now samples a GPU texture generated
from the Rust surface pre-bake instead of running an independent continent
noise stack. Hydrographics is treated as the authored target water fraction,
and the shader receives both the raw height atlas and a quantile-derived sea
threshold so the globe's waterline follows the same semantics as the world map
and region views. The shared atlas has been raised to 1024 x 512, with
centre-aligned sampling in Rust, WGSL, and TypeScript so the globe and surface
map avoid blocky/jagged coastline drift. Plate baseline elevation is now
smoothed across neighboring plates so continent edges are less geometric.
The first eager integration made world edits sluggish, so the current rule is
that expensive surface generation must be shared and lazy: the Rust pre-bake
caches the latest seed/water pair, the JS preview path caches the normalized
heightmap and sea threshold, and hidden Surface views do not regenerate maps on
every slider movement.

- Follow the surface-coherence target in `docs/RENDERING.md`: one Rust-owned
  surface atlas drives the globe, world map, inspector, region view, and
  exports.
- Upload the Rust surface pre-bake as a GPU texture or cube-map.
- Replace the planet shader's independent continent/noise stack with texture
  sampling from the authoritative pre-bake. *(v1 shipped for coastline /
  elevation alignment.)*
- Keep shader quality profiles, mobile fallbacks, and render-target scaling
  intact.
- Do not run the full surface map/pre-bake path from hidden UI. Surface data
  should refresh when entering Surface or when controls change while Surface is
  visible.

Done when:

- the globe and surface map agree on coastlines and major terrain,
- double-clicking a visual surface hex opens a region view seeded from that
  exact clicked cell's terrain, latitude, temperature, and elevation,
- fragment shader cost drops measurably on mobile,
- visual quality is equal or better than the current shader-only planet.

### 8. Push Planet Rendering Toward Photorealism

Improve the main-world render once the pre-bake is authoritative.

Status: in progress, and the most recent quality pass landed here. Body-detail
v1 routes any focused body into the detail renderer: planets map from physical
body type + climate into renderer params; gas giants / ice giants / mini-Neptunes
use fluid submodes; stars use an emissive photosphere shader; asteroid belts open
a representative cratered planetoid. Terrain-atlas worlds use the Rust surface
pre-bake; non-terrain bodies skip the atlas rebuild. Very cold rocky / super-Earth
bodies render as low-atmosphere icy / cratered worlds, not blue ocean worlds.
Reference imagery the body-class shaders are tuned against:
`docs/RENDERING.md` › Reference imagery. Specific optional gaps: a physically
based atmosphere LUT, advected gas-giant flow (storms shearing into jets),
denser asteroid silhouette geometry, and palette calibration against sampled
NASA/JPL reference histograms.

Latest pass, shipped:

- **ULTRA quality tier above HIGH** for capable desktop GPUs (discrete or Apple
  Silicon, detected via a WebGPU adapter-limits probe). It supersamples ~1.75×
  device pixels (shader-aware anti-aliasing, capped by a pixel budget so large
  windows don't overrun the GPU) and drives the atmosphere's finer 18/6 raymarch;
  the frame-time downshifter drops it back to HIGH if a device can't hold it, so
  it fails closed to current behaviour.
- **Radiant stars** — a centre-weighted hot core lifts the photosphere out of a
  matte disc and drives the post-pass bloom into a corona.
- **Visual-state fix** — a planet no longer inherits a previously-viewed
  star / belt's params (which had rendered an ocean world as a star-ball).
- **Manual QA sweep** — every body class reads cleanly with no artifacts:
  ocean / desert / vacuum worlds, gas giants, ice giants / mini-Neptunes, stars
  (incl. binary), asteroid belts, and night-side city lights.

Research anchors for any further visual pass:

- Bruneton/Neyret-style precomputed atmospheric scattering remains the right
  reference for physically grounded air and haze:
  https://ebruneton.github.io/precomputed_atmospheric_scattering/
- Hillaire's production atmosphere work is the practical target for scalable
  multi-scatter sky / aerial perspective:
  https://diglib.eg.org/items/8a3e5350-18b3-46bd-9274-3add5af88c75
- NASA / JPL public imagery should guide colour and morphology checks for
  rocky worlds, Mars-like deserts, icy bodies, gas giants, and solar views:
  https://eyes.nasa.gov/

Remaining:

- **Lock the rendering quality in with visual-regression screenshots** per body
  class (main-world terrain, hot rocky, cold super-Earth, gas giant, ice giant,
  mini-Neptune, star, asteroid). This is the key gap — the QA above is manual, so
  a future shader change could silently regress it.
- *(Done)* profile-aware quality paths: ULTRA / HIGH / BALANCED / LOW / MINIMUM,
  with ULTRA above HIGH and a frame-time downshifter that fails closed.
- *(Good per QA — optional polish)* further atmosphere multi-scatter, cloud
  shaping, ocean glint, and terrain-normal refinement against reference imagery.

Done when:

- ULTRA / High render visibly premium on capable hardware; Balanced / Low /
  Minimum stay interactive and legible on phones,
- every body class is covered by a visual-regression screenshot, so rendering
  changes can't silently regress.

### 9. Upgrade Planetary Surface Maps

Make surface maps useful as play artifacts, not just inspection widgets.

Status: in progress. The visible icosahedral net now uses Rust-owned
12-subdivision atlas cells with stable `SurfaceCellId`s, exact lat/lon
centres, flat boundaries, terrain, biome, moisture, temperature, slope, and
water-depth summaries. Starports and cities store atlas ids and snap to atlas
cell centres. The pre-bake backdrop remains an adaptive high-resolution raster
behind the SVG cells. Region detail now samples the selected atlas cell plus
nearby atlas cells and the atlas sea-level threshold for its base terrain, so
local shorelines and biome transitions are tied to the same physical surface as
the globe and world map.

- Replace rounded 32 x 16 surface coordinates with stable surface-cell ids from
  the Rust atlas. *(v1 shipped; 32 x 16 remains as compatibility metadata.)*
- Add climate/biome overlays: temperature bands, precipitation when available,
  terrain, habitability, settlement density, and travel hazards.
- Add surface-map export that captures the visible SVG/map, not the hidden
  WebGPU canvas.
- Add region-level generation for selected hexes: local terrain, settlements,
  hazards, and adventure hooks. *(v1 atlas-aligned terrain shipped; remaining
  work is gameplay content such as hazards/adventure hooks and richer
  Rust-owned local detail channels.)*

Done when:

- Surface mode has its own export path,
- selected hexes can produce referee-ready local details,
- map overlays are readable and performant on mobile.

### 10. Add Rust-Heavy Simulation Extensions

Prioritize Rust work that would be awkward, slow, or fragile in TypeScript.

- Climate extension: precipitation bands, ocean heat capacity, seasonal
  extremes, and biome classification.
- Tectonics extension: erosion, plate history, mountain/rift ageing, and river
  candidates.
- Route economics: trade-route strength from population, tech, distance,
  starport quality, and resource compatibility.
- Deterministic campaign-scale generation: subsector, quadrant, and sector
  seeds without loading every full system eagerly.

Done when:

- each extension has Rust unit tests and serialized DTO tests,
- TypeScript only requests snapshots and renders them,
- compute cost is measured and acceptable.

### 11. Build Online Play Foundations

Prepare the app to become the core for playing Cepheus Engine games online.

Status: in progress. Stable share URLs are live — the Share action copies a deep
link whose hash encodes sector / subsector / system / world / surface state plus
referee overrides, and the app restores it on load. Remaining: a campaign
document model, player-safe exports, and the sync boundary.

- Add stable share URLs for sectors, subsectors, selected systems, worlds, and
  surface hexes. *(shipped)*
- Define a campaign document model for referee overrides and saved discoveries.
- Add player-safe exports that hide referee-only notes.
- Design the sync boundary for future collaborative sessions.

Done when:

- a referee can share a stable generated region with players,
- overrides are represented as data rather than local UI accidents,
- the model can later move to hosted persistence without reworking generation.

### 12. Documentation And Quality Gates

Keep the project easy for agents and humans to extend.

Status: in progress. `docs/` now holds focused docs — `BACKLOG.md`,
`ARCHITECTURE.md` (layer/boundary map + diagram), `RENDERING.md`,
`CEPHEUS_CHAPTER_12.md`, `sector-data-format.md` —
and `AGENTS.md` links to them. Remaining: slim the overlapping
architecture/refactor-history prose out of `AGENTS.md` now that
`ARCHITECTURE.md` is the canonical home.

- Split large roadmap material out of `AGENTS.md` into focused docs under
  `docs/`. *(BACKLOG + ARCHITECTURE extracted; refactor-history prose still in
  AGENTS.md.)*
- Keep `AGENTS.md` as concise operating guidance and link to this backlog.
- Add architecture diagrams for domain, app state, renderer client, Rust
  renderer, and WASM boundaries.
- Keep pre-commit fast and pre-push comprehensive.

Done when:

- new contributors can find the current task list in one file,
- architectural decisions have clear homes,
- CI and local hooks catch regressions before deployment.

## Current Best Next Chunk

With standard sector dimensions, data import/export, map performance, a copyable
share link, and a hardware-scaled rendering + star-polish pass all shipped — the
renderer is now QA-verified photorealistic across every body class — the best
next chunks are:

1. **Lock in the rendering quality (task 8).** Add per-body-class
   visual-regression screenshots so the just-shipped polish (ULTRA tier, radiant
   stars, every body class) can't silently regress — turn the manual QA sweep
   into an automated guard. Contained, high-leverage, and it protects the work
   just banked.
2. **Campaign persistence / player-safe exports (task 11).** The biggest
   strategic step toward online play: share links are live, so the next move is a
   saved campaign / override document model and player-safe exports that hide
   referee-only notes.
3. **Surface-map export (task 9).** A Surface-mode export path so the planetary
   hex map is a shareable play artifact, not just an inspector.

This keeps the product goal — a referee tool for online Cepheus play — visible:
consolidate the rendering investment (1), then advance toward shared,
campaign-ready play (2–3).
