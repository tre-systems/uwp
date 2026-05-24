# UWP

Procedurally rendered Cepheus-style star systems in the browser via WebGPU.
Move the mouse to orbit, scroll to zoom, open the panel to tune planet
parameters, edit the UWP, or inspect the generated system.

Live: <https://uwp.tre.systems>

## Stack

- **Rust → WebAssembly** for the renderer (`crates/planet-render`).
  Compiles to a `cdylib` consumed from JS via `wasm-bindgen`.
- **wgpu** drives WebGPU directly from the WASM module — no JS-side WebGPU code.
- **WGSL** for the four render shaders: planet surface, atmosphere/tonemap,
  background, and system overview.
- **Preact + Vite** for the UI shell, typed app state, and renderer-client
  facade.
- **Cloudflare Workers** hosts the static bundle, custom domain
  `uwp.tre.systems`.

## Architecture at a glance

```
┌────────────────────────────────────────────────────────────────┐
│  src/  (Preact)                                                │
│    appState/      typed signals, actions, renderer commands    │
│    domain/        Cepheus UWP, system DTOs, main-world model   │
│    rendererClient wasm lifecycle, resize, frame loop, snapshots│
│    components/    presentation UI                              │
└──────────┬─────────────────────────────────────────────────────┘
           │ wasm-bindgen FFI
           ▼
┌────────────────────────────────────────────────────────────────┐
│  crates/planet-render/  (Rust + wgpu)                          │
│                                                                │
│  wasm_api.rs: typed browser boundary                           │
│  gpu.rs: device, surface and render pipeline setup             │
│  domain/system.rs: plausible stars, planets, belts             │
│  domain/climate.rs: Rust latitude-band climate simulation      │
│  scenes/system.rs: system uniform packing + camera fitting     │
│  scenes/detail.rs: detail targets + detail render pass         │
│                                                                │
│  Detail mode: scene HDR target → atmosphere/tonemap swapchain  │
│    background.wgsl + planet.wgsl + atmosphere.wgsl             │
│  System mode: one fullscreen system.wgsl pass to swapchain     │
└────────────────────────────────────────────────────────────────┘
```

For the full pipeline detail and every photoreal technique with citations,
see [RENDERING.md](RENDERING.md).

## Running locally

```bash
nvm use            # or install Node 24.x to match .nvmrc
npm install
npm run dev        # builds WASM (dev) then serves at http://localhost:5173
```

You need the Rust toolchain and `wasm-pack` for the WASM build:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain none
# rust-toolchain.toml then pins 1.88.0 + wasm32-unknown-unknown automatically

# wasm-pack — fetch the aarch64-darwin binary (the official installer ships
# x86_64 only). For Linux/x86 use `cargo install wasm-pack --locked`.
curl -sSL -o /tmp/wp.tar.gz \
  https://github.com/rustwasm/wasm-pack/releases/download/v0.14.0/wasm-pack-v0.14.0-aarch64-apple-darwin.tar.gz
tar xzf /tmp/wp.tar.gz -C /tmp
cp /tmp/wasm-pack-v0.14.0-aarch64-apple-darwin/wasm-pack ~/.cargo/bin/
```

## Scripts

| script                  | what it does                                                |
|-------------------------|-------------------------------------------------------------|
| `npm run dev`           | dev WASM build, then `vite` (HMR for TS, manual reload WASM)|
| `npm run build`         | release WASM, then `vite build` → `dist/`                   |
| `npm run preview`       | serve the production `dist/` locally                        |
| `npm run typecheck`     | TypeScript only (also rebuilds dev WASM for .d.ts)          |
| `npm test`              | Vitest unit tests for the TS layer                          |
| `npm run test:e2e`      | Playwright smoke tests against the production preview        |
| `npm run verify:fast`   | fast local gate used by the Husky pre-commit hook           |
| `npm run verify`        | full local gate used by the Husky pre-push hook             |
| `npm run deploy`        | full release build + `wrangler deploy`                      |

Husky installs Git hooks via `npm install`. The pre-commit hook runs the fast
gate: TS unit tests, Rust format, and native Rust check. The pre-push hook runs
the full gate: tests, typecheck, audit, Rust format/check/test/clippy for native
and wasm targets, the production build, then the Playwright smoke suite.

Shader changes need `npm run build:wasm:dev` (or full `npm run dev`) then a
manual browser reload — Vite HMR can't reload a WASM module.
WGSL chunks can be shared with `#include "chunks/name.wgsl"`; the renderer
validates the expanded shaders in Rust tests.

To validate WGSL syntax without a full WASM build:

```bash
cargo test --manifest-path crates/planet-render/Cargo.toml shaders_parse_and_validate
```

## Deployment

`main` auto-deploys to <https://uwp.tre.systems> via the CI workflow in
`.github/workflows/ci.yml`. Every push to `main` runs the full check suite,
then a separate `deploy` job downloads the build artifact and runs
`wrangler deploy`. PRs do not deploy.

Required GitHub Actions secrets on the repo:

- `CLOUDFLARE_API_TOKEN` — Workers Edit scope on the `uwp` worker.
- `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account ID.

A manual deploy from a developer machine is still supported via
`npm run deploy`; it rebuilds and pushes the local working tree.

### Verifying the live build after deploy

Every build is stamped with a build ID composed from the commit SHA (when
built in CI) or the local git short SHA (when built locally). The ID is:

- Logged to the browser console on startup: `UWP build <id>`.
- Exposed as `window.__UWP_BUILD_ID` for manual or automated probing.

Once a CI deploy completes, opening <https://uwp.tre.systems> serves the
new build with at most a single in-page reload because:

- Hashed JS/CSS/WASM filenames force a network fetch on content change.
- `public/_headers` instructs Cloudflare to serve `index.html`, `sw.js`,
  `registerSW.js`, and `manifest.webmanifest` with `Cache-Control:
  no-cache`, so the entry document and service worker are always
  revalidated at the HTTP layer.
- VitePWA's service worker is configured with `skipWaiting` +
  `clientsClaim`, so a new SW activates and takes over open tabs the
  moment it installs.
- `src/buildId.ts::installServiceWorkerAutoReload()` listens for the
  `controllerchange` event the new SW fires when it claims the tab, and
  reloads the page once. This is the piece that prevents the user from
  sitting on a stale shell.

Without the auto-reload, the SW's NavigationRoute handler would keep
serving the precached old `index.html` for every navigation — bypassing
the HTTP `no-cache` header — and the running page would only see the
new build after a manual refresh. The reload happens at most once per
deploy per tab, and only when the user has an active SW from a previous
visit. Fresh first-time visitors hit the new build directly.

If a returning user still sees an old build, the fastest diagnostic is
to read `window.__UWP_BUILD_ID` in the console — that exposes the
running build regardless of how it was loaded.

## Browser support

WebGPU is required. Chrome / Edge 113+ and Safari 18+ have it on by default;
Firefox needs `dom.webgpu.enabled` flipped. The renderer logs a clear message
to the on-page error overlay if `navigator.gpu` isn't available. Runtime
frame-time monitoring can also downshift render quality on devices that start
slower than their initial capability profile suggested.
