# AGENTS.md

Guidance for coding agents working in this repository.

## Product Intent

UWP is intended to support Cepheus Engine / legacy 2d6-style games. The app should generate and visualize whole stellar systems for play, not just pretty standalone planets.

The Cepheus Engine SRD describes the Universal World Profile (UWP) as the compact, game-facing code for the main world of a system: Starport, Size, Atmosphere, Hydrographics, Population, Government, Law Level, and Tech Level. It also treats belts, gas giants, bases, travel zones, trade codes, and allegiance as system or map context.

Reference: https://www.orffenspace.com/cepheus-srd/book3/worlds.html

Our design goal is slightly different from classic table-first generation:

- Generate scientifically plausible stellar systems first.
- Locate or derive the main world inside that physical system.
- Project the continuous physical/social model into Cepheus-compatible UWP values for gameplay.
- Keep UWP values as rounded game codes, not the only source of truth.

In short: the underlying model should be continuous and physically coherent; the UWP is the readable game summary.

## Continuous Values And UWP Rounding

Sliders should generally allow intermediate values. The current UWP digits are discrete, pseudo-hex game codes, but they should be treated as rounded or bucketed views of richer values.

Examples:

- Size code is a rounded projection of radius/diameter/gravity.
- Atmosphere code is a rounded projection of pressure/composition/survivability.
- Hydrographics code is a rounded projection of surface water coverage.
- Population code is a rounded projection of actual population.
- Tech level, law, government, and starport can still be game abstractions, but should have room for richer intermediate or derived state when useful.

When adding controls:

- Prefer continuous internal values and slider steps such as `0.01`, `0.05`, or domain-appropriate units.
- Show or derive the nearest UWP code from those values.
- Avoid making integer UWP digits the only editable representation unless the UI is explicitly a UWP-code editor.
- Preserve direct UWP entry for Referees who already have a code.

## Architecture Direction

The project should stay split into clear layers:

- **Domain model:** Cepheus UWP parsing, trade/game classifications, physical system generation, main-world selection.
- **App model:** typed UI state and commands. Avoid product UI calling renderer commands through `window`.
- **Renderer client:** a small typed facade over the WASM renderer, responsible for lifecycle, commands, snapshots, and error handling.
- **Render backend:** Rust/wgpu resource management, render passes, uniform packing, camera, and scene-specific rendering.
- **Shaders:** WGSL modules should stay validated and should not silently drift from Rust uniform layouts.

As complexity grows, avoid putting more responsibility into `Canvas.tsx`, `ControlPanel.tsx`, or `renderer.rs`. They are already pressure points. Prefer extracting cohesive modules before adding large features.

### State Ownership

Keep Preact for the panel — it's the right size of tool for a sidebar of sliders, hot-reloads in milliseconds, and adds ~10 KB to the bundle. A Rust UI framework would add 100–300 KB of WASM runtime, break HMR, and reimplement DOM abstractions the JS ecosystem has already polished. The Rust↔JS bridge for UI events is not a performance bottleneck and is not worth optimising away.

The **state ownership boundary** should keep moving toward Rust without moving the rendering of widgets:

- Rust owns the live renderer state: `PlanetParams`, `SolarSystem`, camera, GPU resources, and any future authored state.
- JS app state exposes snapshots and command actions. Product components call actions; they do not call the WASM object or `window.uwp` directly.
- Parameter mutations are centralized through `appState` and delegated to the renderer client when the renderer exists. The `params` signal is a UI snapshot, not a component-owned mutable source.
- System snapshots flow back after mutations (`setSystemSeed`, `rerollPlanet`) so components subscribe to state instead of polling the renderer.
- Future work should replace the remaining whole-struct `setParams` bridge with narrower typed setters when the Rust domain model has enough invariants to justify the extra API surface.

Wins from this: Rust enforces invariants (no impossible UWP states, no orphaned `PlanetParams`), the JS panel becomes a pure view layer, type safety improves without losing iteration speed, and the FFI cost stays in the right places (interaction-time, not frame-time).

**Outstanding boundary work.** `wasm_api::set_params` still accepts a whole `PlanetParams` deserialised from JS, so JS still holds a writable canonical copy. This is the last place the state-ownership boundary leaks. Once enough Rust-side invariants exist to make per-field validation worth it (for example "sea level cannot exceed hydrographic ceiling"), split this into narrow typed setters (`setSeaLevel`, `setSeed`, `setAtmosphereDensity`, …) so JS can only request mutations Rust agrees with.

## Target Refactor Design

Refactor toward an architecture where the app is a system generator with a renderer attached, not a renderer that happens to expose some game data.

Desired module shape:

- `src/domain/cepheus/`: UWP parsing, UWP formatting, Cepheus code projection, trade codes, travel zones, bases, and starport/game abstractions.
- `src/domain/system/`: TypeScript DTOs for `SolarSystem`, `Star`, `Planet`, `Moon`, belts, companions, and main-world summaries. These should mirror serialized Rust data.
- `src/domain/mainWorld/`: logic that selects or reconciles the main world and turns continuous physical/social values into rounded UWP values.
- `src/appState/`: signals or a small reducer/store containing typed app state, actions, and derived selectors. UI components should call actions, not mutate scattered signals directly.
- `src/rendererClient/`: a typed facade for the WASM `Planet` object. It should own renderer lifecycle, `setParams`, `setViewMode`, `setSystemSeed`, `rerollPlanet`, snapshots, resize, frame loop, and error handling.
- `src/components/`: presentation components split by task: shell, render canvas, UWP editor, continuous world controls, system summary, planet table, performance/quality controls.
- `crates/planet-render/src/gpu.rs`: device, surface, pipeline creation, bind groups.
- `crates/planet-render/src/scenes/detail/`: detail planet render pass, uniforms, camera behavior, and detail-scene packing.
- `crates/planet-render/src/scenes/system/`: system overview pass, visual orbit compression, system uniform packing, camera fitting.
- `crates/planet-render/src/domain/`: physical system generation and serializable domain structs, kept as pure as practical.
- `crates/planet-render/src/wasm_api.rs`: small wasm-bindgen boundary that translates between JS calls and internal domain/renderer types.

