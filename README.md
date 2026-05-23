# UWP

Procedurally rendered planets in the browser via WebGPU. Move the mouse to orbit,
scroll to zoom, open the ☰ panel to tune planet parameters or randomize the seed.

Live: <https://uwp.tre.systems>

## Stack

- **Rust → WebAssembly** for the renderer (`crates/planet-render`).
  Compiles to a `cdylib` consumed from JS via `wasm-bindgen`.
- **wgpu** drives WebGPU directly from the WASM module — no JS-side WebGPU code.
- **WGSL** for all three shaders (planet surface, atmosphere/tonemap, background).
- **Preact + Vite** for the UI shell, sliders and signal-driven param plumbing.
- **Cloudflare Workers** hosts the static bundle, custom domain
  `uwp.tre.systems`.

## Architecture at a glance

```
┌────────────────────────────────────────────────────────────────┐
│  src/  (Preact)                                                │
│    Canvas.tsx ──► wasm Planet.create / drag / zoom / setParams │
│       │                                                        │
│       └──► requestAnimationFrame → planet.render(t)            │
└──────────┬─────────────────────────────────────────────────────┘
           │ wasm-bindgen FFI
           ▼
┌────────────────────────────────────────────────────────────────┐
│  crates/planet-render/  (Rust + wgpu)                          │
│                                                                │
│  Pass 1: scene HDR target  (Rgba16Float)                       │
│    background.wgsl  (fullscreen triangle, depth_write)         │
│      └─ stars, Milky Way, raymarched moons/rings/satellites    │
│    planet.wgsl      (cubesphere mesh, displaced + lit)         │
│      └─ terrain, biomes, ocean BRDF, 3-layer clouds, lighting  │
│                                                                │
│  Pass 2: swapchain (sRGB)                                      │
│    atmosphere.wgsl  (fullscreen triangle)                      │
│      └─ raymarched Rayleigh + Mie + ozone scattering           │
│      └─ HDR bloom                                              │
│      └─ AGX display transform                                  │
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
| `npm run deploy`        | full release build + `wrangler deploy`                      |

Shader changes need `npm run build:wasm:dev` (or full `npm run dev`) then a
manual browser reload — Vite HMR can't reload a WASM module.

To validate WGSL syntax without a full WASM build:

```bash
cargo test --manifest-path crates/planet-render/Cargo.toml shaders_parse_and_validate
```

## Browser support

WebGPU is required. Chrome / Edge 113+ and Safari 18+ have it on by default;
Firefox needs `dom.webgpu.enabled` flipped. The renderer logs a clear message
to the on-page error overlay if `navigator.gpu` isn't available.
