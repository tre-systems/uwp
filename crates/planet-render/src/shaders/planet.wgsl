// Procedural planet shader.
//
// Vertex shader displaces the cubesphere mesh along its normal using FBM noise.
// Fragment shader recomputes the height field for per-pixel normals, blends biome
// colors, lights with a directional sun, layers procedural clouds, and adds a
// Fresnel atmosphere rim. Output is linear; framebuffer is sRGB so gamma is automatic.

@group(1) @binding(0) var terrain_atlas: texture_2d<f32>;
// Biome atlas: one u8 enum id per cell. Single source of truth for
// surface classification — the globe samples this instead of running
// vegetation / desert / snow noise stacks in-shader. The same id maps
// to the same colour table on the surface map and the region view, so
// the three views agree pixel-for-pixel.
@group(1) @binding(1) var biome_atlas: texture_2d<u32>;

// ---------- Noise ----------

fn hash3(p: vec3<f32>) -> vec3<f32> {
    let q = vec3<f32>(
        dot(p, vec3<f32>(127.1, 311.7,  74.7)),
        dot(p, vec3<f32>(269.5, 183.3, 246.1)),
        dot(p, vec3<f32>(113.5, 271.9, 124.6))
    );
    return -1.0 + 2.0 * fract(sin(q) * 43758.5453123);
}

fn noise3(p: vec3<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let w = f * f * (3.0 - 2.0 * f);

    let n000 = dot(hash3(i + vec3<f32>(0.0, 0.0, 0.0)), f - vec3<f32>(0.0, 0.0, 0.0));
    let n100 = dot(hash3(i + vec3<f32>(1.0, 0.0, 0.0)), f - vec3<f32>(1.0, 0.0, 0.0));
    let n010 = dot(hash3(i + vec3<f32>(0.0, 1.0, 0.0)), f - vec3<f32>(0.0, 1.0, 0.0));
    let n110 = dot(hash3(i + vec3<f32>(1.0, 1.0, 0.0)), f - vec3<f32>(1.0, 1.0, 0.0));
    let n001 = dot(hash3(i + vec3<f32>(0.0, 0.0, 1.0)), f - vec3<f32>(0.0, 0.0, 1.0));
    let n101 = dot(hash3(i + vec3<f32>(1.0, 0.0, 1.0)), f - vec3<f32>(1.0, 0.0, 1.0));
    let n011 = dot(hash3(i + vec3<f32>(0.0, 1.0, 1.0)), f - vec3<f32>(0.0, 1.0, 1.0));
    let n111 = dot(hash3(i + vec3<f32>(1.0, 1.0, 1.0)), f - vec3<f32>(1.0, 1.0, 1.0));

    let nx00 = mix(n000, n100, w.x);
    let nx10 = mix(n010, n110, w.x);
    let nx01 = mix(n001, n101, w.x);
    let nx11 = mix(n011, n111, w.x);
    let nxy0 = mix(nx00, nx10, w.y);
    let nxy1 = mix(nx01, nx11, w.y);
    return mix(nxy0, nxy1, w.z);
}

fn fbm(p_in: vec3<f32>, octaves: i32) -> f32 {
    var p = p_in;
    var v = 0.0;
    var amp = 0.5;
    var norm = 0.0;
    let oct = max(octaves, 1);
    for (var i: i32 = 0; i < oct; i = i + 1) {
        v = v + amp * noise3(p);
        norm = norm + amp;
        amp = amp * 0.5;
        p = p * 2.07;
    }
    return v / norm;
}

fn ridged_fbm(p_in: vec3<f32>, octaves: i32) -> f32 {
    var p = p_in;
    var v = 0.0;
    var amp = 0.5;
    var norm = 0.0;
    let oct = max(octaves, 1);
    for (var i: i32 = 0; i < oct; i = i + 1) {
        let n = 1.0 - abs(noise3(p));
        v = v + amp * n * n;
        norm = norm + amp;
        amp = amp * 0.5;
        p = p * 2.05;
    }
    return v / norm;
}

// Scalar hash from a 3D integer-ish cell coordinate.
fn hash3_s(p: vec3<f32>) -> f32 {
    return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
}

// Worley-style cratering. For each of the 27 cells near `p` (in cell space),
// pick a random crater position + radius, find the closest one. Each crater
// then has its own per-seed shape parameters: irregular rim outline, optional
// central peak, slight elliptical squash. This breaks the "perfectly circular"
// look you'd get from a plain Worley distance field — real craters have
// scalloped rims (terraced slumping), oblique-impact ellipses, and complex
// crater central peaks (Tycho, Copernicus, Tsiolkovsky).
fn crater_layer(p: vec3<f32>, scale: f32, depth: f32) -> f32 {
    let sp = p * scale;
    let ip = floor(sp);
    let fp = fract(sp);
    var best_r = 1e9;
    var best_norm = 0.0;
    var best_seed: f32 = 0.0;
    var best_local: vec3<f32> = vec3<f32>(0.0);
    var best_radius: f32 = 1.0;
    for (var z = -1; z <= 1; z = z + 1) {
        for (var y = -1; y <= 1; y = y + 1) {
            for (var x = -1; x <= 1; x = x + 1) {
                let offs = vec3<f32>(f32(x), f32(y), f32(z));
                let cell = ip + offs;
                let jitter = vec3<f32>(
                    hash3_s(cell),
                    hash3_s(cell + vec3<f32>(31.7, 17.3, 9.1)),
                    hash3_s(cell + vec3<f32>(71.1, 43.1, 19.7)),
                );
                let centre = offs + jitter;
                let radius = hash3_s(cell + vec3<f32>(113.3, 7.1, 51.9)) * 0.45 + 0.10;
                // Anisotropic stretch — oblique impacts produce elliptical
                // craters. Per-crater axis hash gives each one its own angle
                // and elongation ratio (mostly mild, occasionally extreme).
                let axis_h = hash3_s(cell + vec3<f32>(17.0, 41.0, 89.0));
                let stretch_h = hash3_s(cell + vec3<f32>(91.0, -23.0, 7.0));
                let axis_ang = axis_h * 6.2831853;
                let ax = vec3<f32>(cos(axis_ang), 0.0, sin(axis_ang));
                let ay = vec3<f32>(-sin(axis_ang), 0.0, cos(axis_ang));
                let local = centre - fp;
                let lx = dot(local, ax);
                let ly = dot(local, ay);
                let lz = local.y;
                let stretch = 1.0 + (stretch_h - 0.5) * 0.35;  // 0.825 .. 1.175
                let d = sqrt(lx * lx / (stretch * stretch) + ly * ly + lz * lz * stretch * stretch);
                let normalised = d / radius;
                if (normalised < 1.0 && d < best_r) {
                    best_r = d;
                    best_norm = normalised;
                    best_seed = hash3_s(cell + vec3<f32>(53.7, 19.1, 71.3));
                    best_local = local;
                    best_radius = radius;
                }
            }
        }
    }
    if (best_r >= 1e9) { return 0.0; }
    // Rim irregularity. Each crater's rim is perturbed by a per-crater noise
    // field driven by the azimuth angle around the crater centre. The
    // perturbation shifts the rim radius inward/outward by a few percent,
    // turning the clean circle into a scalloped polygon.
    let rim_freq = 4.0 + best_seed * 6.0;
    let rim_phase = best_seed * 6.2831853;
    let azimuth = atan2(best_local.z, best_local.x);
    let rim_pert = sin(azimuth * rim_freq + rim_phase) * 0.08
                 + sin(azimuth * (rim_freq * 0.4 + 1.7)) * 0.05;
    let r = best_norm * (1.0 + rim_pert);
    if (r >= 1.0) { return 0.0; }
    // Bowl up to r=0.85, then a raised rim that smoothly tapers back to 0 by r=1.
    if (r < 0.85) {
        let t = r / 0.85;
        // Smooth cosine bowl — flat-bottomed at r=0, lifts back to 0 at the rim base.
        var bowl = -0.5 * (1.0 + cos(t * 3.14159265));
        // Central peak for large complex craters. Real lunar craters >~15 km
        // diameter have rebound peaks; we trigger on absolute radius and only
        // raise a peak in the inner ~25 % of the bowl. The peak height is
        // bounded so it doesn't pierce the rim. About 50 % of craters get a
        // peak (large-impact stochastic process, modelled by a hash gate).
        let big = smoothstep(0.30, 0.55, best_radius) * step(0.45, best_seed);
        let peak_inner = 1.0 - smoothstep(0.0, 0.22, t);
        bowl = bowl + peak_inner * peak_inner * big * 0.55;
        return bowl * depth;
    }
    let t = (r - 0.85) / 0.15;
    // Rim ring with the same azimuthal noise so the rim crest also scallops.
    let ring = sin(t * 3.14159265);
    return ring * depth * 0.55;
}