The long-term shape should make these boundaries true:

- UI state can be tested without WebGPU.
- System generation can be tested without a browser or GPU.
- Renderer lifecycle can be tested/smoked without knowing Cepheus rules.
- Shader layout changes are localized and validated.
- Continuous world values and rounded UWP codes can evolve independently.

## Refactor Steps

Do this incrementally. Avoid a rewrite.

1. **Stabilize quality gates.**
   Fix Rust warnings, remove dead code, and keep `cargo clippy --workspace --all-targets -- -D warnings` green. This makes later file moves safer.

2. **Introduce shared TypeScript DTOs.**
   Define typed `SolarSystem`, `Star`, `Planet`, `Moon`, `AsteroidBelt`, `Companion`, and `MainWorldSummary` interfaces. Replace `any` in app state and system UI.

3. **Create renderer-client facade.**
   Move WASM lifecycle, frame loop, resize handling, render profile application, system snapshot refresh, and renderer commands out of `Canvas.tsx`. The UI should receive typed actions such as `rerollPlanet(index)` instead of using `window.uwp`.

4. **Split app state from actions.**
   Replace ad hoc signal mutation with named actions/selectors: `setUwpCode`, `setContinuousWorldValue`, `selectMainWorld`, `setViewMode`, `rerollSystem`, `rerollPlanet`, `setRenderProfile`. Signals are fine, but writes should be centralized.

5. **Separate UWP code from continuous world state.**
   Add a continuous `WorldModel` or `MainWorldModel` with physical/social values. Derive UWP codes from it by rounding/bucketing. Preserve direct UWP entry by converting the code into a plausible continuous model.

6. **Extract system-scene Rust code.**
   Move `SystemUniforms`, visual orbit compression, display radius, schematic colors, system camera fitting, and `system_uniforms_for` out of `renderer.rs` into a system-scene module.

7. **Extract detail-scene Rust code.**
   Move detail render pass setup, detail uniforms, planet mesh resolution, and atmosphere/scene target handling into detail-scene modules. Keep shared GPU resource helpers separate.

8. **Make shader contracts explicit.**
   Add Rust tests for uniform struct size/alignment where practical. Keep comments in Rust and WGSL synchronized. Consider generating WGSL struct snippets or TypeScript DTOs if manual drift keeps happening.

9. **Modularize large shaders only when behavior is stable.**
   WGSL include/preprocess support is custom today through `shader_with_common`. If shaders keep growing, extend that mechanism to compose named chunks such as noise, tonemap, stars, system bodies, clouds, and atmosphere.

10. **Add feature-level tests.**
   Add tests for main-world selection, UWP projection from continuous values, UWP-to-system reconciliation, trade code derivation, and renderer-client command behavior. This matters more than broad snapshot tests.

11. **Improve mobile fallback after boundaries exist.**
   Once renderer-client owns frame timing, add runtime downshift and eventually a non-WebGPU/static fallback without spreading device logic through UI components.

Refactor priority should follow pain: type/contracts first, command boundaries second, Rust renderer decomposition third, shader modularity last.

## Current Refactor Baseline

The requested refactor baseline is now in place:

- TypeScript domain DTOs live in `src/domain/system/`.
- Cepheus/UWP entry points and trade code derivation live in `src/domain/cepheus/`.
- Continuous main-world projection helpers and tests live in `src/domain/mainWorld/`.
- App signals and named actions live in `src/appState/`; `src/state.ts` is a compatibility re-export.
- App-state tests cover renderer command delegation and snapshot refresh.
- WASM lifecycle, resize, frame loop, adaptive render profiles, snapshots, and renderer commands live in `src/rendererClient/`.
- `Canvas.tsx` is now only the canvas mount point.
- `ControlPanel.tsx` is a shell; UWP code, starport, world profile, society, view controls, and system table live in focused components.
- Product UI calls typed actions such as `rerollPlanet(index)` instead of `window.uwp`; the window handle remains debug-only.
- UWP sliders can hold intermediate values; UWP output rounds/buckets those values into Cepheus-compatible digits.
- Runtime frame-time monitoring can downshift from high → balanced → low render profiles on slow devices.
- The Performance panel exposes the effective render profile, FPS, frame time, target FPS, render-target size, shader quality, and manual Auto/High/Balanced/Low overrides.
- Rust system-view uniform packing and camera fitting live in `crates/planet-render/src/scenes/system.rs`.
- Rust detail-scene uniform packing, mesh quality, HDR/depth target helpers, and detail render-pass encoding live in `crates/planet-render/src/scenes/detail.rs`.
- Rust GPU/surface/pipeline setup lives in `crates/planet-render/src/gpu.rs`.
- Rust physical system generation lives in `crates/planet-render/src/domain/system.rs`.
- The wasm-bindgen boundary lives in `crates/planet-render/src/wasm_api.rs`.
- Rust uniform layout tests pin the detail and system shader contracts.
- WGSL chunk inclusion is supported through `shader_with_common`; the shared AGX tonemap lives in `shaders/chunks/agx.wgsl`.

