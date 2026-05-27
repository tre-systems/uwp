# AGENTS.md

Guidance for coding agents working in this repository.

## Current Status

**Planned work is complete.** Every roadmap section below has a v1
shipped end-to-end:

- Cleanup Backlog → renderer decomposition shipped; one conditional
  follow-on (narrow the whole-struct param bridge) waits on Rust-side
  invariants.
- Design & UX Backlog → all 20 items shipped (see commit refs below).
- Subsector Roadmap → phases 1-7 shipped; phase 8 is the doc's own
  "Optional: WebGPU port", conditional on perf / consistency need.
- World Surface Map Roadmap → phases 1-7 shipped; phase 8 is the
  matching optional WGSL port.
- Rust Compute Roadmap → 6 items shipped, 4 partial (v1 ships, the
  extensions are conditional), 2 conditional (GPU integration of the
  pre-bake; tectonics evolution).

The remaining items in this file are *conditional future ideas* the
project may pick up when a specific need surfaces. The doc's own rule
applies: don't do them speculatively.

The active, sequential backlog lives in `docs/BACKLOG.md`. Use that file for
the next work item; use this file for product intent, architecture boundaries,
and historical roadmap context.


## Product Intent

UWP is intended to support Cepheus Engine / classic 2d6 games. The app should generate and visualize whole stellar systems for play, not just pretty standalone planets.

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
- Direct UWP entry and slider edits are reconciled through `reconcileUwpDigits`: size 0 forces atmosphere/hydrographics 0, size 1 forces hydrographics 0, uninhabited worlds force government/law/tech 0, non-finite values clamp, and population caps at Cepheus `A`.
- Runtime frame-time monitoring can downshift from high → balanced → low render profiles on slow devices.
- The Performance panel exposes the effective render profile, FPS, frame time, target FPS, render-target size, shader quality, and manual Auto/High/Balanced/Low overrides.
- System-view picking and table actions can focus non-main bodies in Detail:
  stars, gas/ice/mini-Neptune worlds, rocky worlds, cold super-Earths, and
  asteroid belts all route through typed app-state targets and dedicated
  renderer visual modes rather than `window.uwp`.
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
11. **Help / glossary.** Modal of Cepheus vocabulary, opened from a `?` button in the panel header. → `c7cfe89`
12. **About + copy pass.** Footer About link opens a credits modal (engine, shell, rules ref, source, build ID). → `4ab1c05`
13. **Three-way view toggle.** Segmented control (Subsector / System / Main World) replaces the two-state button; Main World disabled until a system loads. → `88b0928`
14. **Breadcrumb / location header.** Centre-top pill walks the navigation depth with clickable crumbs and `Esc` shortcut. → `ab4d689`
15. **Performance panel polish.** Coloured FPS pill, profile call-out, segmented quality control. → `ab4d689`
16. **Hover affordances + click-to-zoom.** System view fires a 50 ms-throttled ray-pick; hover tooltip shows class/orbit/mass/Teq; click jumps to Main World. → `26d014f`
17. **Hex inspector cards.** `SubsectorEditor` surfaces UWP, trade codes, travel zone, bases, and features for the selected hex. → `88b0928`
18. **Export visuals.** `ExportPanel` ships two presets: a raw PNG frame and a 2D-composited planet card that overlays UWP + star metadata + trade-code chips beside the canvas snapshot. → `9042cdd`
19. **Pronounceable names.** Deterministic CV-CV-CV name generator surfaces in the breadcrumb, system header, subsector hex detail, and hover tooltip so worlds read as "Aenis" rather than four-digit hex addresses. → `25001aa`

20. **Surface hex inspector.** `SurfaceMapEditor` reuses the inspector shape for per-hex terrain / latitude / temperature / elevation, with a "Main starport sits here" callout when the selected cell is the starport. → `6785193`

21. **Editable seed inputs.** Both the Subsector and System panels expose the raw seed as a text field that commits on Enter or blur and accepts hex (`0xCAFE`). Pairs with `1`/`2`/`3`/`4` keyboard shortcuts on the view toggle (suppressed inside inputs / modals). → `fc1661a`

22. **Body inspector.** Click any row in the System editor's planet table to expand a derived-properties strip — radius, surface gravity, density, escape velocity, year length, day length, eccentricity, inclination — plus a per-moon list with sizes and orbital radii. Reroll dismisses the expansion so stale numbers can't flash. → `3611bc1`

23. **Subsector text export.** `subsectorToText` renders a sector-map-style fixed-width table (Name / Hex / UWP / Bases / Codes / Zone / PBG / Allegiance). The Subsector panel ships two buttons that copy it to the clipboard or download it as a `.tab` file. → `c82e36f`

