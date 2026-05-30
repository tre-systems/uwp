# AGENTS.md

Guidance for coding agents working in this repository.

- **Architecture + module map:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **What to work on next:** [docs/BACKLOG.md](docs/BACKLOG.md)
- **Cepheus rules coverage:** [docs/CEPHEUS_CHAPTER_12.md](docs/CEPHEUS_CHAPTER_12.md)

This file is operating guidance and product/engineering principles — how things
work and how to work on them. It is not a changelog; git history is the record.

## Default Completion Workflow

For user-requested code, design, or documentation changes, assume the work is
not complete until it is committed, pushed, deployed, and verified on the live
site unless the user explicitly says not to.

- Run the relevant local checks before committing. Use the full verification
  suite when the change can affect production behavior.
- Commit with a concise message that describes the shipped change.
- Push the branch and watch the CI/deploy run to completion.
- Verify the deployed build on <https://uwp.tre.systems>. For UI-visible
  changes, exercise the affected view in the live browser and capture evidence
  that it looks right. For non-UI changes, confirm the live app still loads and
  is serving the expected build.
- If the live site is wrong, keep iterating through fix, test, commit, push, and
  live verification until it is correct or a real blocker appears.

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

The system-design + module map lives in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). This section captures the direction
and the state-ownership intent that guides new work.

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

- Mobile and low-power devices matter. Keep the adaptive render profiles and the runtime frame-time downshift that protect them.
- High and Balanced should render at the browser refresh cadence; Balanced buys performance through lower pixels/shader/mesh, not an awkward 45 fps cap. Low may cap to 30 fps when the device needs relief.
- Prefer measured simplification over piling more branches into already-heavy shaders.
- Do not let UI blur/backdrop effects compete with WebGPU on mobile.
- If WebGPU is unavailable or unstable, the app should eventually provide a simpler fallback view rather than only an error.

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

When you change rendering (WGSL shaders, the renderer, or UWP/body→params
mapping), also run the per-body-class visual-regression suite — it's kept out of
the pre-push gate to keep pushes fast:

```bash
npm run test:visual                       # compare against committed baselines
npm run test:visual -- --update-snapshots # re-baseline after an intentional change (eyeball the diff)
```

If a check cannot be run, say so explicitly. Warnings in Rust should be treated as design feedback, not background noise.

## Collaboration Notes

Always check `git status` before editing — the user or their tooling may have local changes you didn't make. Don't overwrite or revert unrelated edits unless asked.

Use `rg` for searching.