The remaining large items in this file are product roadmap work rather than cleanup debt: stronger Rust-side authored-world invariants, optional generated bindings, and the Rust compute roadmap below.

## Cleanup Backlog

The cleanup pass completed the renderer decomposition items that were blocking
larger Rust compute work:

- Detail uniforms, detail camera fitting, seed-derived tilt/offset packing, and detail mesh buffer creation live in `scenes/detail.rs`.
- System uniform buffer/layout/bind-group creation lives in `scenes/system.rs`.
- Detail and system uniform layout tests pin the WGSL contracts.
- `recompute_planet_climate` refreshes climate summaries after planet mutation, and `reroll_planet` calls it even though current rerolls are surface-seed-only.

Remaining cleanup debt:

1. **Narrow the remaining whole-struct parameter bridge.** `wasm_api::set_params` still accepts a complete `PlanetParams` deserialised from JS. Pick this up when Rust-side authored-world invariants exist and per-field validation has real semantics.

### Shipped cleanup

- **Detail uniform dirty flag.** `Renderer` caches the last `DetailUniforms` and only recomputes the heavy fields (view-proj, sun direction, seed offsets) when params / camera / size change; per-frame work patches the model matrix and `time` slot. → `8904258`

## Design & UX Backlog

Presentation layer work — `src/components/`, `src/styles.css`, `src/app.tsx`, leaf presentation modules. Roughly priority-ordered; pick items based on which user-visible weakness is most visible at the time. The shipped items below have a `→ commit` reference so it's easy to see how each one was implemented.

### Shipped

1. **Visual design system.** Documented CSS custom properties — surface layers, type/color/spacing/radius/motion tokens, focus ring, prefers-reduced-motion. Legacy aliases preserved for incremental migration. → `f4d4579`
2. **Iconography pass.** SVG icon kit in `src/components/Icon.tsx` for body types and starport classes; reused by `SystemEditor` and `StarportEditor`. → `cc539fd`
3. **Empty / error / loading states.** `rendererStatus` lifecycle drives `LoadingOverlay`, distinct `unsupported`/`error` cards in `ErrorOverlay`. → `6afcd49`
4. **System editor presentation refresh.** Definition-list metadata grid, coloured `HabitabilityBar`, right-aligned numerics with separated unit suffixes, hover row backgrounds, accent-tinted main-world row, refresh-glyph reroll. → `e8a2170`
5. **Mobile and touch.** `@media (pointer: coarse)` enlarges slider thumbs and button hit areas to platform 44 pt; mobile breakpoint gives modals full width and bigger row padding. → `85923bb`
6. **Accessibility.** Focus trap on modals via `useFocusTrap`, canvas exposes a description, view toggle gains `aria-label`/`aria-pressed`, viewport `user-scalable=no` removed, `<noscript>` fallback added. → `1bdad0d`
7. **Animation and transitions.** 240 ms black wash overlay between view modes, respects `prefers-reduced-motion`. → `da619fb`
8. **First-run onboarding.** Bottom-centre hint chip with drag/scroll/menu cues; dismissed on first interaction or after 12 s; persisted to `localStorage`. → `4adc4d5`
9. **Trade-code chips.** Main-world trade codes rendered as accented chips with `<abbr>` tooltips. → `9e4b7bf`
10. **Settings persistence.** View mode, panel open state, render quality persisted to `localStorage` under a versioned key; hydrated before App mounts. → `19e1830`
11. **Help / glossary.** Modal of Cepheus / legacy 2d6 vocabulary, opened from a `?` button in the panel header. → `c7cfe89`
12. **About + copy pass.** Footer About link opens a credits modal (engine, shell, rules ref, source, build ID). → `4ab1c05`
13. **Three-way view toggle.** Segmented control (Subsector / System / Main World) replaces the two-state button; Main World disabled until a system loads. → `88b0928`
14. **Breadcrumb / location header.** Centre-top pill walks the navigation depth with clickable crumbs and `Esc` shortcut. → `ab4d689`
15. **Performance panel polish.** Coloured FPS pill, profile call-out, segmented quality control. → `ab4d689`
16. **Hover affordances + click-to-zoom.** System view fires a 50 ms-throttled ray-pick; hover tooltip shows class/orbit/mass/Teq; click jumps to Main World. → `26d014f`
17. **Hex inspector cards.** `SubsectorEditor` surfaces UWP, trade codes, travel zone, bases, and features for the selected hex. → `88b0928`
18. **Export visuals.** `ExportPanel` ships two presets: a raw PNG frame and a 2D-composited planet card that overlays UWP + star metadata + trade-code chips beside the canvas snapshot. → `9042cdd`
19. **Pronounceable names.** Deterministic CV-CV-CV name generator surfaces in the breadcrumb, system header, subsector hex detail, and hover tooltip so worlds read as "Aenis" rather than four-digit hex addresses. → `25001aa`

### Open

1. **Surface hex inspector.** Once the Surface Map roadmap lands, reuse the inspector shape for per-hex terrain / settlement details.

New UX work proposals belong in this section. When picking up an item, mark it in commit messages so it stays traceable.

## Rust Compute Baseline

The first roadmap item now implemented is a Rust-side climate and habitability
model in `crates/planet-render/src/domain/climate.rs`.