24. **Card export — main-world stats block.** Detail-mode `Planet card` PNGs now include the body inspector numbers (radius, gravity, density, escape velocity, year, day) so a player handout is one click away. → `a922868`

25. **Hover tooltip — year and day.** System-view hover already showed mass / orbit / temperature; the second-line sub-meta now also surfaces orbital period (days / months / years) and rotation period (minutes / hours / days). → `2c394b4`

26. **System time scrubber.** Pause / 1× / 5× / 20× cluster in the System editor drives a simulation clock the renderer reads instead of wall-clock time. Detail-view scenes always advance at 1× so clouds and waves never freeze when the system is paused. Picking uses the same sim clock so hover / click stay aligned with the visible planet position. → `631badb`

27. **Glossary expansion.** Bases, Travel zone, Jump route, PBG entries added so a player coming in cold doesn't have to leave the app to read the Cepheus SRD. → `8f9e7df`

### Open

No items currently open. New UX work proposals belong in this section. When picking up an item, mark it in commit messages so it stays traceable.

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

The roadmap started as ten high-ROI Rust compute opportunities; v1 is now shipped end-to-end. Three items are still tagged as *Partial* — a usable form ships today and the listed extension is conditional on a specific need surfacing. Two items remain *Conditional* — they're big enough that the doc's own rule applies: don't do them speculatively, pick them up when a feature actually needs them.

### Shipped

- **1. Procedural surface pre-bake** → `c3ffb12`, extended by current GPU upload work. `domain::surface_prebake` produces a 1024×512 lat/lon heightmap per seed by combining plate-tectonic uplift/rift with multi-octave value noise. `surface_map::generate` samples it for the hex map; the detail renderer uploads the same raw heightmap as a `planet.wgsl` terrain atlas and packs a quantile-derived sea threshold so the globe waterline follows the same hydrographics fraction as the world map.
- Surface pre-bake performance correction: the latest `(seed, water)` bake is cached in Rust, the JS preview snapshot is cached in `RendererClient`, and hidden Surface views no longer regenerate maps on every slider change. Keep this lazy/share-first rule unless profiling proves a different path is needed.
- **3. Tectonics simulation** → `c3ffb12`. Shipped together with the pre-bake: 6-10 plate centres with tangential drift, convergence at boundaries drives uplift (mountains), divergence drives rifts (basins). Per-cell plate IDs preserved for future biome / colouring work.
- **6. Hover / click ray-pick** → `26d014f`. `scenes::system::pick_planet` runs ray-vs-display-sphere against the system view; `Canvas.tsx` routes pointermove + click; `HoverTooltip` surfaces class/orbit/mass/Teq.
- **7. N-body / Kepler propagator with binary perturbations** → `4ae34ac`. Newton-iterated Kepler propagation with seed-derived argument of periapsis + `binary_kick` Kozai-Lidov approximation.
- **8. Star spectral synthesis** → `1d64044`. `domain::blackbody::blackbody_srgb` integrates Planck radiance against the CIE 1931 colour-matching functions; normalised sRGB output.
- **9. Long-timescale stability check** → `0319df2`. `domain::stability` runs Chambers mutual-Hill, MMR avoidance, and Holman-Wiegert envelope checks. Regression test asserts ≥ 55 % of seeds pass.

### Partial (extensible)

- **2. Climate / habitability simulation** → `6e35769`. Seasonal axial-tilt sampling shipped (four orbital-phase samples per latitude band). Extensions when needed: precipitation bands (Hadley / Ferrel / polar cells), ocean heat capacity, shader-facing biome texture.
- **4. Multi-scatter atmosphere LUT** → `033a2c0`. Inline Hillaire-style multi-scatter approximation shipped; the 2D MS LUT itself would move per-fragment optical-depth onto a precomputed texture for a smaller render-time cost, but the visual gap is already closed.
- **5. Asteroid belt as real particles** → `0a4cf28`. Shader-side slab integration with two grain scales, azimuthal streaks, Kirkwood gaps, out-of-plane thickness shipped. Full CPU particle simulation would replace the shader belt with instanced billboards if a future feature (eg. inspector-clickable rocks) needs per-rock identity.
- **10. Image / animation export** → `9042cdd`. PNG frame-grab + 2D-composited planet card shipped. A Rust offscreen render path would let the user request resolutions higher than the viewport, animation timelines, or video; not needed for the current single-frame PNG export.

### Conditional (deferred — pick up when a downstream feature demands it)

