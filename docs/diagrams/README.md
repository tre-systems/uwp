# Diagrams

Architecture diagrams for UWP. Two tools, by complexity:

- **Graphviz (`.dot`)** for the dense, multi-cluster diagrams that need precise
  layout control — like the system overview here. Sources live in this folder;
  rendered PNGs are committed alongside them so they show inline on GitHub.
- **Mermaid** for small flows. Those live inline in the Markdown (fenced
  ```` ```mermaid ```` blocks in `ARCHITECTURE.md`) and render natively on
  GitHub — no build step, no committed image.

## Diagrams here

| Source | Renders to | Shows |
| --- | --- | --- |
| `system-overview.dot` | `system-overview.png` | The whole client: Preact UI → Rust/WASM compute + render crate → WebGPU, plus the off-thread worker and URL/localStorage persistence. |

## Workflow

The `.dot` file is the source of truth; the `.png` is a committed render.

```sh
npm run diagrams        # render every docs/diagrams/*.dot → .png (needs Graphviz)
npm run check:diagrams  # verify each .dot still renders + its PNG exists
```

`check:diagrams` runs inside `npm run verify` (the pre-push gate and CI). It does
**not** byte-compare PNGs — Graphviz and libcairo emit different bytes across
versions, which would flag stale renders on every machine. It only checks that
each `.dot` parses and renders and that a committed PNG sits next to it. If you
edit a `.dot`, run `npm run diagrams` and commit the regenerated PNG. Without
Graphviz on PATH the check skips with a message, so docs-only work never blocks.

Install Graphviz with `brew install graphviz` (macOS) or
`apt-get install graphviz` (Debian/Ubuntu).

## Style

Keep new `.dot` files consistent with `system-overview.dot`:

- **Avenir** font throughout; 220 DPI render (`-Gdpi=220`); `splines=polyline`.
- Rounded, gradient-filled nodes (`fillcolor="#eaf3ff:#ffffff"`,
  `gradientangle=270`).
- One colour per cluster, used for both the cluster border and its nodes:
  **blue** = browser/UI, **amber** = worker, **green** = Rust/WASM crate,
  **purple** = WGSL shaders, **teal** = GPU / persistence.
- Cluster labels are HTML tables: a bold `POINT-SIZE="17"` title over a small
  muted one-line subtitle.
- Dashed edges for return/secondary flows (snapshots, persistence, probes).