- Each generated planet receives a serialized `ClimateSummary`.
- The model runs a compact latitude-band energy-balance simulation with
  greenhouse warming, water inventory, ice-albedo feedback, aridity, liquid
  water fraction, and habitability scoring.
- Main-world selection uses the Rust-computed climate habitability score
  rather than a TypeScript or UWP-table heuristic.
- The system panel exposes the selected main world's mean surface
  temperature, liquid-water fraction, and habitability.

This gives Rust ownership of a numerically testable simulation result and
creates a natural landing zone for future climate/biome/tectonics work.

## Type And Contract Rules

- Do not use `any` for serialized Rust data in product UI. Define TypeScript DTOs for `SolarSystem`, `Star`, `Planet`, `Moon`, belts, companions, and game-facing UWP projections.
- Keep Rust serialized structs and TypeScript DTOs in sync. If possible, generate bindings; otherwise add tests or review notes whenever fields change.
- Rust uniform structs must match WGSL layouts exactly. Any new packed field needs comments on both sides and shader validation.
- Treat `window.uwp` as a debug convenience only. Product UI should use typed commands or signals.

## System Generation Principles

- Scientific plausibility wins over exact classic random table output when the two conflict.
- Use Cepheus UWP semantics for game-facing compatibility.
- Main worlds should be selected from generated planets, not invented independently of the system.
- Habitable zones, snow lines, orbital spacing, planet mass/radius, equilibrium temperature, belts, gas giants, and moons should remain physically coherent.
- If a user supplies an existing UWP, reconcile it with the nearest plausible generated system rather than creating impossible physics.

## UX Principles

- The first screen should remain the usable app, not a landing page.
- Referees should be able to move fluidly between:
  - the full physical system,
  - the selected main world,
  - the Cepheus UWP/game summary,
  - visual rendering controls.
- Controls should make it clear when the user is editing continuous physical state versus editing the rounded UWP code.

## Performance Principles

- Mobile and low-power devices matter. Keep adaptive render profiles and continue pushing toward runtime downshifts when frame time is poor.
- High and Balanced should render at the browser refresh cadence; Balanced buys performance through lower pixels/shader/mesh, not an awkward 45 fps cap. Low may cap to 30 fps when the device needs relief.
- Prefer measured simplification over piling more branches into already-heavy shaders.
- Do not let UI blur/backdrop effects compete with WebGPU on mobile.
- If WebGPU is unavailable or unstable, the app should eventually provide a simpler fallback view rather than only an error.

## Rust Compute Roadmap

The current CPU-side workload is trivial — mesh once at startup, microseconds per frame for uniform packing, sub-millisecond for system generation. Almost all the work is in WGSL on the GPU. For Rust to keep earning its place beyond "wgpu is the best WebGPU library," the next features that genuinely need it should land on the CPU side.

These are the high-ROI Rust compute opportunities, roughly in priority order. Don't do them speculatively — pick the next one when a feature actually needs it.

1. **Procedural surface pre-bake.** Biggest win by a wide margin. `planet.wgsl` currently recomputes 7-octave FBM + plate-tectonics Voronoi + crater layers + biome blending per fragment per frame, which is wasteful — the surface doesn't change while you orbit. Bake six 2k×2k cube-map faces (heightmap + biome + feature mask) per seed in Rust with `rayon`. Shader becomes cheap texture lookups; per-pixel budget drops 5–10×, freeing space for finer detail, real river networks, or higher resolution at the same framerate. **Hard prerequisite for the World Surface Map Roadmap.**

2. **Climate / habitability simulation.** Initial version implemented. Next functional iterations: seasonal axial-tilt sampling (sample insolation at multiple obliquity-modulated points around the orbit, average), precipitation bands (latitude-dependent Hadley / Ferrel / polar cells), ocean heat capacity (sea-fraction-weighted thermal inertia so temperate worlds stop reaching equilibrium in a single iteration), and a shader-facing biome field uploaded as a small texture so `planet.wgsl` can colour continents physically instead of from fbm.

3. **Tectonics simulation.** Run plate motion + uplift + erosion for N timesteps to produce real continents, mountain belts, ocean basins. Replace the noise-derived continents with a physically-motivated heightmap. Heavy compute, exactly where Rust shines.

4. **Multi-scatter atmosphere LUT** (Bruneton & Neyret 2008 / Hillaire 2020). The full method precomputes a 4D scattering LUT once per atmosphere config. We currently raymarch single-scattering per fragment with a constant multi-scatter hack. Real LUT gives proper Earth-from-orbit blue rim, twilight bands, and is dramatically cheaper at render time. Rust precomputes on parameter change, stores into GPU textures.

5. **Asteroid belt as real particles.** *Partial → `0a4cf28`.* The shader now does a slab integration with two grain scales, azimuthal streaks following orbital direction, Kirkwood-style depletion gaps, and out-of-plane thickness. Full CPU particle simulation with per-rock orbital elements remains future work; the shader version reads as discrete particles instead of a smear.

6. **Hover / click ray-pick.** *Shipped → `26d014f`.* `scenes::system::pick_planet` runs ray-vs-display-sphere against the system view; the WASM API exposes `pickSystemPlanet`, Canvas.tsx routes pointermove + click through it, and `HoverTooltip` surfaces class/orbit/mass/Teq next to the cursor.

7. **N-body / Kepler propagator with binary perturbations.** *Shipped → `4ae34ac`.* `scenes::system::planet_world_position` does Newton-iterated Kepler propagation (mean → eccentric → true anomaly) with seed-derived argument of periapsis, plus a `binary_kick` Kozai-Lidov approximation that pumps inner-planet eccentricity in time with the companion's orbital phase. Damped to keep orbits inside the spacing slot.