- **GPU integration of the pre-bake — v1 shipped.** The detail renderer now copies the pre-bake into a `wgpu::Texture` and `planet.wgsl` samples it for elevation/coastline decisions. Remaining conditional extensions: upload richer atlas/biome buffers once Rust owns stable surface-cell ids, and add visual regression coverage across globe/map/region/export views.
- **Tectonics evolution.** v1 ships a single-pass plate convergence/divergence model. Iterating it for N timesteps with simple erosion would produce more weathered terrain (smoothed mountain ranges, oxbow-like river valleys). Useful once the GPU pre-bake landing makes terrain detail visible on the globe.

When implementing any of these, the same boundary rules apply: the Rust crate owns the computation and its output buffers; the JS layer requests it through a typed WASM method and observes results through a reactive snapshot signal. Don't shortcut through `window.uwp` for non-debug code.

## Subsector Roadmap

A subsector is the Cepheus Engine sector-map unit: an 8-column × 10-row hex grid of star systems, with bases, trade codes, gas-giant presence, asteroid belts, travel zones, and inter-system jump routes attached to each occupied hex. Reference: <https://www.orffenspace.com/cepheus-srd/book3/worlds.html>.

The product map currently presents two adjacent subsectors as one local
16-column × 10-row campaign strip (`0101` through `1610`) so referees can see
routes and neighbours across the classic subsector border. Keep the serialized
`columns` / `rows` fields authoritative; UI, export, and tests should not
reintroduce an implicit 8×10 assumption.

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

1. **Rust subsector data model + generator.** *Shipped → `8d48f26`, expanded → current.* `domain::subsector` defines `HexCoord`, `Bases`, `TravelZone`, `Uwp`, `SubsectorHex`, `PolityCell`, and `Subsector`; `generate(seed, density)` walks a 16×10 two-subsector strip hashing per-hex sub-seeds and runs `system::generate` per occupied hex. A full `polity_cells` territory layer covers empty hexes too, so borders are campaign-map facts rather than artifacts of occupied-world adjacency.

2. **Bases / gas-giant / belt / trade codes per hex.** *Shipped → `8d48f26`.* `build_hex` projects main-world physics into UWP digits, rolls Cepheus base presence keyed on starport class, and derives a travel zone from law/government. Trade codes are derived TS-side from the UWP wire format.

3. **WASM API + TS DTOs.** *Shipped → `88b0928`.* `wasm_api::generate_subsector` is a free function exposed as `generateSubsector`; TS DTOs live in `src/domain/subsector/`.

4. **App state + renderer client.** *Shipped → `88b0928`.* `subsectorSeed`, `subsectorDensity`, `currentSubsector`, `selectedHex`, `showJumpRoutes`, `subsectorOverrides`, and `subsectorRouteOverrides` signals; `selectHex` action stores the choice, feeds the system pipeline, and snaps view mode. `subsectorClient.ts` regenerates on seed/density changes.

5. **SVG subsector map UI.** *Shipped → `88b0928`, expanded → current.* `SubsectorMap.tsx` renders pointy-top hexes with system dots, UWP digits, base markers (N/S/R/A), travel-zone tinting, full-grid polity tinting, continuous borders, capital markers, and keyboard focus. `SubsectorEditor.tsx` surfaces allegiance, occupied/territory counts, capitals, occupancy, density, the reroll button, and a hex inspector for the selected cell.

6. **Jump routes overlay.** *Shipped → `1912943`, expanded → current.* `compute_jump_routes` walks every pair of class-C+ starports and emits jump-1 or jump-2 edges based on hex-grid distance. Rust annotates each route with communication/trade metadata and tests red-zone blocking, jump-2 courier penalties, trade-promoted communications, and score clamping. The SVG renders route classes through `visibleRoutes`; selected-hex route overrides can hide links or adjust communication/trade metadata without mutating generated Rust data.

7. **Navigation polish.** *Shipped → `ab4d689`.* `Breadcrumb.tsx` renders a centre-top pill walking Subsector / Hex / System / Main World with clickable crumbs; `Esc` pops one level.

8. **Optional: WebGPU subsector renderer.** *Conditional — deferred.* Port the data path to a WGSL fullscreen-triangle scene, then restyle the view to match the WebGPU look. The SVG version's UX is stable and looks consistent with the rest of the panel; this only becomes worth doing if the SVG hits a perf wall on very large sectors or if shared-backdrop visual consistency is requested.

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
- **Lazy generation.** Generating 160 full `SolarSystem`s up front is wasteful — most hexes are empty, and the user only drills into one or two. Generate the main-world summary eagerly; defer full planet/moon generation until the user selects the hex.
- **Don't break the existing renderer.** The subsector view is an SVG sibling of the WebGPU canvas, not a replacement. The canvas stays mounted; the subsector view is layered on top or shown in a different DOM region. This avoids redoing renderer lifecycle for a 2D map.
- **State ownership stays Rust-owned.** Per the State Ownership note above: Rust holds the canonical `Subsector`, JS snapshots it. The picking logic *can* live in TS (hex math is cheap and not a state question), but the chosen hex must be re-validated against the Rust state when it requests the system.

