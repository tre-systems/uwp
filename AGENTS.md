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

Instead, move the **state ownership boundary** into Rust without moving the rendering of widgets:

- Rust owns the canonical `PlanetParams`, `SolarSystem`, and any future authored state. JS never holds a writable copy; it reads snapshots.
- All mutations cross the FFI as typed, named methods on `Planet` (`setSize(8)`, `setSystemSeed(0x1234)`, `rerollPlanet(2, seed)`). No `serde-wasm-bindgen` round-tripping of whole structs back from JS.
- Snapshots flow back via small reactive signals (`currentSystem`, `currentParams`), refreshed after each mutation. Components subscribe to the snapshots they need.
- This pattern is already partly in place for system view (`systemSeed` → `setSystemSeed` → `getSystem` snapshot → panel re-renders). Extend it to the UWP/world-state side: replace the JS-side `params` signal as a writable source with a `currentParams` snapshot derived from Rust.

Wins from this: Rust enforces invariants (no impossible UWP states, no orphaned `PlanetParams`), the JS panel becomes a pure view layer, type safety improves without losing iteration speed, and the FFI cost stays in the right places (interaction-time, not frame-time).

## Target Refactor Design

Refactor toward an architecture where the app is a system generator with a renderer attached, not a renderer that happens to expose some game data.

Desired module shape:

- `src/domain/cepheus/`: UWP parsing, UWP formatting, Cepheus code projection, trade codes, travel zones, bases, and starport/game abstractions.
- `src/domain/system/`: TypeScript DTOs for `SolarSystem`, `Star`, `Planet`, `Moon`, belts, companions, and main-world summaries. These should mirror serialized Rust data.
- `src/domain/mainWorld/`: logic that selects or reconciles the main world and turns continuous physical/social values into rounded UWP values.
- `src/appState/`: signals or a small reducer/store containing typed app state, actions, and derived selectors. UI components should call actions, not mutate scattered signals directly.
- `src/rendererClient/`: a typed facade for the WASM `Planet` object. It should own renderer lifecycle, `setParams`, `setViewMode`, `setSystemSeed`, `rerollPlanet`, snapshots, resize, frame loop, and error handling.
- `src/components/`: presentation components split by task: shell, render canvas, UWP editor, continuous world controls, system summary, planet table, performance/quality controls.
- `crates/planet-render/src/gpu/`: device, surface, target textures, pipeline creation, bind groups.
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

The first architecture pass has established the intended boundaries:

- TypeScript domain DTOs live in `src/domain/system/`.
- Cepheus/UWP entry points are available through `src/domain/cepheus/`.
- Continuous main-world projection helpers live in `src/domain/mainWorld/`.
- App signals and named actions live in `src/appState/`; `src/state.ts` is a compatibility re-export.
- WASM lifecycle, resize, frame loop, render profiles, snapshots, and renderer commands live in `src/rendererClient/`.
- `Canvas.tsx` is now only the canvas mount point.
- Product UI calls typed actions such as `rerollPlanet(index)` instead of `window.uwp`; the window handle remains debug-only.
- Rust system-view uniform packing and camera fitting live in `crates/planet-render/src/scenes/system.rs`.
- Rust detail-scene mesh quality and HDR/depth target helpers live in `crates/planet-render/src/scenes/detail.rs`.
- A Rust uniform layout test pins the `SystemUniforms` shader contract.
- `SystemEditor.tsx` owns system summary/table presentation instead of growing `ControlPanel.tsx`.

Next refactor work should continue extracting GPU/pipeline setup and the full detail-scene render pass from `renderer.rs`, then split the remaining UWP editor controls out of `ControlPanel.tsx`.

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
- Prefer measured simplification over piling more branches into already-heavy shaders.
- Do not let UI blur/backdrop effects compete with WebGPU on mobile.
- If WebGPU is unavailable or unstable, the app should eventually provide a simpler fallback view rather than only an error.

## Rust Compute Roadmap