8. **Star spectral synthesis.** *Shipped → `1d64044`.* `domain::blackbody::blackbody_srgb` integrates Planck radiance against the CIE 1931 colour-matching functions at 10 nm resolution, then converts to linear sRGB and normalises to unit max. Used everywhere the generator previously called the polynomial fit; tests pin solar/M-dwarf/B-type qualitative results plus invariants.

9. **Long-timescale stability check.** *Shipped → `0319df2`.* `domain::stability` runs the analytic envelope checks (Chambers et al. mutual Hill radius, MMR avoidance for gas giants, Holman-Wiegert binary envelope) that the equivalent 100 Myr N-body run would expose. A regression test asserts >= 55 % of randomly-generated systems pass; tightening that threshold is the natural follow-on for compute roadmap item 7.

10. **Image / animation export.** *Partial → `9042cdd`.* Frame-grab via `canvas.toBlob()` and a 2D-composited planet card (snapshot + UWP/star/trade-codes block) both download from the panel. Full Rust offscreen rendering (animation timeline, higher resolution than viewport, video) remains future work.

When implementing any of these, the same boundary rules apply: the Rust crate owns the computation and its output buffers; the JS layer requests it through a typed WASM method and observes results through a reactive snapshot signal. Don't shortcut through `window.uwp` for non-debug code.

## Subsector Roadmap

A subsector is the Cepheus Engine sector-map unit: an 8-column × 10-row hex grid of star systems, with bases, trade codes, gas-giant presence, asteroid belts, travel zones, and inter-system jump routes attached to each occupied hex. Reference: <https://www.orffenspace.com/cepheus-srd/book3/worlds.html>.

This is the next major product feature. The goal is that a user can land on a generated subsector, browse the hex grid, click any occupied hex to drill into that system's overview (existing System view), and from there into its main world (existing Detail view). UWP codes, trade codes, bases, and travel zones surface as Cepheus-compatible game data at every level.

### Target Boundaries

The subsector layer must respect the architecture already established. No new direct-DOM/`window` shortcuts; everything flows through `appState` actions and the renderer client.

- **Domain (Rust):** `crates/planet-render/src/domain/subsector.rs` owns subsector generation, hex addressing, jump-route resolution, and Cepheus rules (bases, travel zones). It depends on `domain::system` and `domain::climate`; the rest of the crate does not depend on it.
- **Domain (TS):** `src/domain/subsector/` mirrors the serialized Rust structs as TS DTOs (`Subsector`, `SubsectorHex`, `Bases`, `TravelZone`, `JumpRoute`). Trade-code derivation already lives in `src/domain/cepheus/tradeCodes.ts` and is reused as-is — the subsector hex carries trade codes computed from its main world's UWP.
- **App state:** new signals `currentSubsector`, `selectedHex` plus actions `rerollSubsector(seed)` and `selectHex(coord)`. Selecting a hex is what loads its system seed into the existing system-state machinery.
- **Renderer client:** gains `setSubsectorSeed(seed)` and `getSubsector()` wrappers around new wasm-api methods. The Map view will not initially go through the WebGPU canvas — the canvas stays for system/detail views, the subsector is a sibling DOM/SVG view.
- **UI:** new `SubsectorMap.tsx` component does SVG hex grid rendering and hex picking. `app.tsx` toggles between Subsector / System / Main World view modes. The view toggle becomes a three-way control.

### Cepheus Rules To Implement

From the SRD Book 3 / Worlds page, in priority order:

1. **System presence per hex.** Roll 1D ≥ 4 (about 50 %). Density is mainsector-dependent; expose as a configurable density factor in the generator so we can do sparse rim/dense core variants.
2. **Main-world UWP.** Each occupied hex picks a system seed; the system is generated lazily by `domain::system`, the main world is the climate-habitability-winner (existing), and its UWP is projected from continuous physical/social values (existing `mainWorld::model`).
3. **Gas giant present.** Already known per-system (`SolarSystem.planets.iter().any(|p| p.body_type == GasGiant)`). Carry through to the subsector hex flag.
4. **Asteroid belt present.** Same — `SolarSystem.belts.is_empty()`.
5. **Bases.** Naval / Scout / Research / Aid membership rolled per Cepheus tables, modified by starport class. Pack into a `Bases` bitset on each hex.
6. **Trade codes.** Derived from the main world's UWP via the existing `tradeCodes.ts` rules. Cached on the hex for fast map rendering.
7. **Travel zone.** Amber / Red / Green derived from population, law level, government, and a small random "incident" factor. Cepheus is loose here — keep it rule-driven but allow Referee override.
8. **Allegiance.** Each subsector belongs to one or two factions. Per-hex allegiance derived from polity boundaries; initial implementation: single allegiance per subsector with neutral / contested hexes.
9. **Jump routes.** Compute connectivity at jump-1 and jump-2 (radius 1 and 2 hexes, axial coordinates). A route exists between two systems if both have qualifying starports (typically C+). Expose as a vec of `(from, to, jump_n)` for SVG-line rendering.

The full Cepheus subsector includes more (worlds in the same hex, gas-giant-only refuelling, jumpline maps, sector-level political maps). The above is enough for v1; the rest belong in a v2 increment after the data model and UI are stable.

### Architecture Sketch