fn craters(dir: vec3<f32>) -> f32 {
    let density = u.world_features.x;
    if (density <= 0.01) { return 0.0; }
    let seed_off = u.seed_block.xyz * 0.31;
    let p = dir + seed_off;
    // Three scales: a few huge basins, many medium craters, lots of small pits.
    let big = crater_layer(p, 1.8, 0.10);
    let mid = crater_layer(p, 5.5, 0.05);
    let pit = crater_layer(p, 14.0, 0.025);
    return (big + mid + pit) * density;
}

// 3D Voronoi for plate-tectonics emulation. Returns (F1, F2): distance to the
// nearest "plate centre" and to the second-nearest. Points where F1 ≈ F2 sit
// on a plate boundary — that's where real mountain chains form when plates
// converge. We use jittered grid cells (same scheme as craters) so the
// boundary network forms irregular polygons across the sphere.
fn plate_voronoi(p: vec3<f32>) -> vec2<f32> {
    let ip = floor(p);
    let fp = fract(p);
    var f1 = 9.0;
    var f2 = 9.0;
    for (var z = -1; z <= 1; z = z + 1) {
        for (var y = -1; y <= 1; y = y + 1) {
            for (var x = -1; x <= 1; x = x + 1) {
                let offs = vec3<f32>(f32(x), f32(y), f32(z));
                let cell = ip + offs;
                let jitter = vec3<f32>(
                    hash3_s(cell),
                    hash3_s(cell + vec3<f32>(31.7, 17.3, 9.1)),
                    hash3_s(cell + vec3<f32>(71.1, 43.1, 19.7))
                );
                let p_cell = offs + jitter;
                let d = length(p_cell - fp);
                if (d < f1) {
                    f2 = f1;
                    f1 = d;
                } else if (d < f2) {
                    f2 = d;
                }
            }
        }
    }
    return vec2<f32>(f1, f2);
}

fn ray_sphere(orig: vec3<f32>, dir: vec3<f32>, radius: f32) -> vec2<f32> {
    let b = dot(orig, dir);
    let c = dot(orig, orig) - radius * radius;
    let h = b * b - c;
    if (h < 0.0) { return vec2<f32>(-1.0, -1.0); }
    let s = sqrt(h);
    return vec2<f32>(-b - s, -b + s);
}

// Authoritative terrain field. The Rust pre-bake is uploaded as a small
// raw-height atlas: -1 = low basin, +1 = highland. The signed sea-height
// quantile is packed separately in the uniform so the hydrographics slider
// remains an intended water fraction while relief stays smooth.
fn terrain_field(dir: vec3<f32>) -> f32 {
    let dims = textureDimensions(terrain_atlas);
    let w = i32(dims.x);
    let h = i32(dims.y);

    let lat = asin(clamp(dir.y, -1.0, 1.0));
    let lon = atan2(dir.z, dir.x);
    // Atlas samples are baked at texel centres. Convert the normalized
    // spherical coordinate to centre-aligned texel space so the globe,
    // surface map, and Rust sampler agree at coastlines.
    let lat_u = clamp((clamp(lat / 3.14159265359 + 0.5, 0.0, 1.0) * f32(h)) - 0.5, 0.0, f32(h - 1));
    let lon_u = fract(lon / 6.28318530718 + 0.5) * f32(w) - 0.5;
    let lon_floor = floor(lon_u);

    let i0 = i32(floor(lat_u));
    let i1 = min(i0 + 1, h - 1);
    let j0 = ((i32(lon_floor) % w) + w) % w;
    let j1 = (j0 + 1) % w;
    let fi = fract(lat_u);
    let fj = lon_u - lon_floor;

    let h00 = textureLoad(terrain_atlas, vec2<i32>(j0, i0), 0).x;
    let h01 = textureLoad(terrain_atlas, vec2<i32>(j1, i0), 0).x;
    let h10 = textureLoad(terrain_atlas, vec2<i32>(j0, i1), 0).x;
    let h11 = textureLoad(terrain_atlas, vec2<i32>(j1, i1), 0).x;
    let h0 = mix(h00, h01, fj);
    let h1 = mix(h10, h11, fj);
    return mix(h0, h1, fi);
}

fn relief_above_sea(h: f32, sea_h: f32) -> f32 {
    let above = max(h - sea_h, 0.0);
    // Ease the first few metres of coastline into the base sphere so the
    // pre-baked waterline does not create a visible vertical wall on the mesh.
    return above * smoothstep(0.0, 0.08, above);
}

// Sample the canonical biome id for a sphere direction. Categorical, so
// nearest-neighbour — used for biome flags (alpine / snow / desert) and
// for the slope-rock and lighting masks. Per-cell colour blending uses
// `biome_color_blended` below to avoid hard pixel borders.
fn biome_id_at(dir: vec3<f32>) -> u32 {
    let dims = textureDimensions(biome_atlas);
    let w = i32(dims.x);
    let h = i32(dims.y);
    let lat = asin(clamp(dir.y, -1.0, 1.0));
    let lon = atan2(dir.z, dir.x);
    let lat_norm = clamp(lat / 3.14159265 + 0.5, 0.0, 1.0);
    let lon_norm = fract(lon / 6.28318530 + 0.5);
    let i = min(i32(lat_norm * f32(h)), h - 1);
    let j = min(i32(lon_norm * f32(w)), w - 1);
    return textureLoad(biome_atlas, vec2<i32>(j, i), 0).x;
}