The current CPU-side workload is trivial — mesh once at startup, microseconds per frame for uniform packing, sub-millisecond for system generation. Almost all the work is in WGSL on the GPU. For Rust to keep earning its place beyond "wgpu is the best WebGPU library," the next features that genuinely need it should land on the CPU side.

These are the high-ROI Rust compute opportunities, roughly in priority order. Don't do them speculatively — pick the next one when a feature actually needs it.

1. **Procedural surface pre-bake.** Biggest win by a wide margin. `planet.wgsl` currently recomputes 7-octave FBM + plate-tectonics Voronoi + crater layers + biome blending per fragment per frame, which is wasteful — the surface doesn't change while you orbit. Bake six 2k×2k cube-map faces (heightmap + biome + feature mask) per seed in Rust with `rayon`. Shader becomes cheap texture lookups; per-pixel budget drops 5–10×, freeing space for finer detail, real river networks, or higher resolution at the same framerate. Natural pre-bake step for any modern planet renderer.

2. **Climate / habitability simulation.** Coarse-grid energy-balance model (latitude bands × day-night × axial tilt × ocean heat capacity × atmospheric circulation) run once per system or when params change. Output a temperature and precipitation field that the surface shader samples to place biomes physically rather than from noise. Vastly more believable continents; sub-second compute on CPU.

3. **Tectonics simulation.** Run plate motion + uplift + erosion for N timesteps to produce real continents, mountain belts, ocean basins. Replace the noise-derived continents with a physically-motivated heightmap. Heavy compute, exactly where Rust shines.

4. **Multi-scatter atmosphere LUT** (Bruneton & Neyret 2008 / Hillaire 2020). The full method precomputes a 4D scattering LUT once per atmosphere config. We currently raymarch single-scattering per fragment with a constant multi-scatter hack. Real LUT gives proper Earth-from-orbit blue rim, twilight bands, and is dramatically cheaper at render time. Rust precomputes on parameter change, stores into GPU textures.

5. **Asteroid belt as real particles.** Currently a noise-mottled band. Spawn 5–50k actual particles with orbital elements (eccentricity, inclination, Kirkwood gaps from mean-motion resonance with the nearest gas giant), integrate them on CPU, render as a sprite/point buffer. Looks dramatically better and is physically motivated.

6. **Hover / click ray-pick.** Required for "hover a planet to see its name, click to fly there." Project planet positions to screen space (or ray-test against the bodies) on CPU each frame. The data is right there; pick the nearest hit and feed it to the UI as a signal.

7. **N-body / Kepler propagator with binary perturbations.** Real Kepler propagator with binary-induced eccentricity oscillations and mean-motion resonance lockup. Replaces the current fixed circular ω. Few thousand ops per frame.

8. **Star spectral synthesis.** Replace the polynomial blackbody-color fit with a proper Planck integral × CIE color-matching for per-class star colors and limb chromaticity. Pre-compute per spectral type into a small table.

9. **Long-timescale stability check.** Add a Wisdom-Holman or Mercury-style integrator that runs each generated system forward by ~100 Myr as a unit test, verifying no system flies apart. Catches edge cases the per-pair Hill stability test misses.

10. **Image / animation export.** Offscreen rendering at custom resolution, animation timelines, batch-rendering all planets in a system to a sprite atlas for fast switching. Rust orchestrates an offscreen render with different uniform parameters and ships PNG bytes back to JS.

When implementing any of these, the same boundary rules apply: the Rust crate owns the computation and its output buffers; the JS layer requests it through a typed WASM method and observes results through a reactive snapshot signal. Don't shortcut through `window.uwp` for non-debug code.

## Verification

Before committing meaningful changes, run the relevant subset:

```bash
npm test
npm run typecheck
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
npm run build
```

If a check cannot be run, say so explicitly. Warnings in Rust should be treated as design feedback, not background noise.

## Collaboration Notes

Other agents or tools may be working in the same branch. Always check `git status` before editing. Do not overwrite or revert unrelated changes. If files are already dirty, work around those changes unless the user explicitly asks for cleanup.

Use `rg` for searching. Use `apply_patch` for manual edits.