```text
crates/planet-render/src/domain/
├── system.rs        ← already: SolarSystem, Planet, Moon, AsteroidBelt
├── climate.rs       ← already: ClimateSummary per planet
└── subsector.rs     ← new:  Subsector, SubsectorHex, Bases, JumpRoute

src/domain/
├── system/          ← already: SolarSystem DTOs
├── cepheus/         ← already: TradeCode derivation, UWP parsing
├── mainWorld/       ← already: continuous-to-UWP projection
└── subsector/       ← new:  Subsector DTOs mirroring Rust

src/components/
├── SystemEditor.tsx     ← already: system panel
├── SubsectorEditor.tsx  ← new:  subsector summary + density + seed
├── SubsectorMap.tsx     ← new:  SVG hex grid + picking
└── ...

src/appState/
└── index.ts             ← extend: currentSubsector, selectedHex, rerollSubsector, selectHex
```

### Phases

Phases 1-7 are shipped. Tackle 8 only once the SVG version's UX is stable.

1. **Rust subsector data model + generator.** *Shipped → `8d48f26`.* `domain::subsector` defines `HexCoord`, `Bases`, `TravelZone`, `Uwp`, `SubsectorHex`, `Subsector`; `generate(seed, density)` walks an 8×10 grid hashing per-hex sub-seeds and runs `system::generate` per occupied hex.

2. **Bases / gas-giant / belt / trade codes per hex.** *Shipped → `8d48f26`.* `build_hex` projects main-world physics into UWP digits, rolls Cepheus base presence keyed on starport class, and derives a travel zone from law/government. Trade codes are derived TS-side from the UWP wire format.

3. **WASM API + TS DTOs.** *Shipped → `88b0928`.* `wasm_api::generate_subsector` is a free function exposed as `generateSubsector`; TS DTOs live in `src/domain/subsector/`.

4. **App state + renderer client.** *Shipped → `88b0928`.* `subsectorSeed`, `subsectorDensity`, `currentSubsector`, `selectedHex`, `showJumpRoutes` signals; `selectHex` action stores the choice, feeds the system pipeline, and snaps view mode. `subsectorClient.ts` regenerates on seed/density changes.

5. **SVG subsector map UI.** *Shipped → `88b0928`.* `SubsectorMap.tsx` renders pointy-top hexes with system dots, UWP digits, base markers (N/S/R/T), travel-zone tinting, and keyboard focus. `SubsectorEditor.tsx` surfaces allegiance, occupancy, density, the reroll button, and a hex inspector for the selected cell.

6. **Jump routes overlay.** *Shipped → `1912943`.* `compute_jump_routes` walks every pair of class-C+ starports and emits jump-1 or jump-2 edges based on hex-grid distance. The SVG renders solid green for jump-1 / dashed amber for jump-2; the editor's "Jump routes" checkbox toggles visibility.

7. **Navigation polish.** *Shipped → `ab4d689`.* `Breadcrumb.tsx` renders a centre-top pill walking Subsector / Hex / System / Main World with clickable crumbs; `Esc` pops one level.

8. **Optional: WebGPU subsector renderer.** Port the data path to a WGSL fullscreen-triangle scene (`scenes/subsector.rs` + `subsector.wgsl`), then restyle the view to match the WebGPU look (shared starfield backdrop, AGX tonemap consistency). Only worth doing once the SVG version has stable UX.

9. **Trade codes column in the system panel.** *Shipped → `9e4b7bf`.* System editor renders the main world's trade codes as accented chips with `<abbr>` tooltips, so the Cepheus game data is visible without bouncing back to the subsector view.

### Phase 1 Acceptance Criteria

For the first phase to be "done":

- `domain::subsector::generate(seed)` returns a `Subsector` with deterministic content for a given seed.
- Occupancy ratio across 1000 seeds is within 5 % of the configured density (default 50 %).
- Each occupied hex has a generated `MainWorldSummary` with a valid UWP.
- A Rust test verifies trade-code derivation against a handful of known UWPs.
- No UI work; this phase lives entirely behind the WASM boundary.

### Notes For The Implementing Agent

- **Re-use, don't fork.** Trade codes are already implemented (`tradeCodes.ts`); the subsector hex carries a `MainWorldSummary` derived through the existing `mainWorld::model` pipeline. Don't duplicate UWP / climate / system logic.
- **Determinism.** A given `subsector_seed` must always produce the same grid. Per-hex sub-seed = `hash(subsector_seed, col, row)` so individual hexes can be regenerated without disturbing their neighbours.
- **Lazy generation.** Generating 80 full `SolarSystem`s up front is wasteful — most hexes are empty, and the user only drills into one or two. Generate the main-world summary eagerly; defer full planet/moon generation until the user selects the hex.
- **Don't break the existing renderer.** The subsector view is an SVG sibling of the WebGPU canvas, not a replacement. The canvas stays mounted; the subsector view is layered on top or shown in a different DOM region. This avoids redoing renderer lifecycle for a 2D map.
- **State ownership stays Rust-owned.** Per the State Ownership note above: Rust holds the canonical `Subsector`, JS snapshots it. The picking logic *can* live in TS (hex math is cheap and not a state question), but the chosen hex must be re-validated against the Rust state when it requests the system.

## World Surface Map Roadmap

legacy 2d6-style hex world maps of each main world's surface, sitting one level *below* the Main World detail view. Each hex shows terrain (mountain, forest, desert, ocean, ice, urban, etc.) and the map identifies the starport location and the major cities derived from the main world's UWP. The hex map's terrain must match what the 3D globe shows — clicking a hex should be able to spin the globe to point at that location.