// Bilinear-weighted blend of the four nearest biome palette colours.
// Cheap (four palette lookups, four mixes) and kills the visible texel
// boundaries you'd otherwise see at biome borders — most obviously on
// the polar caps. Biome ids themselves stay categorical for downstream
// mask logic.
fn biome_color_blended(dir: vec3<f32>) -> vec3<f32> {
    let dims = textureDimensions(biome_atlas);
    let w = i32(dims.x);
    let h = i32(dims.y);
    let lat = asin(clamp(dir.y, -1.0, 1.0));
    let lon = atan2(dir.z, dir.x);
    // Centre-aligned texel sampling so the four nearest cells we blend
    // are spaced symmetrically around the view-ray direction.
    let lat_u = clamp((clamp(lat / 3.14159265 + 0.5, 0.0, 1.0) * f32(h)) - 0.5, 0.0, f32(h - 1));
    let lon_u = fract(lon / 6.28318530 + 0.5) * f32(w) - 0.5;
    let lon_floor = floor(lon_u);
    let i0 = i32(floor(lat_u));
    let i1 = min(i0 + 1, h - 1);
    let j0 = ((i32(lon_floor) % w) + w) % w;
    let j1 = (j0 + 1) % w;
    let fi = fract(lat_u);
    let fj = lon_u - lon_floor;
    let b00 = textureLoad(biome_atlas, vec2<i32>(j0, i0), 0).x;
    let b01 = textureLoad(biome_atlas, vec2<i32>(j1, i0), 0).x;
    let b10 = textureLoad(biome_atlas, vec2<i32>(j0, i1), 0).x;
    let b11 = textureLoad(biome_atlas, vec2<i32>(j1, i1), 0).x;
    let c00 = biome_color(b00);
    let c01 = biome_color(b01);
    let c10 = biome_color(b10);
    let c11 = biome_color(b11);
    let c0 = mix(c00, c01, fj);
    let c1 = mix(c10, c11, fj);
    return mix(c0, c1, fi);
}

// Canonical biome palette. Mirrors the Rust `BiomeId` enum order. The
// palette is built from the player-tweakable PlanetParams base colours
// so adjusting `land_color` shifts every land biome consistently. The
// same lookup is duplicated in the TS palette for the surface map and
// region view — if you change a colour here, change it there too.
fn biome_color(id: u32) -> vec3<f32> {
    if (id == 0u) { return u.ocean_color.rgb * 0.34; }                                   // DeepOcean
    if (id == 1u) { return u.ocean_color.rgb * 1.55; }                                   // ShallowOcean
    if (id == 2u) { return mix(u.sand_color.rgb, u.land_color.rgb, 0.40); }              // Shore
    if (id == 3u) { return u.land_color.rgb; }                                           // Plain
    if (id == 4u) { return u.land_color.rgb * vec3<f32>(1.10, 1.10, 0.90); }             // Grassland
    if (id == 5u) { return u.land_color.rgb * vec3<f32>(0.55, 0.68, 0.50); }             // Forest
    if (id == 6u) { return mix(u.land_color.rgb, u.sand_color.rgb, 0.70); }              // Savanna
    if (id == 7u) { return u.sand_color.rgb; }                                           // Desert
    if (id == 8u) { return mix(u.land_color.rgb, u.mountain_color.rgb, 0.30); }          // Hills
    if (id == 9u) { return u.mountain_color.rgb; }                                       // Mountain
    if (id == 10u) { return mix(u.mountain_color.rgb, u.snow_color.rgb, 0.20); }         // AlpineRock
    if (id == 11u) { return u.snow_color.rgb; }                                          // Snow
    if (id == 12u) { return mix(u.snow_color.rgb * 0.85, u.mountain_color.rgb * 0.70, 0.40); } // Tundra
    if (id == 13u) { return u.snow_color.rgb * 0.94; }                                   // Ice
    if (id == 14u) { return vec3<f32>(0.10, 0.07, 0.05); }                               // Volcanic
    return u.mountain_color.rgb * 0.85;                                                  // Barren
}

fn biome_is_ocean(id: u32) -> bool { return id == 0u || id == 1u; }
fn biome_is_ice(id: u32) -> bool { return id == 11u || id == 13u; }
fn biome_is_alpine(id: u32) -> bool { return id == 9u || id == 10u || id == 11u; }
fn biome_is_desert(id: u32) -> bool { return id == 7u; }
fn biome_is_vegetated(id: u32) -> bool { return id == 4u || id == 5u || id == 8u; }

// ---------- Vertex ----------

struct VsIn {
    @location(0) position: vec3<f32>,
};

struct VsOut {
    @builtin(position) position: vec4<f32>,
    @location(0) world_pos: vec3<f32>,
    @location(1) sphere_dir: vec3<f32>,
    @location(2) @interpolate(linear) ndc: vec2<f32>,
};

@vertex
fn vs_main(in: VsIn) -> VsOut {
    let dir = normalize(in.position);
    let h = terrain_field(dir);

    let sea_h        = u.planet_params.z;
    let mountain_amp = u.planet_params.y;
    let above        = relief_above_sea(h, sea_h);
    let base_radius  = u.resolution.w;
    let radius       = base_radius + above * mountain_amp * base_radius;
    let local_pos    = dir * radius;

    let world = (u.model * vec4<f32>(local_pos, 1.0)).xyz;

    var o: VsOut;
    let clip = u.view_proj * vec4<f32>(world, 1.0);
    o.position = clip;
    o.world_pos = world;
    o.sphere_dir = dir;
    o.ndc = clip.xy / clip.w;
    return o;
}

// ---------- Fragment ----------
// Output is HDR linear — the atmosphere pass tonemaps everything for display.

