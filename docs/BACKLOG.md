# Active Backlog

This is the sequential work list for turning UWP into the core system tool for
online Cepheus Engine play.

## Product Goals

- Implement Chapter 12, "Worlds", from the Cepheus Engine SRD as the game-facing
  rules layer: UWP, subsector star mapping, trade codes, bases, travel zones,
  allegiance, PBG, communication routes, and trade routes.
- Present an attractive, functional subsector map inspired by legacy 2d6 Map, but
  tuned for this app. The near-term target is a two-subsector-wide map
  (16 columns by 10 rows) so referees can see local context and cross-border
  routes without jumping between screens.
- Keep generated solar systems coherent with modern astronomy and planetary
  science, while nodding to Classic legacy 2d6 survey rules: Scouts through familiar
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
population, asteroid-belt count, and gas/ice-giant count. The first projection
hardening pass is also in place: Rust table helpers now pin size / atmosphere /
hydrographics consistency, starport adjusted-roll thresholds, government/law
zero-world rules, and tech-level DMs/minimums; TypeScript projection now uses
Cepheus hydrographics buckets and lower-bound population exponents.

- Audit every UWP field to confirm the app stores richer values where useful and
  only rounds at the UWP boundary.
- Add edge-case tests for rounding thresholds, impossible combinations, and
  referee-entered UWP reconciliation.
- Ensure population modifier/PBG can be derived from actual population, belt
  count, and gas-giant count.

Done when:

- no product UI treats integer UWP digits as the only editable source of truth,
- UWP projection tests cover representative low, normal, extreme, and invalid
  worlds,
- PBG is generated from the physical system rather than invented separately.

### 4. Upgrade The Map To A Two-Subsector Strip

Extend the current 8×10 subsector view into a 16×10 two-subsector-wide map.

- Generate, store, and render two adjacent subsectors as one local play region.
- Preserve individual subsector identity while allowing routes and borders to
  cross the seam.
- Keep the map visually close to legacy 2d6 Map conventions: legible hexes,
  world dots, starports, bases, zones, names, routes, and allegiance cues.
- Make mobile panning/zooming and desktop hover/click comfortable at the larger
  map size.

Done when:

- the map shows 16 columns by 10 rows with stable deterministic generation,
- cross-subsector jump routes work,
- selected hex navigation still loads the correct system,
- Playwright smoke covers map navigation at desktop and mobile widths.

### 5. Complete Chapter 12 Map Semantics

Fill in the remaining referee-facing map data so the map is useful at the table.

- Add or refine communication routes separately from trade routes.
- Improve allegiance and polity borders beyond a single allegiance label.
- Add referee override hooks for travel zones, allegiance, bases, and routes.
- Surface Chapter 12 data in exports and inspector panels without cluttering the
  main map.

Done when:

- a referee can inspect every occupied hex and understand its UWP, bases, trade
  codes, zone, PBG, allegiance, and route context,
- overrides survive regeneration where appropriate,
- text export includes the same map facts the UI shows.

### 6. Strengthen survey rules Style System Detail

Use survey rules: Scouts as inspiration for deeper system surveys while keeping modern
science as the source of truth.

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
and region views.

- Follow the alignment target in `docs/SURFACE_ALIGNMENT.md`: one Rust-owned
  surface atlas should drive the globe, world map, inspector, region view, and
  exports.
- Upload the Rust surface pre-bake as a GPU texture or cube-map.
- Replace the planet shader's independent continent/noise stack with texture
  sampling from the authoritative pre-bake. *(v1 shipped for coastline /
  elevation alignment.)*
- Keep shader quality profiles, mobile fallbacks, and render-target scaling
  intact.

Done when:

- the globe and surface map agree on coastlines and major terrain,
- double-clicking a visual surface hex opens a region view seeded from that
  exact clicked cell's terrain, latitude, temperature, and elevation,
- fragment shader cost drops measurably on mobile,
- visual quality is equal or better than the current shader-only planet.

### 8. Push Planet Rendering Toward Photorealism

Improve the main-world render once the pre-bake is authoritative.

- Refine atmosphere, clouds, ocean glint, terrain normals, city lights, ice,
  night side, and star lighting.
- Add profile-aware quality paths so High looks excellent and Low remains usable
  on iPhone-class devices.
- Add visual regression screenshots for representative worlds.

Done when:

- High mode is visibly premium,
- Balanced targets browser refresh cadence on common laptops and phones,
- Low remains interactive and legible,
- city lights and night-side detail are verified in smoke or visual tests.

### 9. Upgrade Planetary Surface Maps

Make surface maps useful as play artifacts, not just inspection widgets.

- Replace rounded 32 x 16 surface coordinates with stable surface-cell ids from
  the Rust atlas.
- Add climate/biome overlays: temperature bands, precipitation when available,
  terrain, habitability, settlement density, and travel hazards.
- Add surface-map export that captures the visible SVG/map, not the hidden
  WebGPU canvas.
- Add region-level generation for selected hexes: local terrain, settlements,
  hazards, and adventure hooks.

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
- Deterministic campaign-scale generation: two-subsector, quadrant, and sector
  seeds without loading every full system eagerly.

Done when:

- each extension has Rust unit tests and serialized DTO tests,
- TypeScript only requests snapshots and renders them,
- compute cost is measured and acceptable.

### 11. Build Online Play Foundations

Prepare the app to become the core for playing Cepheus Engine games online.

- Add stable share URLs for two-subsector regions, selected systems, worlds, and
  surface hexes.
- Define a campaign document model for referee overrides and saved discoveries.
- Add player-safe exports that hide referee-only notes.
- Design the sync boundary for future collaborative sessions.

Done when:

- a referee can share a stable generated region with players,
- overrides are represented as data rather than local UI accidents,
- the model can later move to hosted persistence without reworking generation.

### 12. Documentation And Quality Gates

Keep the project easy for agents and humans to extend.

- Split large roadmap material out of `AGENTS.md` into focused docs under
  `docs/`.
- Keep `AGENTS.md` as concise operating guidance and link to this backlog.
- Add architecture diagrams for domain, app state, renderer client, Rust
  renderer, and WASM boundaries.
- Keep pre-commit fast and pre-push comprehensive.

Done when:

- new contributors can find the current task list in one file,
- architectural decisions have clear homes,
- CI and local hooks catch regressions before deployment.

## Current Best Next Chunk

After the Chapter 12 matrix, the best next implementation chunk is:

1. Harden UWP projection from continuous models.
2. Add focused Rust tests for remaining UWP projection table shapes: atmosphere,
   starport, government, law, and tech.
3. Start the two-subsector strip data model and rendering spike behind existing
   map boundaries once the projection/PBG contract is firmer.

This keeps the product goal visible while preparing the codebase for the larger
map and online-play work.