This is a separate feature from the *subsector* hex map (which arranges star systems across a sector). This one is **the planetary surface**, at a much higher detail level. Classic legacy 2d6 world maps are typically ~32-column × 16-row hex grids covering the whole sphere via a hex-friendly equal-area projection.

### Hard Dependency

This feature depends on **Rust Compute Roadmap item 1 (procedural surface pre-bake)**. The reason: the globe's surface is currently a per-fragment shader procedure, so the only way to make a 2D hex map "match the globe" today is to duplicate the noise + plate-tectonics + biome logic on the CPU side. That's exactly the duplication the pre-bake removes — once the surface is a cube-map texture, both the globe shader and the hex-map generator sample the same authoritative buffers. Don't attempt this feature without the pre-bake; you'd be writing the noise code twice and they would drift.

### Target Boundaries

- **Domain (Rust):** `crates/planet-render/src/domain/surface_map.rs` reads the pre-baked surface cube-maps and produces a `SurfaceMap` — a flat hex grid with terrain, elevation, biome, water-fraction per cell. Also owns starport placement and city placement (`SurfaceMap::starport`, `SurfaceMap::cities`) using Cepheus rules + the climate/habitability data already on each planet.
- **Domain (TS):** `src/domain/surfaceMap/` mirrors the serialized Rust structs as TS DTOs (`SurfaceMap`, `SurfaceHex`, `Settlement`, `StarportLocation`). Biome enums are shared with the existing climate types.
- **App state:** new signals `currentSurfaceMap`, `selectedSurfaceHex` plus an action `selectSurfaceHex(coord)` that can optionally feed the globe camera (Phase 5).
- **Renderer client:** gains `getSurfaceMap()` reading the Rust-side map for the currently selected main world. If the camera-to-hex bridge ships, a new method `pointCameraAt(latitude, longitude)` aims the detail-render camera at a given surface coordinate.
- **UI:** new `SurfaceMap.tsx` SVG hex grid component; new view mode `'surface'`. The view-mode toggle becomes Subsector / System / Main World / Surface (four-way). A "show on globe" affordance bridges back to the detail-render view rotated to the picked hex.

### Cepheus Rules To Implement

From Cepheus Engine Book 3 / Worlds, World Mapping section:

1. **Terrain classification per hex.** Derived from the pre-baked surface cube-map: ocean (below sea level), shoreline, plain, forest, hill, mountain, desert (low water, hot), tundra (cold), ice (cold + high latitude), volcanic (hot rocky). Mapping rules tied to elevation, latitude, water-inventory, equilibrium-temperature already stored on the planet's `ClimateSummary` and the biome field from compute-roadmap item 2 (climate extension to biome textures).
2. **Starport location.** One hex per world. Located on a high-population, habitable, coastal/plain hex (Cepheus convention: starports are near the main population centre). Class A/B may also have orbital satellites or off-world bases; for now we just mark a surface hex.
3. **Major cities.** Count scales from the UWP population code: Pop 0–4 → 0–2 settlements, Pop 5–7 → 3–8 settlements, Pop 8+ → 10–20 settlements. Placement: coastal/river/plain biases, never on deep ocean or mountain unless terrain is restrictive; spread out via Poisson-disc to avoid clustering.
4. **Sea / land ratio matches Hydrographics.** The hex map's ocean coverage must match the main world's hydrographics digit (within rounding). This is a cross-check: if the pre-bake's water fraction diverges from the UWP hydrographics, the projection step is the source of truth — round the pre-bake's water fraction to the nearest UWP digit.
5. **Polar caps consistent with `ice_latitude`.** The same `ice_latitude` parameter that drives the globe shader's polar caps must drive the hex map's ice/tundra band boundary.
6. **Atmospheric / climate annotation per hex.** Each hex carries the local climate summary (temperature, precipitation if available, day length) so a Referee panel can show "hex 0703 — temperate forest, mean 285 K, 15-day rainfall pattern". This composes naturally with compute-roadmap item 2 (precipitation bands).

### Architecture Sketch

```text
crates/planet-render/src/domain/
├── system.rs        ← already
├── climate.rs       ← already
├── subsector.rs     ← roadmap above
└── surface_map.rs   ← new: reads pre-baked cube-maps, places starport + cities

src/domain/
├── system/
├── cepheus/
├── mainWorld/
├── subsector/      ← roadmap above
└── surfaceMap/      ← new: DTOs (SurfaceMap, SurfaceHex, Settlement, ...)

src/components/
├── SurfaceMap.tsx        ← new: SVG hex grid for one world
├── SurfaceMapEditor.tsx  ← new: panel summary, hex inspector
└── ...
```

### Phases

Tackle in this order; the pre-bake must land before phase 1.

1. **Rust surface-map generation from pre-baked data.** `surface_map::generate(planet_id, pre_bake) -> SurfaceMap`. Walk a 32×16 (or configurable) hex grid in equal-area projection, sample the pre-baked cube-map at each hex centre, classify terrain from elevation + biome + climate. Unit tests: ocean fraction matches the pre-bake's water fraction, polar caps within ice-latitude, no NaN hexes.

2. **Starport placement.** Pick one hex meeting: habitable, coastal-or-plain, on the lit hemisphere if the world is tidally locked, ideally near the population centroid. Deterministic for a given seed. Unit test: starport hex is one of the more habitable cells.

3. **City placement.** Count from population code. Poisson-disc-sampled positions weighted by habitability and avoiding ocean/mountain. Unit tests: count matches UWP, spread reasonable (min spacing).