fn surface_dir_from_screen(ndc: vec2<f32>, fallback: vec3<f32>) -> vec3<f32> {
    let ndc_near = vec4<f32>(ndc, 0.0, 1.0);
    let ndc_far  = vec4<f32>(ndc, 1.0, 1.0);
    let w_near = u.inv_view_proj * ndc_near;
    let w_far  = u.inv_view_proj * ndc_far;
    let p_near = w_near.xyz / w_near.w;
    let p_far  = w_far.xyz / w_far.w;
    let ray_origin = u.camera_pos.xyz;
    let ray_dir = normalize(p_far - p_near);

    let hit = ray_sphere(ray_origin, ray_dir, u.resolution.w);
    if (hit.x > 0.0) {
        let world_hit = ray_origin + ray_dir * hit.x;
        return normalize((transpose(u.model) * vec4<f32>(world_hit, 0.0)).xyz);
    }

    return normalize(fallback);
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    // Sample the procedural surface from the actual view ray instead of from
    // interpolated mesh attributes. That keeps continent scale stable across
    // the globe while the mesh continues to provide depth and terrain relief.
    let dir = surface_dir_from_screen(in.ndc, in.sphere_dir);
    let h = terrain_field(dir);
    let sea_h = u.planet_params.z;
    let mountain_amp = u.planet_params.y;
    let above_water = h > sea_h;
    // Normalised height above sea level in roughly [0, 1] regardless of sea_h,
    // so biome thresholds (alpine, snow_alt) keep working at desert worlds
    // (very low sea_h) and water worlds (very high sea_h).
    let above_range = max(1.0 - sea_h, 0.0001);
    let above_amt = max(h - sea_h, 0.0) / above_range;
    let quality = u.misc.w;

    // Build a tangent frame from the sphere direction so we can do finite-difference
    // gradients on the terrain field. We pick an arbitrary helper vector and project.
    let helper = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(dir.y) > 0.95);
    let tangent = normalize(cross(helper, dir));
    let bitangent = normalize(cross(dir, tangent));

    var local_normal: vec3<f32>;
    var slope: f32 = 0.0;
    if (above_water && quality > 0.45) {
        let eps = 0.0025;
        let h0 = h;
        let ht = terrain_field(normalize(dir + tangent * eps));
        let hb = terrain_field(normalize(dir + bitangent * eps));
        let dx = (relief_above_sea(ht, sea_h) - relief_above_sea(h0, sea_h)) * mountain_amp / (eps * above_range);
        let dy = (relief_above_sea(hb, sea_h) - relief_above_sea(h0, sea_h)) * mountain_amp / (eps * above_range);
        local_normal = normalize(dir - tangent * dx - bitangent * dy);
        slope = 1.0 - clamp(dot(local_normal, dir), 0.0, 1.0);
        // Fine-scale land detail — perturbs the lit normal so flat plateaus pick
        // up texture and mountain flanks scatter light instead of reading flat.
        let detail_a = fbm(dir * 55.0 + u.seed_block.xyz, 2);
        let detail_b = fbm(dir * 55.0 + u.seed_block.xyz + vec3<f32>(13.7, 0.0, 0.0), 2);
        local_normal = normalize(local_normal + tangent * detail_a * 0.025 + bitangent * detail_b * 0.025);
    } else if (!above_water && quality > 0.45) {
        // Wave shimmer — subtle moving normal perturbation gives the ocean
        // surface life and lets the sun specular scatter into a wider, more
        // believable highlight rather than a single dot.
        let wave_a = fbm(dir * 35.0 + u.seed_block.xyz + vec3<f32>(u.misc.y * 0.40, 0.0, 0.0), 2);
        let wave_b = fbm(dir * 35.0 + u.seed_block.xyz + vec3<f32>(0.0, 0.0, u.misc.y * 0.40), 2);
        local_normal = normalize(dir + tangent * wave_a * 0.030 + bitangent * wave_b * 0.030);
    } else {
        local_normal = dir;
    }

    let world_normal = normalize((u.model * vec4<f32>(local_normal, 0.0)).xyz);

    let sun_dir = normalize(u.sun_dir.xyz);
    let n_dot_l = max(dot(world_normal, sun_dir), 0.0);
    let view_dir = normalize(u.camera_pos.xyz - in.world_pos);

    // Latitude proxy: |y| component of unrotated direction (poles at top/bottom).
    let lat = abs(dir.y);

    // ---------- Biome colour ----------
    //
    // Photorealism strategy: the Rust pre-bake gives the LARGE-SCALE
    // biome classification (climate-driven, consistent across views).
    // The shader layers RICH SUB-CELL procedural detail on top so
    // continents read like satellite photos rather than flat-fill
    // biome polygons.
    //
    //   - Biome atlas (1024 cells around the equator) sets the colour
    //     family at the texel scale.
    //   - Per-fragment FBM noise (vegetation patches, desert grain,
    //     rocky slopes, beach strip, rivers, snow detail) fills in
    //     the sub-cell variation a real-Earth-from-space photo shows.
    //
    // Biome flags gate which procedural effects fire: rivers only run
    // on vegetated biomes, the beach strip only at Shore, etc.

    let biome = biome_id_at(dir);
    var surface: vec3<f32> = biome_color_blended(dir);

    // Derive masks used by the city-lights pass below. Cheap bool->float
    // beats the FBM stacks the previous shader ran for these.
    let alpine = select(0.0, 1.0, biome_is_alpine(biome));
    let snow = select(0.0, 1.0, biome_is_ice(biome));
    let desert_mask = select(0.0, 1.0, biome_is_desert(biome));
    let is_vegetated_biome = biome_is_vegetated(biome) || biome == 3u || biome == 6u;
    let is_shore = biome == 2u;
    let is_ocean = biome_is_ocean(biome);

    let veg_richness = u.world_features.z;
    let above_amt_n = clamp(above_amt, 0.0, 1.0);

    if (above_water) {
        // --- Elevation-driven gradient ---
        // Real Earth-from-space photos show a smooth elevation
        // gradient: bright sandy coast → biome interior → rocky highlands.
        // Continuous smoothsteps (not biome flags) so the transition
        // is gradient-driven — no cell-aligned edges.
        let coast_t = smoothstep(0.0, 0.025, above_amt_n);
        let alpine_t = smoothstep(0.35, 0.70, above_amt_n);
        // Pull coastline tones toward sand — but the biome already
        // accounts for ice / volcanic via its colour, so this just
        // mixes a slight warm cast where elevation is low.
        surface = mix(u.sand_color.rgb, surface, coast_t);
        // Pull alpine tones toward mountain rock.
        surface = mix(surface, u.mountain_color.rgb, alpine_t * 0.45);

        // --- Vegetation patchwork (forest / grassland / savanna) ---
        // Tri-scale FBM yields organic patches at sub-cell resolution.
        // Driven by `veg_richness` (continuous from UWP atm/hydro) and
        // gated by `lat`/`above_amt` so cold high regions and
        // subtropical-aridity bands don't get falsely vegetated. No
        // biome-flag gating — keeps the transition continuous across
        // adjacent atlas cells.
        if (veg_richness > 0.02) {
            let zone_n  = fbm(dir * 1.4 + u.seed_block.xyz + vec3<f32>(193.4, 17.3, -41.0), 5);
            let patch_n = fbm(dir * 4.2 + u.seed_block.xyz + vec3<f32>(57.1, -83.2, 119.7), 4);
            let grain_n = fbm(dir * 13.0 + u.seed_block.xyz + vec3<f32>(-91.0, 31.0, 71.0), 3);
            let combined = zone_n * 0.55 + patch_n * 0.30 + grain_n * 0.15;
            let forest_t   = u.land_color.rgb * vec3<f32>(0.55, 0.68, 0.50);
            let grass_t    = u.land_color.rgb * vec3<f32>(1.10, 1.10, 0.90);
            let savanna_t  = mix(u.land_color.rgb, u.sand_color.rgb, 0.70);
            var vegetated = mix(forest_t, grass_t, smoothstep(-0.55, 0.15, combined));
            vegetated = mix(vegetated, savanna_t, smoothstep(0.20, 0.65, combined));
            // Cap the vegetation lift near the tree line + suppress
            // at high latitudes (where snow/tundra takes over).
            let tree_line_n = fbm(dir * 3.5 + u.seed_block.xyz + vec3<f32>(-49.0, 113.0, 67.0), 2);
            let tree_line   = 0.32 + tree_line_n * 0.10;
            let veg_top     = 1.0 - smoothstep(tree_line, tree_line + 0.14, above_amt_n);
            let polar_mask  = 1.0 - smoothstep(0.65, 0.85, lat);
            let vegetated_band = coast_t * veg_top * polar_mask;
            surface = mix(surface, vegetated, clamp(veg_richness, 0.0, 1.0) * vegetated_band * 0.65);
        }

        // --- Subtropical desert noise ---
        // Hadley-cell aridity band (~20°-30° lat) + large Sahara-scale
        // patches + interior-continental dryness. Continuous gating
        // on latitude + above_amt — no biome flag.
        let desert_zone = fbm(dir * 0.9 + u.seed_block.xyz + vec3<f32>(-19.4, 78.1, 31.6), 3) * 0.5 + 0.5;
        let lat_arid = smoothstep(0.18, 0.40, lat) * (1.0 - smoothstep(0.55, 0.80, lat));
        let big_desert = smoothstep(0.62, 0.82, desert_zone);
        let interior_n = fbm(dir * 1.0 + u.seed_block.xyz + vec3<f32>(157.0, -41.0, 89.0), 3);
        let interior_dry = smoothstep(0.15, 0.55, interior_n);
        let desert_amt = clamp(lat_arid * 0.45 + big_desert * 0.55 + interior_dry * lat_arid * 0.45, 0.0, 1.0);
        // Inversely proportional to vegetation strength — wet worlds
        // get less obvious deserts, dry worlds get more.
        let desert_strength = desert_amt * coast_t * (0.45 + (1.0 - veg_richness) * 0.30);
        surface = mix(surface, u.sand_color.rgb, desert_strength);

        // --- Slope-based rock ---
        // Exposed cliffs / valleys / river banks read as bare rock.
        let rocky = smoothstep(0.06, 0.28, slope);
        surface = mix(surface, u.mountain_color.rgb, rocky * 0.65);

        // --- Mid-scale tint noise ---
        // Fine procedural variation breaks up uniformity.
        let tint_n = fbm(dir * 9.0 + u.seed_block.xyz + vec3<f32>(101.3, 47.7, -9.1), 3);
        surface = surface * (0.88 + tint_n * 0.24);

        // --- Beach strip ---
        // Bright sandy band right at the waterline. Only on humid
        // worlds. Continuous gating on elevation — no biome flag.
        if (veg_richness > 0.05) {
            let beach = 1.0 - smoothstep(0.0, 0.012, above_amt_n);
            let beach_color = mix(u.sand_color.rgb, vec3<f32>(0.98, 0.92, 0.74), 0.45);
            surface = mix(surface, beach_color, beach * 0.75);
        }

        // --- Rivers ---
        // Ridged FBM gives bright thin lines in flat low valleys on
        // vegetated worlds. Continuous gates: veg + low slope + low
        // elevation + low latitude. No biome flag.
        if (veg_richness > 0.10 && u.planet_params.x > 0.20) {
            let river_n = ridged_fbm(dir * 16.0 + u.seed_block.xyz + vec3<f32>(91.0, -17.0, 41.0), 3);
            let river_line = smoothstep(0.88, 0.96, river_n);
            let in_valley  = 1.0 - smoothstep(0.0, 0.15, slope);
            let lowland    = 1.0 - smoothstep(0.05, 0.40, above_amt_n);
            let temperate  = 1.0 - smoothstep(0.62, 0.85, lat);
            let river = river_line * in_valley * lowland * temperate * veg_richness * 0.9;
            surface = mix(surface, u.ocean_color.rgb * 1.6, clamp(river, 0.0, 0.7));
        }

        // --- Snow / ice cap modulation ---
        // Continuous polar-cap blend driven by latitude + per-area
        // FBM jitter (creates peninsular ice shapes — natural
        // Antarctica-like coastline rather than smoothstep ring).
        let ice_lat = u.seed_block.w;
        let polar_lobe = fbm(dir * 3.5 + u.seed_block.xyz + vec3<f32>(0.0, 0.0, 503.1), 3) * 0.14;
        let polar_finger = ridged_fbm(dir * 11.0 + u.seed_block.xyz + vec3<f32>(17.0, 31.0, -41.0), 2) * 0.06;
        let polar_off = polar_lobe + polar_finger - 0.03;
        let snow_polar = smoothstep(ice_lat - 0.10 + polar_off, ice_lat + 0.06 + polar_off, lat);
        // High-elevation snow caps (mountain peaks) — gated on
        // above_amt with per-area jitter so snow line isn't uniform.
        let snow_jitter = fbm(dir * 4.0 + u.seed_block.xyz + vec3<f32>(303.0, 71.0, -19.0), 2) * 0.18;
        let snow_alt = smoothstep(0.62 + snow_jitter, 0.86 + snow_jitter, above_amt_n);
        let dry_world = step(u.planet_params.x, 0.15);
        let snow_amt = clamp(snow_alt + snow_polar * (1.0 - dry_world * 0.85), 0.0, 1.0);
        let ice_detail = fbm(dir * 14.0 + u.seed_block.xyz + vec3<f32>(91.0, 17.0, -33.0), 3) * 0.5 + 0.5;
        let crack_n = ridged_fbm(dir * 22.0 + u.seed_block.xyz + vec3<f32>(41.0, 113.0, -57.0), 2);
        let ice_cracks = smoothstep(0.86, 0.96, crack_n);
        let ice_tone = u.snow_color.rgb * (0.85 + ice_detail * 0.25) * (1.0 - ice_cracks * 0.55);
        surface = mix(surface, ice_tone, snow_amt);
    } else {
        // --- Three-tone water with smooth depth gradient ---
        // Per-fragment depth gives a continuous shallow→deep
        // transition that reads better than two flat-tone biome
        // cells meeting at a texel boundary. Bright turquoise reef
        // tint where depth is sub-shelf.
        let depth = sea_h - h;
        let turquoise = mix(u.ocean_color.rgb * 1.8, vec3<f32>(0.35, 0.78, 0.78), 0.55);
        let shallow = u.ocean_color.rgb * 1.55;
        let deep = u.ocean_color.rgb * 0.34;
        var water = mix(turquoise, shallow, smoothstep(0.0, 0.06, depth));
        water = mix(water, deep, smoothstep(0.10, 0.55, depth));
        surface = water;
        // Polar pack-ice — continuous latitude blend. No biome flag.
        let ice_lat = u.seed_block.w;
        let sea_lobe = fbm(dir * 3.5 + u.seed_block.xyz + vec3<f32>(0.0, 0.0, 503.1), 3) * 0.14;
        let sea_finger = ridged_fbm(dir * 11.0 + u.seed_block.xyz + vec3<f32>(17.0, 31.0, -41.0), 2) * 0.06;
        let sea_off = sea_lobe + sea_finger - 0.03;
        let polar = smoothstep(ice_lat - 0.08 + sea_off, ice_lat + 0.05 + sea_off, lat);
        surface = mix(surface, u.snow_color.rgb * 0.94, polar);
    }

    // ---------- Atmospheric haze / fine grain ----------
    // Subtle global noise for satellite-photo realism. Strength biased
    // toward LAND so oceans stay clean. No global desaturation —
    // ISS / Blue Marble photos show vivid greens / browns / blues.
    let dirt_low = fbm(dir * 2.2 + u.seed_block.xyz + vec3<f32>(311.0, -47.0, 89.0), 3);
    let dirt_hi  = fbm(dir * 26.0 + u.seed_block.xyz + vec3<f32>(7.0, 53.0, -113.0), 2);
    let warm_dirt = vec3<f32>(1.06, 0.97, 0.86);
    let patch_amt = smoothstep(0.0, 0.4, dirt_low) * select(0.08, 0.14, above_water);
    surface = mix(surface, surface * warm_dirt, patch_amt);
    surface = surface * (1.0 + dirt_hi * select(0.04, 0.07, above_water));

    // ---------- Cloud noise (3-layer system) ----------
    // Three distinct layers at different altitudes, each with its own scale,
    // structure and drift direction. Sampled with view-based parallax so the
    // upper layers sit visibly above the lower deck near the limb (where the
    // 3D depth becomes obvious).
    //
    // Latitudinal banding compresses longitude sampling for east-west streaks
    // rather than isotropic blobs. Strength varies from "barely there" on
    // thin atmospheres up to "pure Jupiter stripes" for atm F.
    let cloud_freq = u.planet_params.z * 2.4;
    let cloud_off  = u.seed_block.xyz + vec3<f32>(213.7, 71.0, -109.4);
    let banding    = u.world_features.w;
    let band_x     = 1.0 - sqrt(banding) * 0.95;
    let band_warp  = vec3<f32>(band_x, 1.0, band_x);
    let coverage   = u.misc.z;
    let time       = u.misc.y;

    // Sun direction in local (planet-spinning) frame — used by both the
    // shadow trace and the volumetric self-shadow.
    let sun_dir_local = (transpose(u.model) * vec4<f32>(sun_dir, 0.0)).xyz;

    // View ray in local frame — drives parallax offsets between cloud layers.
    let view_dir_local = (transpose(u.model) * vec4<f32>(view_dir, 0.0)).xyz;

    // Two-stage warp. First a translational fbm displacement breaks the
    // underlying fbm grid into fluid masses. Then a rotational warp in the
    // tangent plane swirls those masses around — approximating the
    // divergence-free flow you get from a real curl-noise field at a tiny
    // fraction of the cost (no finite-difference curl, just one extra fbm
    // for the rotation angle).
    let warp_seed = u.seed_block.xyz;
    let cloud_warp = vec3<f32>(
        fbm(dir * 1.7 + warp_seed + vec3<f32>(31.0,   0.0,   0.0), 3),
        fbm(dir * 1.7 + warp_seed + vec3<f32>( 0.0,  91.0,   0.0), 3),
        fbm(dir * 1.7 + warp_seed + vec3<f32>( 0.0,   0.0,  47.0), 3),
    ) * 0.10;

    var swirl_vec = vec3<f32>(0.0);
    if (quality > 0.50) {
        // Curl-like rotational warp: build a tangent frame at `dir`, rotate the
        // offset by a per-location angle drawn from a low-frequency fbm. Gives
        // the deck the cyclonic swirl real weather systems have (storms,
        // anticyclones, frontal hooks).
        let cloud_helper = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(dir.y) > 0.95);
        let cloud_tan = normalize(cross(cloud_helper, dir));
        let cloud_bit = cross(dir, cloud_tan);
        let swirl_amt  = fbm(dir * 0.9 + warp_seed * 0.7, 3) * 0.5 + 0.5;       // strength
        let swirl_ang  = fbm(dir * 2.4 + warp_seed + vec3<f32>(17.7, -41.0, 9.3), 3) * 6.2831;
        swirl_vec = (cloud_tan * cos(swirl_ang) + cloud_bit * sin(swirl_ang)) * swirl_amt * 0.030;
    }

    // Explicit cyclonic vortex centres — 3 seed-driven hurricane points on
    // the sphere. At each one the cloud warp gets a tangential rotation that
    // decays with angular distance, producing a visible spiral structure
    // (clearly hurricane-shaped at the centre, blending into the broader
    // swirl field further out). This is what the previous noise-only warp
    // couldn't deliver — clear discrete cyclones, not just fluid mush.
    var vortex_disp = vec3<f32>(0.0);
    if (quality > 0.85) {
        for (var vi: i32 = 0; vi < 3; vi = vi + 1) {
            let v_h1 = hash3_s(u.seed_block.xyz + vec3<f32>(f32(vi) * 17.3, 5.7, 91.0));
            let v_h2 = hash3_s(u.seed_block.xyz + vec3<f32>(f32(vi) * 41.7, 23.1, -7.3));
            let v_h3 = hash3_s(u.seed_block.xyz + vec3<f32>(f32(vi) * 91.1, -17.3, 53.7));
            // Latitude bias: hurricanes form in tropical/sub-tropical bands on
            // Earth (10–30° from equator), almost never on the equator itself or
            // near the poles. Map hash through that band, randomly mirrored to
            // the north or south.
            let band_lat = (0.18 + v_h2 * 0.30) * select(-1.0, 1.0, v_h3 > 0.5);
            let lat_c = band_lat * 3.14159265;
            let lon_c = v_h1 * 6.2831853;
            let cos_lat = cos(lat_c);
            let v_dir = vec3<f32>(cos_lat * cos(lon_c), sin(lat_c), cos_lat * sin(lon_c));
            // Squared angular distance — tight gaussian falloff so the vortex
            // is a localised hot spot, not a planet-wide rotation.
            let cos_d = clamp(dot(dir, v_dir), -1.0, 1.0);
            let ang2 = 2.0 * (1.0 - cos_d);
            let strength = mix(0.6, 1.1, v_h3);
            let falloff = exp(-ang2 * 90.0) * strength;
            // Tangent direction at `dir`, pointing around the vortex centre.
            // Cross of dir with the projection of v_dir onto the tangent plane
            // gives a clean rotational vector that flips hemispheres correctly
            // (Coriolis-style — north of equator goes counter-clockwise, south
            // goes clockwise — by virtue of the cross product sign).
            let to_v = v_dir - dir * cos_d;
            let tan_v = cross(dir, to_v);
            vortex_disp = vortex_disp + tan_v * falloff * 0.060;
        }
    }

    // -- Main cumulus deck (lowest visible layer) --
    // Domain-warped fbm + ridged_fbm gives the deck billowy cumulus tops
    // rather than uniform fuzz.
    let main_dir = dir + cloud_warp + swirl_vec + vortex_disp;
    let cloud_p = main_dir * band_warp * cloud_freq + cloud_off + vec3<f32>(time * 0.015, 0.0, 0.0);
    let cloud_smooth = fbm(cloud_p, 5) * 0.5 + 0.5;
    let cloud_billow = ridged_fbm(cloud_p * 1.8 + vec3<f32>(7.0, -3.0, 11.0), 3);
    let cloud_raw = cloud_smooth * 0.55 + cloud_billow * 0.45;
    // Narrower smoothstep band — sharper edges, more cumulus-like billows
    // instead of soft cotton-candy fuzz.
    let cloud_low  = mix(0.85, 0.30, coverage);
    let cloud_high = mix(1.02, 0.50, coverage);
    let cloud_density = smoothstep(cloud_low, cloud_high, cloud_raw);

    // Cast a soft shadow from clouds onto the surface by sampling the cloud
    // field offset toward the sun in local frame. Reuse the same warp so the
    // shadow tracks the actual cloud shape rather than the unwarped field.
    var shadow_factor = 1.0;
    if (quality > 0.45) {
        let cloud_shadow_dir = normalize(dir + sun_dir_local * 0.035) + cloud_warp + swirl_vec + vortex_disp;
        let cloud_p_shadow   = cloud_shadow_dir * band_warp * cloud_freq + cloud_off + vec3<f32>(time * 0.015, 0.0, 0.0);
        let cloud_raw_shadow = fbm(cloud_p_shadow, 4) * 0.5 + 0.5;
        let cloud_shadow     = smoothstep(cloud_low, cloud_high, cloud_raw_shadow);
        shadow_factor = 1.0 - cloud_shadow * 0.65;
    }

    // ---------- Lighting ----------
    let ambient   = u.atmosphere_color.rgb * 0.06 + vec3<f32>(0.015);
    let n_dot_l_s = n_dot_l * shadow_factor;
    var lit = surface * (ambient + n_dot_l_s);

    // Snow / ice subsurface scattering. Fresh snow's ice crystals are mildly
    // translucent; photons penetrate a few mm before scattering out, with
    // red absorbed preferentially. The visible effect is a cool blue cast in
    // self-shadowed regions (the famous "blue snow" in glacier crevasses
    // and on shadowed cumulus). Approximated by adding a low-amplitude
    // bluish term scaled by snow density and 1 − n·l.
    let snow_sss_tint = vec3<f32>(0.78, 0.88, 1.05);
    lit = lit + snow_sss_tint * snow * (1.0 - n_dot_l) * 0.11;

    // Ocean: Schlick Fresnel sky reflection + anisotropic GGX sun glint.
    //
    // The previous Blinn-Phong specular packed all energy into a tight point.
    // Real Earth-from-space sun glint is an extended streak (Cox-Munk wave
    // statistics, Heitz 2014). We use an anisotropic GGX NDF with a tangent
    // frame aligned to the planet's east direction so the highlight elongates
    // along the equatorial wave pattern.
    if (!above_water) {
        let cos_v = max(dot(world_normal, view_dir), 0.0);
        let f0 = 0.02;
        let fresnel_v = f0 + (1.0 - f0) * pow(1.0 - cos_v, 5.0);
        // Mild sky reflection; saturation kept modest so the limb doesn't
        // become a bright ring of sky.
        let sky_tint = u.atmosphere_color.rgb * (0.45 + n_dot_l * 0.5);
        lit = mix(lit, sky_tint, fresnel_v * 0.45);

        // Anisotropic GGX specular (Heitz 2014 form). α_t broader than α_b so
        // the highlight stretches along the east-tangent direction — closer
        // to the elongated glitter strip on real ocean photographs.
        let halfway = normalize(sun_dir + view_dir);
        let polar = vec3<f32>(0.0, 1.0, 0.0);
        // Tangent frame: east first, then north. Tiny perturbation prevents
        // degeneracy when normal is parallel to the polar axis.
        let t_east  = normalize(cross(polar, world_normal) + world_normal * 1e-4);
        let t_north = cross(world_normal, t_east);
        let h_t = dot(halfway, t_east);
        let h_b = dot(halfway, t_north);
        let h_n = max(dot(halfway, world_normal), 1e-4);
        // Roughness² along each axis. Cox-Munk wave statistics show along-wind
        // slope variance ~half the cross-wind variance — α_t (east) narrower,
        // α_b (north) wider. Stretches the highlight into an east-west streak
        // matching ISS sun-glint photographs.
        let a_t = 0.13;
        let a_b = 0.28;
        let dnom = h_t * h_t / (a_t * a_t)
                 + h_b * h_b / (a_b * a_b)
                 + h_n * h_n;
        let d_aniso = 1.0 / (3.14159265 * a_t * a_b * dnom * dnom);
        // Schlick Fresnel at the half-vector.
        let v_dot_h = max(dot(view_dir, halfway), 0.0);
        let fresnel_h = f0 + (1.0 - f0) * pow(1.0 - v_dot_h, 5.0);
        // BRDF = D·F·G / (4·n·l·n·v). With direct sun illumination the n·l
        // term cancels against the Lambert cos factor; we keep one n·v in the
        // denominator (clamped so grazing pixels don't explode) and skip the
        // shadowing G — at sun-glint geometries with our roughness range G ≈ 1
        // and the sun_mask is enough to keep the dark hemisphere clean.
        let n_dot_v = max(dot(world_normal, view_dir), 0.05);
        let sun_mask = smoothstep(0.0, 0.10, n_dot_l) * shadow_factor;
        // Slightly warm sun colour — solar disc temperature ~5778 K — scaled
        // into HDR so the bloom pass can pick up the brightest glint pixels.
        let sun_color = vec3<f32>(1.05, 1.00, 0.92);
        // Multiplier scales the spread-out GGX peak (∫D = 1, so per-pixel
        // intensity is small) into the HDR range bloom can pick up.
        let spec = d_aniso * fresnel_h / (4.0 * n_dot_v);
        lit = lit + sun_color * spec * sun_mask * 18.0;
    }

    // ---------- Cloud composite (3 layers, bottom-up) ----------
    let atm_d = u.misc.x;
    let cloud_tint_amt = smoothstep(0.55, 1.10, atm_d);
    let cloud_tint = mix(vec3<f32>(0.93), u.atmosphere_color.rgb * 1.25, cloud_tint_amt * 0.7);

    // -- Main cumulus deck (volumetric self-shadow) --
    // Two-tap self-shadow trace: sample the cloud field at two offsets
    // toward the sun, with diminishing weight. Stronger near-tap reads as
    // the immediate shadow side, far-tap as the bulk above. Together they
    // give the deck the chunky cumulus volume that one-sample shadow misses.
    var cloud_self_shadow = 1.0;
    if (quality > 0.55) {
        let near_dir = normalize(dir + sun_dir_local * 0.018) + cloud_warp + swirl_vec + vortex_disp;
        let far_dir  = normalize(dir + sun_dir_local * 0.045) + cloud_warp + swirl_vec + vortex_disp;
        let near_p = near_dir * band_warp * cloud_freq + cloud_off + vec3<f32>(time * 0.015, 0.0, 0.0);
        let far_p  = far_dir  * band_warp * cloud_freq + cloud_off + vec3<f32>(time * 0.015, 0.0, 0.0);
        let near_smooth  = fbm(near_p, 4) * 0.5 + 0.5;
        let near_ridge   = ridged_fbm(near_p * 1.8 + vec3<f32>(7.0, -3.0, 11.0), 2);
        let near_d = smoothstep(cloud_low, cloud_high, near_smooth * 0.55 + near_ridge * 0.45);
        let far_d  = smoothstep(cloud_low, cloud_high, fbm(far_p, 3) * 0.5 + 0.5);
        cloud_self_shadow = 1.0 - clamp(near_d * 0.55 + far_d * 0.35, 0.0, 0.85);
    }

    // Silver lining: mid-density edges read brighter than the dense centre.
    let lining = smoothstep(0.10, 0.40, cloud_density)
                * (1.0 - smoothstep(0.55, 0.90, cloud_density));

    // Anvil top: densest cumulus tops catch extra direct sunlight before the
    // light has to penetrate the deck. Gives cumulonimbus the bright flat
    // top you see in real Earth-from-space cloud photos.
    let anvil = smoothstep(0.72, 0.95, cloud_density) * smoothstep(0.0, 0.30, n_dot_l);

    // Sun-rim brightening — at grazing solar incidence (low-but-positive n·l)
    // the cumulus edges scatter forward toward the camera, creating the
    // bright golden-white rim you see at terminator clouds. Approximated by
    // a sharp ramp of low n·l times the silver-lining edge mask.
    let sun_rim = smoothstep(0.0, 0.20, n_dot_l) * (1.0 - smoothstep(0.20, 0.55, n_dot_l)) * lining;

    let cloud_lit = cloud_tint * (ambient + n_dot_l * 0.92 * cloud_self_shadow)
                  * (1.0 + lining * 0.45 + anvil * 0.40 + sun_rim * 0.65);
    lit = mix(lit, cloud_lit, cloud_density * 0.92);

    // -- Mid-altitude broken cumulus (NEW layer) --
    // Smaller-cell cumulus mass between the main deck and the cirrus, with a
    // different drift direction so the layers visibly slide past each other.
    // View-based parallax offset puts it 2-3% of planet radius "above" the
    // main deck — at oblique view angles (near the limb) the layers visibly
    // separate, which sells the 3D depth.
    if (quality > 0.65 && atm_d > 0.15 && coverage > 0.04) {
        let mid_band = vec3<f32>(band_x * 0.85, 1.0, band_x * 0.85);
        let mid_parallax = view_dir_local * 0.025;
        let mid_dir = normalize(dir + mid_parallax) + cloud_warp * 0.7;
        let mid_p = mid_dir * mid_band * cloud_freq * 1.55
                  + cloud_off + vec3<f32>(time * 0.022, 0.0, time * 0.006);
        let mid_smooth = fbm(mid_p, 4) * 0.5 + 0.5;
        let mid_ridge  = ridged_fbm(mid_p * 1.5, 2);
        let mid_raw = mid_smooth * 0.55 + mid_ridge * 0.45;
        let mid_low  = mix(0.88, 0.45, coverage);
        let mid_high = mix(1.00, 0.62, coverage);
        let mid_density = smoothstep(mid_low, mid_high, mid_raw) * 0.7;
        let mid_color = mix(vec3<f32>(0.96), cloud_tint, 0.55);
        let mid_lit = mid_color * (ambient + n_dot_l * 0.95);
        lit = mix(lit, mid_lit, mid_density);
    }

    // -- High-altitude cirrus --
    // Thin streaky high layer with stronger east-west compression and a more
    // aggressive parallax offset (further from the surface than the mid layer).
    // Only meaningful on worlds with enough atmosphere.
    if (quality > 0.85 && atm_d > 0.20 && coverage > 0.05) {
        let cirrus_band = vec3<f32>(band_x * 0.55, 1.0, band_x * 0.55);
        let cirrus_parallax = view_dir_local * 0.055;
        let cirrus_dir = normalize(dir + cirrus_parallax);
        let cirrus_p = cirrus_dir * cirrus_band * cloud_freq * 1.75
                     + cloud_off + vec3<f32>(time * 0.030, 0.0, time * 0.018);
        let cirrus_raw = fbm(cirrus_p, 4) * 0.5 + 0.5;
        let cirrus_low = mix(0.74, 0.42, coverage);
        let cirrus_high = mix(0.94, 0.66, coverage);
        let cirrus_density = smoothstep(cirrus_low, cirrus_high, cirrus_raw) * 0.65;
        let cirrus_color = mix(vec3<f32>(1.0), u.atmosphere_color.rgb * 1.2, cloud_tint_amt * 0.4);
        let cirrus_lit = cirrus_color * (ambient + n_dot_l * 0.95);
        lit = mix(lit, cirrus_lit, cirrus_density);
    }

    // ---------- City lights ----------
    // High-population worlds glow on the night side. Sampled procedurally so
    // populated regions cluster along coasts and along habitable mid-latitudes
    // rather than uniformly. Visible only on land, on the dark hemisphere,
    // not buried under cloud cover.
    let population = u.world_features.y;
    if (quality > 0.25 && population > 0.02 && above_water) {
        // Slight coast bias: brighter near shoreline (real cities cluster there),
        // but inland cities should still glow at high pop.
        let coast_bias = 0.45 + 0.55 * (1.0 - smoothstep(0.04, 0.35, above_amt));
        // Latitudinal habitability — fewer cities at the poles.
        let habit_lat = 1.0 - smoothstep(0.55, 0.95, lat);
        // Two noise scales — large clusters then individual lights inside them.
        let cluster_n = fbm(dir * 6.0  + u.seed_block.xyz + vec3<f32>(307.1, 53.7, 11.3), 4) * 0.5 + 0.5;
        let pixel_n   = fbm(dir * 24.0 + u.seed_block.xyz + vec3<f32>(13.2, 91.7, 217.3), 3) * 0.5 + 0.5;
        let clustered = smoothstep(0.48, 0.70, cluster_n);
        let dotted    = smoothstep(0.45, 0.82, pixel_n);
        // Habitability gate — cities don't form on Himalayan peaks, in the
        // middle of the Sahara, or on permanent ice caps. Multiplied in so
        // these regions go dark even on a populous, high-tech world.
        let habitable_terrain = (1.0 - alpine) * (1.0 - desert_mask * 0.85) * (1.0 - snow);
        let urban     = clustered * dotted * coast_bias * habit_lat * habitable_terrain;
        // Only on the unlit side — pow(1 - n_dot_l, 3) so the terminator gets a
        // gentle warm glow that grows into full sodium-orange lights at midnight.
        let night_factor = pow(1.0 - n_dot_l, 3.0);
        // Warm streetlight colour, scaled into HDR so the bloom pass picks up
        // the densest cores as a soft halo.
        let city_emit = vec3<f32>(1.0, 0.72, 0.34) * urban * population * night_factor * (1.0 - cloud_density) * 4.5;
        lit = lit + city_emit;
    }

    // The atmosphere pass adds Rayleigh + Mie in-scattering + tonemap, so this
    // shader stays in linear HDR. We only emit a faint night-side ambient so the
    // dark hemisphere doesn't read as pure black inside the atmospheric perspective.
    let atmo_density = u.misc.x;
    lit = lit + u.atmosphere_color.rgb * (1.0 - n_dot_l) * 0.020 * atmo_density;

    // Warm terminator tone — Earth-from-space photos show a band of orange /
    // pink along the day-night boundary where sunlight grazes a long path of
    // atmosphere. Approximated by ramping a warm tint up at low (but positive)
    // n_dot_l and fading it out as we get fully lit.
    let term_band = smoothstep(0.0, 0.18, n_dot_l) * (1.0 - smoothstep(0.18, 0.42, n_dot_l));
    lit = lit + vec3<f32>(1.0, 0.52, 0.22) * term_band * atmo_density * 0.18;

    // Aerial perspective on the planet surface. The atmosphere pass already
    // attenuates the planet through the column of air the view ray traverses
    // — but in our scene that column is short (only the chord through a thin
    // shell), so the limb doesn't pick up the visible blue haze you see on
    // every ISS photo. We add an explicit tint here proportional to
    // (1 − n·v): pixels seen at grazing angle gain a small amount of
    // atmosphere colour, which atmosphere.wgsl then composites correctly.
    let n_dot_v_surf = max(dot(world_normal, view_dir), 0.0);
    let aerial = pow(1.0 - n_dot_v_surf, 3.0) * atmo_density * 0.35;
    lit = mix(lit, u.atmosphere_color.rgb * (0.55 + n_dot_l * 0.45), aerial);

    return vec4<f32>(lit, 1.0);
}
