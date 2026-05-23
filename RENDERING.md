# Rendering pipeline

This document maps the planet renderer's architecture, lists every photoreal
technique it uses, and points each one back to the paper or implementation
it follows. It's meant to be enough that someone picking up the codebase
cold can find the code for a given visual feature and understand *why* the
constants are what they are.

## Pipeline overview

The renderer is **two passes** writing into two render targets:

1. **Scene pass** → `Rgba16Float` HDR colour texture (`scene_view`) + a
   `Depth32Float` depth texture. The HDR target keeps all per-pixel values in
   scene-linear space so the tonemap step downstream can do its work
   correctly.
2. **Atmosphere pass** → swapchain (`sRGB`). Reads `scene_view` and
   `scene_depth`, integrates atmospheric scattering along the view ray, adds
   bloom, applies the AGX display transform.

```
                    scene_view  (Rgba16Float HDR linear)
                    scene_depth (Depth32Float)
                          ▲   ▲
  background.wgsl  ──────┘   │
    fullscreen triangle      │
    writes depth per pixel   │
                             │
  planet.wgsl     ────────────┘
    cubesphere mesh
    Less depth test/write
                          │
                          ▼
                    atmosphere.wgsl
                    fullscreen triangle
                    samples scene_view + scene_depth
                          │
                          ▼
                    swapchain (sRGB display)
```

Drawing the background **before** the planet, with both writing depth, is
what lets the planet mesh occlude the far side of a Saturn-style ring or
hide moons orbiting behind it — depth ordering is per-pixel rather than
per-pass.

## Coordinate frames

- `dir` — unit direction on the cubesphere in **model-local** space. The
  same `dir` for a given continent is stable across rotation; the planet
  spins around its model-Y axis and is then tilted into world space by
  `u.model`. All terrain noise samples `dir`, so continents move with the
  planet rather than the camera.
- `world_pos`, `world_normal` — model × local, used for lighting and view
  reconstruction in atmosphere/background passes.
- `sun_dir_local`, `view_dir_local` — sun and view directions transformed
  back into model space by `transpose(u.model)` (since model is a rotation,
  transpose = inverse). Used so cloud shadows and cloud parallax respect
  the planet's rotation.

## Shaders

### `common.wgsl`

The shared uniform block. `shader.rs::shader_with_common()` prepends it to
every WGSL shader at compile time, so every shader sees the same layout
without redeclaration.

### `background.wgsl`

A fullscreen triangle that runs **before** the planet mesh and writes
per-pixel depth (`@builtin(frag_depth)`) for everything it draws — so the
planet correctly occludes whatever sits behind it.

Responsibilities:
- **Starfield** (celestial-sphere sampled, see *Stars* below)
- **Milky Way band** (faint tilted noise stripe)
- **Moons** — raymarched spheres on orbital shells (1.7×, 2.8×, 3.9× planet
  radius), each with multi-octave surface noise (highlands + maria).
  Per-planet count from a seed hash: ~40 % 0 moons, 35 % 1, 20 % 2, 5 % 3.
- **Rings** — ray–plane intersection in the planet's equatorial plane (so
  rings tilt with the axial inclination), banded density via stacked sines
  for Cassini-division feel. ~28 % of planets get rings.
- **Satellites** — great-circle Kepler orbits, count scales with the
  population_intensity param. Rendered as ~1 px gaussian pinpoints.

### `planet.wgsl`

The cubesphere mesh. Vertex shader displaces along the normal using the
terrain field. Fragment shader recomputes the field per-pixel for stable
continent scale (the mesh density isn't fine enough to carry continents
without aliasing), builds biome colour, lights it, layers clouds, and
emits HDR linear colour.

### `atmosphere.wgsl`