## World Surface Map Roadmap

classic 2d6 hex world maps of each main world's surface, sitting one level *below* the Main World detail view. Each hex shows terrain (mountain, forest, desert, ocean, ice, urban, etc.) and the map identifies the starport location and the major cities derived from the main world's UWP. The hex map's terrain must match what the 3D globe shows — clicking a hex should be able to spin the globe to point at that location.

This is a separate feature from the *subsector* hex map (which arranges star systems across a sector). This one is **the planetary surface**, at a much higher detail level. Classic classic 2d6 world maps are typically ~32-column × 16-row hex grids covering the whole sphere via a hex-friendly equal-area projection.

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

Phases 1-7 are shipped on a pre-bake-backed v1 (`6785193`, later GPU atlas integration, then Rust-owned atlas cells). The world map and globe now share the Rust pre-bake for coastlines and major elevation. The visible icosahedral cells are serialized from Rust as stable `SurfaceCellId`s with exact centres, boundaries, climate/terrain summaries, and settlement ids. Region drill-downs opened from the icosahedral map now carry the clicked atlas cell's terrain, latitude, temperature, elevation, and id. The remaining mismatch is region detail: it still paints a local procedural landscape instead of sampling an atlas patch and neighbouring cells.

1. **Rust surface-map generation.** *Shipped → `6785193`.* `domain::surface_map::generate` walks a 32×16 hex grid, picks sea level by quantile of a three-octave value noise so ocean fraction tracks `climate.liquid_water_fraction`, classifies terrain (Ocean / Shoreline / Plain / Forest / Hill / Mountain / Desert / Tundra / Ice / Volcanic) from elevation + latitude + climate + body-type. Four unit tests pin determinism, grid extent, ocean-fraction tracking, and polar-ice growth on a synthesised cold world.

2. **Starport placement.** *Shipped → `6785193`.* Scores habitable, low-elevation, coastal/plain cells with a mid-latitude bias and a tiny RNG jitter for tie-break; picks the top score per seed.

3. **City placement.** *Shipped → `6785193`.* Target count from `climate.habitability * class_mult`, scored by terrain + latitude, sampled greedily with a minimum hex-distance gap so cities don't clump. Tiered 0-3 (village / town / city / metropolis).

4. **WASM API + TS DTOs.** *Shipped → `6785193`.* `Planet::getSurfaceMap()` returns the JSON shape; TS DTOs in `src/domain/surfaceMap/`.

5. **App state + renderer client.** *Shipped → `6785193`.* `currentSurfaceMap`, `selectedSurfaceHex` signals; `refreshSurfaceMap` action; renderer client pushes a fresh map alongside every system snapshot refresh. ViewMode enum extends to `'surface'`.

6. **SVG surface hex map UI.** *Shipped → `6785193`, sharpened later.* `SurfaceMap.tsx` renders a 12-subdivision pointy-top icosahedral hex grid over an adaptive high-resolution pre-bake backdrop, with a fixed terrain palette, starport star, city dots scaled by tier, focus rings, click-to-select. `SurfaceMapEditor.tsx` surfaces grid stats and a per-hex inspector. `ViewModeToggle` becomes a 4-way segmented control with Surface disabled until a main world exists.

7. **Globe ↔ surface bridge.** *Shipped → `e3eb716`.* `Camera::point_at` aims the detail-view camera at a (lat, lon); `Renderer::point_at_surface` applies the spin to `rotation_t` and pauses auto-rotate so the target stays still. Wired through `pointAtSurface` and `selectAndFocusSurfaceHex` on `appState`; clicking a hex in the SVG focuses the globe immediately, and the inspector grows a "Show on globe" button that aims + switches to Main World in one click.

8. **Rust-owned atlas-cell identities.** *Shipped in the current surface realism pass.* `domain::surface_atlas` owns the visible icosahedral cells, stable ids, flat boundaries, water depth, slope, moisture, temperature, biome id, projected terrain, and sea-level threshold. `SurfaceMap` keeps the older 32 x 16 cells only as compatibility metadata while starports, cities, selection, and Region view receive atlas ids; Region view now samples the selected atlas neighbourhood for its base local terrain.

9. **Optional WebGPU port.** *Conditional — deferred.* Same shape as subsector phase 8: only worth doing if the SVG version hits a perf or visual-consistency limit.

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
- **Cities are not just "dots on land".** A good Referee hex map clusters cities along coasts, rivers, and habitable bands. Use the climate field (item 6 above) to weight placement properly — desert worlds have cities along oases / poles, ice worlds along the equatorial belt, etc.
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
