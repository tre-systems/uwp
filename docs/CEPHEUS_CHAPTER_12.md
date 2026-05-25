# Cepheus SRD Chapter 12 Coverage

Source: <https://www.orffenspace.com/cepheus-srd/book3/worlds.html>

This matrix tracks the app's coverage of Chapter 12, "Worlds". It is the bridge
between Cepheus-compatible game data and the app's science-first generation
model. Mark a rule as implemented only when there is a code owner and a test or
explicit verification path.

## Status Key

- **Shipped**: implemented, user-visible or serialized, and covered by tests.
- **Partial**: usable v1 exists, but the SRD rule is simplified, projected from
  scientific data, or missing a known detail.
- **Open**: not implemented yet.
- **Deferred**: intentionally waiting on a later architecture or product need.

## Rule Coverage Matrix

| Chapter 12 area | Cepheus-facing expectation | Current app coverage | Status | Code / tests | Follow-up task |
| --- | --- | --- | --- | --- | --- |
| UWP code format | Starport, size, atmosphere, hydrographics, population, government, law, and tech render as a compact UWP such as `A867974-D`. | UWP parsing, formatting, pseudo-hex digits, field clamps, and continuous rounding are implemented. | Shipped | `src/uwp.ts`; `src/uwp.test.ts` | Keep this as the game-facing projection, not the canonical physical model. |
| Direct UWP entry | Referees can enter existing UWP values. | Direct UWP entry updates the visual/continuous parameter snapshot through mapping helpers; impossible tiny-world atmosphere/hydrographics values are reconciled to plausible visuals. | Shipped | `src/uwpVisualMapping.ts`; `src/uwpVisualMapping.test.ts`; `src/components/UwpCodeEditor.tsx` | Reconcile entered UWP with generated systems more deeply once authored-world invariants exist. |
| Continuous-to-UWP projection | Physical/social values should bucket into UWP digits without losing richer state. | Main-world helper projects radius, hydrographics, population, starport quality, government, law, and tech into UWP digits with SRD hydrographics buckets, lower-bound population exponents, and uninhabited-world constraints. | Partial | `src/domain/mainWorld/model.ts`; `src/domain/mainWorld/model.test.ts` | Move more invariants into Rust once authored-world state is Rust-owned. |
| Main-world selection | The main world belongs to the generated system. | Rust selects a main world from generated planets using climate habitability. | Shipped | `crates/planet-render/src/domain/system.rs`; `crates/planet-render/src/domain/climate.rs`; Rust tests in both modules | Add referee override/reconciliation later for supplied UWPs. |
| Subsector grid | A subsector is an 8 column by 10 row hex grid. | Rust subsector generator uses 8x10 constants and deterministic hex labels. | Shipped | `crates/planet-render/src/domain/subsector.rs`; `hexes_within_grid`, `label_format` tests | Backlog task 4 expands display to two side-by-side subsectors. |
| Star mapping / occupancy | Classic presence is roughly 50 percent, with density variation by region. | Density is configurable from 0 to 1; default 0.5 mirrors the classic 1D >= 4 feel. | Shipped | `domain::subsector::generate`; `empty_at_zero_density`, `full_at_unit_density`, `occupancy_matches_density` tests | Two-subsector generation should keep density deterministic across the seam. |
| Hex address | Worlds are addressed as four-digit hexes such as `0101`. | Rust and TS both expose `0101`-style labels. | Shipped | `HexCoord::label`; `src/domain/subsector/types.ts`; Rust `label_format` test; text export tests | Preserve labels when moving to two-subsector display; add a region coordinate if needed. |
| World size | Cepheus size is a UWP digit. | Size projects from generated planet radius rather than table rolls; size-0 worlds force atmosphere/hydrographics to 0 and size-1 worlds force hydrographics to 0. | Partial | `project_uwp` in `domain/subsector.rs`; `mainWorldModelToUwp` tests; Rust `physical_codes_round_from_main_world_and_suppress_size_zero_water` test | Document the science-first deviation from `2D6-2` table generation. |
| Atmosphere | Cepheus atmosphere is a UWP digit with survivability meaning. | Atmosphere projects from climate habitability, temperature, and size with a rough heuristic; branch behavior is now pinned by Rust tests. | Partial | `project_uwp` in `domain/subsector.rs`; `src/domain/mainWorld/model.ts`; Rust `atmosphere_code_tracks_habitability_and_temperature_extremes` test | Replace heuristic with pressure/composition/survivability model. |
| Hydrographics | Cepheus hydrographics is a 0-10 surface water digit. | Hydrographics projects from Rust climate liquid-water fraction and TS continuous hydrographics percent; TS uses SRD percentage buckets and size 0-1 forces hydrographics 0. | Partial | `domain/climate.rs`; `project_uwp`; `mainWorldModelToUwp` tests; `src/uwpVisualMapping.test.ts` | Keep globe/surface map sampling the same authoritative water fraction. |
| Population | Cepheus population is an exponent digit and feeds map data. | Population is generated from habitability plus random spread; subsector hexes serialize an actual population estimate for the PBG multiplier; TS projects actual population by lower-bound exponent. | Partial | `project_uwp`; `SubsectorHex.population`; `src/domain/mainWorld/model.ts`; `mainWorldModelToUwp` tests | Continue moving authored-world UI state toward actual population rather than only UWP-shaped digits. |
| Government | Cepheus government is generated from population. | Rust uses the standard `2D6 - 7 + pop` shape, clamps to UWP range, and forces Government 0 when Population is 0. | Partial | `project_uwp`; Rust `government_law_and_starport_table_shapes_are_clamped` test | Add referee overrides and reconciliation once campaign data exists. |
| Law level | Cepheus law level is generated from government. | Rust uses the standard `2D6 - 7 + gov` shape, clamps to UWP range, and forces Law 0 when Government is 0. | Partial | `project_uwp`; Rust `government_law_and_starport_table_shapes_are_clamped` test | Add travel-zone trigger tests when refining route/map semantics. |
| Starport | Cepheus starport is a letter class and affects bases/routes/tech. | Rust now uses the Chapter 12 adjusted roll `2D6 - 7 + Population`; TS exposes starport quality for continuous projection. | Partial | `project_uwp`; `src/components/StarportEditor.tsx`; `src/domain/mainWorld/model.ts`; Rust `government_law_and_starport_table_shapes_are_clamped` test | Decide whether generated starports should stay table-random or be partly infrastructure-derived. |
| Tech level | Cepheus tech level uses starport and world DMs. | Rust applies starport, size, atmosphere, hydrographics, population, and government DMs plus Chapter 12 minimum TL rules, and forces TL 0 when Population is 0. | Partial | `project_uwp`; Rust `tech_level_applies_world_dms_and_clamps` test | Revisit once Rust owns pressure/composition rather than atmosphere heuristics. |
| Trade codes | Worlds receive trade classifications such as Ag, Ri, In, Wa. | TS derives 18 game-facing trade codes from UWP digits and renders/exports them. | Shipped | `src/domain/cepheus/tradeCodes.ts`; `tradeCodes.test.ts`; `SystemEditor`, `SubsectorEditor`, export tests | Keep new codes table-driven; avoid duplicating rules in Rust unless bindings are generated. |
| Planetoid belts | Subsector data marks belt presence. | Rust carries both belt-present flags for map glyphs and the generated belt count in `SubsectorHex.pbg`. | Shipped | `domain/subsector.rs`; `src/domain/subsector/export.ts`; Rust/TS PBG tests | Preserve counts when moving from one subsector to the two-subsector region model. |
| Gas giants | Subsector data marks gas giant presence. | Rust carries both gas-giant-present flags for map glyphs and the generated gas/ice-giant count in `SubsectorHex.pbg`. | Shipped | `domain/subsector.rs`; `src/domain/subsector/export.ts`; Rust/TS PBG tests | Preserve counts when moving from one subsector to the two-subsector region model. |
| PBG | PBG packs population multiplier, belts, and gas giants. | Rust derives PBG from serialized actual population, asteroid-belt count, and gas/ice-giant count; text export consumes the serialized triple. | Shipped | `Pbg`; `SubsectorHex.population`; `pbg_from_parts`; `src/domain/subsector/export.ts`; PBG tests | Surface PBG in the inspector if referees need it outside text export. |
| Bases | Naval, Scout, Research, and Aid bases are map-facing data. | Rust rolls simplified base presence from starport and population; TS renders and exports base letters. | Partial | `roll_bases`; `SubsectorMap.tsx`; `SubsectorEditor.tsx`; export base tests | Compare thresholds to SRD tables and add deterministic unit tests for base rules. |
| Travel zones | Amber and Red zones flag risk or interdiction. | Rust derives Green/Amber/Red from high law/government plus rare incidents; UI and export surface zones. | Partial | `roll_travel_zone`; `SubsectorMap.tsx`; export zone tests | Add referee overrides and tests for extreme law/government triggers. |
| Allegiance | Subsector/world entries carry allegiance. | Subsector currently uses one allegiance string, defaulting to Independent. | Partial | `Subsector.allegiance`; `SubsectorEditor`; `subsectorToText` | Backlog task 5 should add polity borders, contested hexes, and overrides. |
| Jump routes | Nearby qualifying worlds can be connected by jump routes. | Rust emits jump-1/jump-2 routes between class C+ starports within hex distance 1 or 2. | Shipped | `compute_jump_routes`; `jump_routes_link_only_qualifying_ports` test; `SubsectorMap.tsx` | Backlog task 5 should distinguish communication routes from trade routes. |
| Communication routes | Chapter 12 distinguishes communication/travel connectivity from raw world data. | Not modeled separately from jump routes. | Open | None | Add route type, rendering style, export column/metadata, and tests. |
| Trade routes | Trade route presence should reflect economic gravity, not only distance. | Not modeled separately; trade codes exist but route economics do not. | Open | None | Rust route-economics model in backlog task 10. |
| World names | Maps need readable world names. | Deterministic pronounceable names are generated in TS and used in map/export when Rust has no name. | Shipped | `src/domain/names.ts`; `names.test.ts`; `SubsectorMap.tsx`; `subsectorToText` | Move names into persisted campaign/override data when online play starts. |
| Surface world maps | Chapter 12 includes world/surface mapping concepts. | Rust generates surface map DTOs; UI renders a legacy 2d6-style icosahedral surface map with starport/cities. | Partial | `crates/planet-render/src/domain/surface_map.rs`; `src/components/SurfaceMap.tsx`; Rust surface-map tests | Backlog tasks 7 and 9 should align globe pixels with the surface map and add surface export. |
| Referee overrides | Referees need to adjust generated game data. | Direct UWP editing exists; map data overrides are not persistent yet. | Open | UWP editor only | Backlog tasks 5 and 11 should introduce campaign override data. |
| Player-safe sharing | Online play needs shareable regions and player-safe output. | URL state and export tools exist for current views, but no campaign/player visibility model exists. | Open | `src/appState/urlState.ts`; export modules | Backlog task 11 should define share/campaign boundaries. |

## Immediate Follow-Ups

1. Add focused tests for the partially implemented Rust UWP projection rules:
   size, atmosphere, hydrographics, starport, government, law, and tech bounds.
2. Split jump routes into route categories: navigational jump adjacency,
   communication routes, and trade routes.
3. Add referee override data for bases, zones, allegiance, and routes before
   online campaign persistence.