Fullscreen triangle. Reconstructs a world-space ray per pixel from
`inv_view_proj`, integrates Rayleigh + Mie + ozone in-scattering along the
ray (capped by `scene_depth` so opaque objects in front of the atmosphere
don't get veiled), composites:

    final = planet_color * transmittance + scatter

then adds HDR bloom and finally applies AGX.

## Photoreal techniques

### Terrain field

Implemented in `terrain_field()` in `planet.wgsl`.

- **Domain-warped fbm continents.** A vec3 fbm offset perturbs the input
  point before sampling the main fbm. Round noise blobs become organic
  shorelines with peninsulas, bays and isthmuses. Standard technique;
  popularised by Iñigo Quílez's *Domain warping* article (2002).
- **Plate-tectonics ridges.** 3D Voronoi gives F1/F2 distances; (F2 − F1)
  is small along plate boundaries. The boundary network is gated by a
  low-frequency "chain mask" so most edges stay silent — only a handful
  become real Andes/Himalaya-scale chains. The Voronoi input is
  domain-warped so boundaries bend instead of running as straight
  piecewise-linear segments.
- **Worley craters.** 3 stacked scales (huge basins → small pits) with a
  cosine bowl + raised rim profile. Density controlled by the
  `crater_density` param.
- **Per-pixel finite-difference normals.** Tangent-space gradients of the
  terrain field give a smooth normal field with continent-scale relief.
  Plus a small fbm perturbation gives flat plateaus and mountain flanks
  visible micro-shading.

### Biome layering

In the fragment shader's land branch:

- `coast` smoothstep at the waterline.
- `tree_line` and `snow_jitter` — per-area variable thresholds via fbm, so
  caps and tree lines don't sit at one global elevation.
- Vegetation: zone fbm + patch fbm → forest / grass / savanna mix. Gated
  by tree-line and coastline.
- Desert: subtropical latitude band (Hadley-cell aridity) + occasional
  Sahara-scale patches + continental-interior dryness, latitude-gated.
- Slope-based exposed rock (cliffs, river banks).
- Beach: thin bright sand strip at the waterline, suppressed on dry worlds.
- Rivers: ridged fbm in flat low-elevation valleys; suppressed in deserts
  and on worlds with very little surface water.
- Snow: elevation snow line + ragged polar cap (large lobe + small finger
  fields combined, so the edge isn't a clean smoothstep ring).

### Ocean

- **Three-tone water** by depth: turquoise shallow shelves → ocean blue
  mid-depth → deep navy abyss.
- **Wave shimmer.** Subtle moving fbm normal perturbation (~1°) so the
  ocean surface lives instead of reading as a mirror.
- **Sea-ice cap.** Same lobe + finger noise as the land snow cap, so the
  two halves meet correctly at the coast.
- **Schlick Fresnel sky reflection.** Limb of the ocean reflects sky.
  Strength capped so the limb doesn't become a bright ring.
- **Anisotropic GGX sun glint** (Heitz 2014, *Understanding the
  Masking-Shadowing Function in Microfacet-Based BRDFs*):

      D(h) = 1 / (π · α_t · α_b · (h_t²/α_t² + h_b²/α_b² + h_n²)²)
      spec = D · F_schlick / (4 · n·v)

  Tangent frame aligned to the planet's east direction (α_t = 0.13,
  α_b = 0.28) stretches the highlight along the equator — matching the
  along-wind / cross-wind slope-variance ratio Cox & Munk measured for
  real ocean wave statistics (1954).

### Clouds (three layers, bottom up)

- **Main cumulus deck.** Two-stage domain warp:
  1. Translational fbm offset (0.10 magnitude) breaks the underlying fbm
     grid into fluid masses.
  2. **Curl-like rotational warp** in the tangent plane around each
     sample point. Per-location angle from a low-freq fbm gives cyclonic
     swirl (storms, fronts, hurricanes). Approximates curl noise
     (Bridson 2007) without the finite-difference cost.
  Density is `fbm + ridged_fbm` driven through a narrow smoothstep band
  so cumulus edges are crisp.
- **Two-tap volumetric self-shadow.** Sample the cloud field at two
  offsets toward the sun (close and far). The close tap reads as the
  shadow side of a cumulus; the far tap reads as the bulk above. Together
  they sell 3D depth.
- **Anvil-top boost.** `smoothstep(0.72, 0.95, density) * sun_mask` adds
  40 % intensity to the densest cumulus tops — flat bright cumulonimbus
  anvils as seen from above.
- **Silver lining.** Mid-density edges read brighter than the dense centre.
- **Cloud shadow on surface.** Same cloud field sampled offset toward the
  sun in local frame, multiplied into the surface diffuse term.
- **Mid-altitude broken cumulus** layer. Smaller cells, different drift
  direction, view-direction parallax of ~2.5 % planet radius so the layer
  visibly slides past the deck near the limb.
- **High cirrus** layer. Thin streaky east-west compressed noise with a
  larger parallax offset (~5.5 % planet radius).

### Lighting & city lights

- Diffuse: surface × (ambient + n·l · shadow_factor) where the cloud
  shadow modulates n·l.
- City lights: only on the night side (`pow(1 − n·l, 3)`), only on
  habitable land (excludes alpine, snow, deep desert), clustered via
  two-scale fbm. Warm sodium tint, scaled into HDR so bloom catches the
  densest cores.
- Warm terminator band: a tight smoothstep around n·l ∈ [0, 0.4] adds a
  pink-orange tint, giving the day-night boundary the long-path
  atmospheric warmth Earth-from-space photos show.

### Atmospheric scattering

`atmosphere.wgsl` integrates a Bruneton & Neyret 2008-style scattering
model along the view ray with **12 view steps** and **4 light steps**.

- **Rayleigh** for the blue scatter. β_R = (3.5, 8.5, 19.5) × atmosphere
  density, tinted by the user atmosphere colour. The wavelength ratio is
  roughly 1 : 0.43 : 0.18 (B : G : R), matching Earth's atmospheric
  Rayleigh.
- **Mie** for the forward-scattering haze. β_M = 3.8, g = 0.76.
  Phase-function peak clamped at 1.8 so looking directly through the
  atmosphere at the sun doesn't punch a white-hot circle through the
  planet via bloom.
- **Ozone absorption.** Tent density profile centred on 25-km-equivalent
  altitude, half-width 15 km. β_O = (0.650, 1.881, 0.085) — the
  characteristic absorption notch that gives Earth's twilight its
  warm-pink lower band and deep-blue zenith (Hillaire 2020).
- **Multi-scatter approximation.** Hillaire-style: a constant 12 %
  fraction of single-scatter, representing the second-order skylight
  bounce. Lifts the dim hemisphere of the atmosphere without needing a
  precomputed LUT.

### Bloom

12-tap two-ring sample of the HDR scene around each pixel, hard threshold
at linear 1.25 (well above sRGB-1.0 so only truly burning highlights
bloom: sun glint, sun-disk forward scatter, brightest cloud tops). Plus a
small additive bloom of the scatter term itself for the sun-disk halo.

### AGX display transform

After Troy Sobotka's AgX (the default View Transform in Blender 4.x).
Polynomial fit by bwrensch:

    s = +15.5 x⁶ − 40.14 x⁵ + 31.96 x⁴ − 6.868 x³
        + 0.4298 x² + 0.1191 x − 0.00232

Input matrix maps linear sRGB → AgX log space; output matrix inverts
back to linear sRGB; the swapchain handles the final sRGB gamma encode.

**EV range narrowed** from the canonical [-12.47, +4.03] to **[-8, +4.03]**
because our scene has lots of near-black pixels (deep space, night side)
and the canonical AgX toe would lift them to a noticeable grey. The
narrower bottom keeps blacks black while preserving the filmic highlight
roll-off.

### Stars

Sampled on the **celestial sphere** via `(lon, lat)` derived from the view
ray, so stars stay anchored to the sky and visibly rotate as the camera
orbits the planet.

- Three populations at different cell scales (28, 72, 180 cells per
  unit) and densities (6 %, 3 %, 1.4 %). Rare bright giants, common mid,
  dense dim — log-normal-ish brightness via `pow(h, 6)`.
- **Gaussian PSF.** Tight gaussian core (σ = 0.012 cell-units) so stars
  read as pixel-scale points, plus a wider gaussian halo on the brightest
  population only.
- **Stellar colour temperature** mapped through three reference colours
  (M-class red, G-class sun, B-class blue), biased toward sun-like —
  most main-sequence stars in any patch of sky are FGK.
- **Twinkle** — small per-star phase-offset sine modulation of intensity.

### Milky Way band

A faint noise-modulated stripe across the celestial sphere, tilted 32°
from the planet's equator. fbm-driven brightness with dust lanes, tinted
warm-pink (H-α emission) at the core and cool blue at the edges. Maximum
brightness kept very low (~0.018 linear) so AgX doesn't dominate stars
with the band.

## Param surface

`crates/planet-render/src/params.rs` defines `PlanetParams`. The Rust
struct is sent via `serde-wasm-bindgen` from the Preact UI; per-frame the
renderer packs it into a `uniform`. Notable knobs:

| param                  | what it drives                                       |
|------------------------|------------------------------------------------------|
| `seed`                 | three noise offsets + axial tilt direction/angle     |
| `sea_level`            | sea level in [0, 1]; biome thresholds normalize to it |
| `mountain_height`      | terrain amplitude                                    |
| `noise_frequency`      | continent scale + cloud frequency                    |
| `noise_octaves`        | fbm depth for the terrain field                      |
| `atmosphere_density`   | scales Rayleigh/Mie/ozone coefficients               |
| `atmosphere_color`     | Rayleigh tint                                        |
| `ocean_color`          | ocean palette (depth gradient is derived)            |
| `land_color`           | vegetation base palette                              |
| `mountain_color`       | alpine + cliff rock                                  |
| `sand_color`           | beach + desert palette                               |
| `snow_color`           | ice cap                                              |
| `ice_latitude`         | polar cap extent                                     |
| `sun_angle`            | sun yaw in [0, 1] (× 2π)                             |
| `auto_rotate`          | radians per second around the model-Y axis           |
| `cloud_coverage`       | smoothstep edge of the cloud density band            |
| `crater_density`       | Worley crater contribution                           |
| `population_intensity` | city-light intensity + satellite count               |
| `vegetation_richness`  | turns continents from Mars to lush Earth             |
| `atm_banding`          | compresses cloud longitude → Jupiter-band stripes    |
| `planet_radius`        | display radius; camera minimum distance scales       |

## References

- Bruneton, E. and Neyret, F. (2008). *Precomputed Atmospheric Scattering.*
  Eurographics Symposium on Rendering.
- Hillaire, S. (2020). *A Scalable and Production Ready Sky and Atmosphere
  Rendering Technique.* HPG.
- Heitz, E. (2014). *Understanding the Masking-Shadowing Function in
  Microfacet-Based BRDFs.* JCGT.
- Cox, C. and Munk, W. (1954). *Measurement of the Roughness of the Sea
  Surface from Photographs of the Sun's Glitter.* JOSA.
- Bridson, R. (2007). *Curl-Noise for Procedural Fluid Flow.* SIGGRAPH.
- Sobotka, T. AgX. <https://github.com/sobotka/AgX>
- Quílez, I. (2002). *Domain warping.* <https://iquilezles.org/articles/warp/>