4. **WASM API + TS DTOs.** Expose `getSurfaceMap()` from `wasm_api.rs`; TS DTOs in `src/domain/surfaceMap/`. Cache the map in Rust (it doesn't change while the world parameters are fixed); recompute only when the world or its surface pre-bake changes.

5. **App state + renderer client.** Signals `currentSurfaceMap`, `selectedSurfaceHex`. View mode enum extends to `'surface'`. Renderer client exposes `selectSurfaceHex` and a `pointCameraAt(latitude, longitude)` helper used by phase 7.

6. **SVG surface hex map UI.** `SurfaceMap.tsx` renders the 512-ish hex grid; terrain types coloured per biome; starport marker (★) and city markers (●, size scaled by tier). `SurfaceMapEditor.tsx` shows the inspector for the selected hex with biome / climate / settlements. Click → `selectSurfaceHex`. Four-way segmented control wires up the new view mode.

7. **Globe ↔ surface bridge.** Camera-rotation helper and lat/long projection math in Rust + renderer-client method; "show on globe" affordance and hover-to-highlight-latitude-band interaction on the surface map in the UI.

8. **Optional WebGPU port.** Same pattern as the subsector roadmap: port the data path to a WGSL fullscreen-triangle scene, then restyle the view to match. Only worth doing once the SVG version's UX is stable.

### Phase 1 Acceptance Criteria

- `domain::surface_map::generate(...)` returns a deterministic `SurfaceMap` for a given world.
- Hex count is `32 × 16 = 512` (or configurable) and covers the sphere without gaps or overlaps.
- Ocean fraction within ±5 % of the pre-bake's water fraction.
- Polar ice / tundra band starts at the `ice_latitude` parameter, ±1 hex row tolerance.
- A Rust test asserts: every hex has a valid biome enum, no NaN elevation.
- No UI work; lives entirely behind the WASM boundary.

### Notes For The Implementing Agent

- **Surface pre-bake first.** Don't try to reproduce the shader's noise stack in Rust as a shortcut. Implement Rust Compute Roadmap item 1, then build this on top of it.
- **Equal-area or interrupted-Goode projection.** A naïve lat-lon hex grid distorts wildly at the poles. Use an equal-area hex tessellation of the sphere (geodesic, icosahedral subdivision, or HEALPix-style) or fall back to the classic legacy 2d6 interrupted-rectangle projection. Pick whichever makes hex-to-globe-coord conversion cheap, because the globe-bridge step needs it both ways.
- **Cepheus hydrographics is a rounded view, not the source of truth.** If the pre-bake's water fraction is 0.62, the UWP rounds to hydrographics 6, and the surface map should show 60 % ocean coverage (matching the pre-bake), not 60 % exactly to match the rounded UWP. The pre-bake is canonical; UWP is the rounded game label.
- **Cities are not just "dots on land".** A good legacy 2d6 GM hex map clusters cities along coasts, rivers, and habitable bands. Use the climate field (item 6 above) to weight placement properly — desert worlds have cities along oases / poles, ice worlds along the equatorial belt, etc.
- **State ownership stays Rust-owned.** Same rule as subsector: Rust holds the canonical `SurfaceMap`, JS snapshots it. The hex picking math can run in TS but the data is Rust's.

## Deployment Policy

**Do not deploy from a developer or agent machine. Push to `main` and let CI deploy.**

`.github/workflows/ci.yml` runs the full check suite, builds the production
bundle in CI, and then a separate `deploy` job ships the artifact to
Cloudflare via `wrangler-action`. Every commit on `main` therefore deploys
exactly once, from exactly the artifact CI verified.

Why this rule exists:

- A CLI deploy from a working tree that hasn't been pushed yet drifts the
  live site from `origin/main`. The next CI deploy then either looks like
  a no-op (confusing) or overwrites the CLI-shipped build with a different
  one (worse).
- The build ID stamped into the bundle is derived from `GITHUB_SHA` in CI
  and a local git short SHA otherwise. A CLI deploy publishes a build ID
  that doesn't correspond to anything on the remote, which defeats the
  post-deploy verification flow described in the README.
- CI runs `cargo clippy` for native and wasm targets and the full Playwright
  smoke suite as part of `verify`. A CLI deploy bypasses those gates.

`npm run deploy` is kept as an escape hatch for genuinely emergent
situations (CI broken, urgent rollback needed). If you ever run it,
tell the team and follow up by re-aligning the CI deploy: push the same
commit, let CI re-run, confirm the live build ID matches.

For agents in particular: never call `wrangler deploy` or `npm run
deploy` yourself. Treat the pipeline as the only deploy path. If you've
made changes you want live, push them; CI will handle it within a few
minutes.

## Verification

Before committing meaningful changes, run the relevant subset:

```bash
npm run verify:fast
```

The Husky pre-commit hook runs `npm run verify:fast`, which covers TS unit
tests, Rust formatting, and native Rust checking. Before pushing, run the full
gate with `npm run verify`; the Husky pre-push hook runs the same command:
tests, typecheck, audit, native+wasm Rust checks, Rust tests, native+wasm
clippy with warnings denied, the production build, and the Playwright smoke
suite against the production preview.

If a check cannot be run, say so explicitly. Warnings in Rust should be treated as design feedback, not background noise.

## Collaboration Notes

Always check `git status` before editing — the user or their tooling may have local changes you didn't make. Don't overwrite or revert unrelated edits unless asked.

Use `rg` for searching.
