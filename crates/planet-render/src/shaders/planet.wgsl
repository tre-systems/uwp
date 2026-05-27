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

// Wider footprint for slope normals at close zoom — hides atlas texel stairsteps
// and sharp tectonic ridges without changing the colour height sample.
fn terrain_field_smoothed(dir: vec3<f32>, blend: f32) -> f32 {
    let center = terrain_field(dir);
    if (blend <= 0.001) {
        return center;
    }
    let helper = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(dir.y) > 0.95);
    let tangent = normalize(cross(helper, dir));
    let bitangent = normalize(cross(dir, tangent));
    let d = 0.0038 * blend;
    var acc = center;
    acc += terrain_field(normalize(dir + tangent * d));
    acc += terrain_field(normalize(dir - tangent * d));
    acc += terrain_field(normalize(dir + bitangent * d));
    acc += terrain_field(normalize(dir - bitangent * d));
    return acc * 0.2;
}

fn relief_above_sea(h: f32, sea_h: f32) -> f32 {
    return relief_above_sea_ramp(h, sea_h, 0.14);
}

fn relief_above_sea_ramp(h: f32, sea_h: f32, ramp: f32) -> f32 {
    let above = max(h - sea_h, 0.0);
    // Ease the first stretch of coastline into the base sphere so the
    // pre-baked waterline does not create a visible vertical wall on the mesh.
    // Wider ramp hides atlas texel stairsteps at close zoom.
    return above * smoothstep(0.0, ramp, above);
}

// Sub-texel visual coastline detail. The Rust atlas owns the continental
// masses and water fraction; this perturbation only acts in a narrow band
// around the sea threshold so large-scale map / globe alignment stays intact
// while close-up coast and pack-ice edges do not reveal atlas-cell stair steps.
fn coastline_detail(dir: vec3<f32>, raw_h: f32, sea_h: f32) -> f32 {
    let band = 1.0 - smoothstep(0.025, 0.22, abs(raw_h - sea_h));
    if (band <= 0.001) {
        return 0.0;
    }
    let seed = u.seed_block.xyz;
    let coves = fbm(dir * 18.0 + seed + vec3<f32>(23.0, -71.0, 11.0), 3);
    let fjords = ridged_fbm(dir * 38.0 + seed + vec3<f32>(-17.0, 101.0, 47.0), 2) - 0.48;
    let islands = fbm(dir * 72.0 + seed + vec3<f32>(83.0, 5.0, -29.0), 2);
    return (coves * 0.58 + fjords * 0.32 + islands * 0.10) * band;
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
    return mix(u.mountain_color.rgb, u.sand_color.rgb, 0.55);                            // Barren
}

fn biome_is_ocean(id: u32) -> bool { return id == 0u || id == 1u; }
fn biome_is_ice(id: u32) -> bool { return id == 11u || id == 13u; }
fn biome_is_alpine(id: u32) -> bool { return id == 9u || id == 10u || id == 11u; }
fn biome_is_desert(id: u32) -> bool { return id == 7u; }
fn biome_is_vegetated(id: u32) -> bool { return id == 4u || id == 5u || id == 8u; }

fn asteroid_shape(dir: vec3<f32>) -> f32 {
    let seed = u.seed_block.xyz;
    let lobe = fbm(dir * 2.1 + seed * 0.33, 4) * 0.16;
    let chip = ridged_fbm(dir * 8.0 + seed + vec3<f32>(19.0, -41.0, 73.0), 3) * 0.055;
    let rubble = ridged_fbm(dir * 19.0 + seed * 2.1, 3) * 0.035;
    let basin = (ridged_fbm(dir * 4.5 + seed + vec3<f32>(5.0, 11.0, 17.0), 2) - 0.5) * 0.045;
    return max(0.70, 1.0 + lobe + chip + rubble + basin);
}

fn gas_giant_surface(dir: vec3<f32>, time: f32, quality: f32, body_kind: f32) -> vec3<f32> {
    let lat = asin(clamp(dir.y, -1.0, 1.0));
    let lon = atan2(dir.z, dir.x);
    let seed = u.seed_block.xyz;
    let ice_giant = smoothstep(1.08, 1.20, body_kind);
    let mini_neptune = smoothstep(1.24, 1.36, body_kind);
    let ice_like = max(ice_giant, mini_neptune);
    let band_count = mix(12.0 + u.world_features.w * 9.0, 5.5 + u.world_features.w * 2.8, ice_like);
    let deep_shear = fbm(vec3<f32>(lat * 2.1, lon * 0.18 + time * 0.014, 0.0) + seed, 3);
    let jet_shear = fbm(vec3<f32>(lat * 12.0, lon * 0.72 - time * 0.040, 2.0) + seed, 2);
    let folded_shear = ridged_fbm(vec3<f32>(lat * 18.0, lon * 1.05 + deep_shear * 1.6 - time * 0.075, 5.0) + seed, 2);
    let band_coord = lat * band_count
                   + deep_shear * mix(1.35, 0.38, ice_like)
                   + jet_shear * mix(0.42, 0.14, ice_like)
                   + folded_shear * mix(0.18, 0.07, ice_like);
    let broad = 0.5 + 0.5 * sin(band_coord);
    let narrow = smoothstep(0.50, 0.78, 0.5 + 0.5 * sin(band_coord * 2.8 + jet_shear * 1.8));
    let belts = smoothstep(0.40, 0.84, broad) * (0.48 + narrow * 0.52) * mix(1.0, 0.40, ice_like);

    let warm_belt = mix(u.sand_color.rgb * vec3<f32>(1.00, 0.78, 0.56), u.land_color.rgb * 0.96, 0.48);
    let ochre_belt = mix(warm_belt, u.mountain_color.rgb * vec3<f32>(1.06, 0.78, 0.58), smoothstep(0.66, 0.96, broad));
    let pale_zone = mix(u.snow_color.rgb * vec3<f32>(1.02, 0.94, 0.82), u.sand_color.rgb * vec3<f32>(1.08, 0.98, 0.84), 0.38);
    var color = mix(pale_zone, ochre_belt, belts);
    color = mix(color, u.atmosphere_color.rgb * (0.86 + broad * 0.26), ice_like * 0.76);

    let turbulence = fbm(dir * 18.0 + seed + vec3<f32>(time * 0.045, 37.0, -11.0), 3);
    let billows = ridged_fbm(vec3<f32>(lat * 32.0, lon * 1.85 - time * 0.18, 9.0) + seed, 2);
    color = color * mix(0.84 + turbulence * 0.28, 0.95 + turbulence * 0.08, ice_like);

    let jet_edge = smoothstep(0.68, 0.98, abs(cos(band_coord)));
    let high_clouds = smoothstep(0.56, 0.90, billows) * jet_edge;
    color = mix(color, u.snow_color.rgb * vec3<f32>(1.08, 1.04, 0.96), high_clouds * mix(0.30, 0.18, ice_like));

    let folded_filaments = smoothstep(0.52, 0.86, folded_shear)
                         * smoothstep(0.10, 0.40, abs(sin(band_coord)));
    let filament_tint = mix(vec3<f32>(1.12, 0.93, 0.74), vec3<f32>(0.82, 1.02, 1.18), ice_like);
    color = mix(color, color * filament_tint, folded_filaments * mix(0.26, 0.16, ice_like));

    if (quality > 0.48) {
        // A large anticyclonic oval plus smaller vortices, with bands curling
        // around them rather than sitting as flat stripes.
        let storm_lat = (hash3_s(seed + vec3<f32>(11.0, 3.0, -7.0)) * 0.48 + 0.12)
                      * select(-1.0, 1.0, hash3_s(seed + vec3<f32>(5.0, 9.0, 2.0)) > 0.5);
        let storm_lon = hash3_s(seed + vec3<f32>(23.0, 41.0, 7.0)) * 6.2831853 + time * 0.026;
        let dlat = lat - storm_lat;
        let dlon = atan2(sin(lon - storm_lon), cos(lon - storm_lon));
        let oval_shape = dlat * dlat * 58.0 + dlon * dlon * 9.5;
        let oval = exp(-oval_shape);
        let swirl = 0.5 + 0.5 * sin(atan2(dlat * 5.2, dlon * 1.35) * 3.0 + oval * 7.5 + jet_shear * 2.2);
        let rim = smoothstep(0.16, 0.54, oval) * (1.0 - smoothstep(0.58, 0.90, oval));
        let core = smoothstep(0.46, 0.96, oval);
        let eyewall_cloud = rim * (0.55 + swirl * 0.45);
        let trailing_wisp = (0.42 + folded_shear * 0.58)
                          * smoothstep(0.08, 0.44, oval)
                          * (1.0 - smoothstep(0.72, 0.96, oval));
        let storm_core = mix(vec3<f32>(0.94, 0.43, 0.25), vec3<f32>(0.98, 0.76, 0.46), swirl);
        color = mix(color, storm_core, core * 0.92 * (1.0 - ice_like));
        color = mix(color, u.snow_color.rgb * vec3<f32>(1.10, 1.05, 0.92), rim * 0.58 * (1.0 - ice_like * 0.45));
        color = mix(color, u.snow_color.rgb * vec3<f32>(1.12, 1.06, 0.92), eyewall_cloud * 0.42 * (1.0 - ice_like * 0.35));
        color = mix(color, color * vec3<f32>(1.14, 0.88, 0.72), trailing_wisp * 0.24 * (1.0 - ice_like));

        let mirror_dlon = atan2(sin(lon - (storm_lon + 3.14159265)), cos(lon - (storm_lon + 3.14159265)));
        let mirror_oval = exp(-(dlat * dlat * 52.0 + mirror_dlon * mirror_dlon * 8.5));
        let mirror_swirl = 0.5 + 0.5 * sin(atan2(dlat * 4.4, mirror_dlon * 1.25) * 3.0 + mirror_oval * 6.0);
        let mirror_rim = smoothstep(0.16, 0.52, mirror_oval) * (1.0 - smoothstep(0.60, 0.90, mirror_oval));
        color = mix(color, mix(vec3<f32>(0.90, 0.34, 0.22), u.snow_color.rgb, mirror_swirl * 0.42), smoothstep(0.46, 0.94, mirror_oval) * 0.62 * (1.0 - ice_like));
        color = mix(color, u.snow_color.rgb * vec3<f32>(1.07, 1.03, 0.94), mirror_rim * 0.42 * (1.0 - ice_like * 0.45));

        for (var j: i32 = 0; j < 2; j = j + 1) {
            let fj = f32(j);
            let chain_lat = (hash3_s(seed + vec3<f32>(29.0 + fj, 61.0, -17.0)) * 0.62 - 0.31)
                          * select(-1.0, 1.0, fj > 0.5);
            let chain_lon = storm_lon + fj * 2.0943951 + hash3_s(seed + vec3<f32>(fj, 83.0, 37.0)) * 0.42;
            let chain_dlat = lat - chain_lat;
            let chain_dlon = atan2(sin(lon - chain_lon), cos(lon - chain_lon));
            let chain_oval = exp(-(chain_dlat * chain_dlat * 42.0 + chain_dlon * chain_dlon * 7.2));
            let chain_swirl = 0.5 + 0.5 * sin(atan2(chain_dlat * 4.0, chain_dlon * 1.2) * 3.0 + chain_oval * 6.5);
            let chain_core = smoothstep(0.52, 0.96, chain_oval);
            let chain_rim = smoothstep(0.20, 0.56, chain_oval) * (1.0 - smoothstep(0.62, 0.92, chain_oval));
            let chain_color = mix(vec3<f32>(0.88, 0.34, 0.18), vec3<f32>(1.0, 0.78, 0.48), chain_swirl);
            color = mix(color, chain_color, chain_core * 0.66 * (1.0 - ice_like));
            color = mix(color, u.snow_color.rgb * vec3<f32>(1.08, 1.03, 0.92), chain_rim * 0.48 * (1.0 - ice_like * 0.45));
        }

        if (quality > 0.72) {
            for (var i: i32 = 0; i < 4; i = i + 1) {
                let idx = f32(i);
                let small_lat = hash3_s(seed + vec3<f32>(71.0 + idx, 13.0, 5.0)) * 0.82 - 0.41;
                let small_lon = hash3_s(seed + vec3<f32>(17.0, 91.0 + idx, 29.0)) * 6.2831853 - time * (0.018 + idx * 0.004);
                let local_lat = lat - small_lat;
                let local_lon = atan2(sin(lon - small_lon), cos(lon - small_lon));
                let local = exp(-(local_lat * local_lat * 96.0 + local_lon * local_lon * 19.0));
                let local_ring = smoothstep(0.22, 0.56, local) * (1.0 - smoothstep(0.64, 0.92, local));
                let bright_head = smoothstep(0.48, 0.92, local);
                let gate = smoothstep(0.28, 0.86, hash3_s(seed + vec3<f32>(idx * 9.0, 47.0, -13.0)));
                let small_swirl = 0.5 + 0.5 * sin(atan2(local_lat * 5.0, local_lon * 1.6) * 2.5 + local * 5.0);
                let local_tint = mix(mix(u.sand_color.rgb, u.snow_color.rgb, 0.58), vec3<f32>(0.90, 0.46, 0.30), small_swirl * 0.38);
                color = mix(color, local_tint, local_ring * gate * 0.44 * (1.0 - ice_like * 0.45));
                color = mix(color, u.snow_color.rgb * 1.12, bright_head * gate * 0.22 * (1.0 - ice_like));
            }
        }

        let dark_lat = hash3_s(seed + vec3<f32>(103.0, 2.0, 19.0)) * 0.52 - 0.26;
        let dark_lon = hash3_s(seed + vec3<f32>(31.0, 59.0, 83.0)) * 6.2831853 + time * 0.034;
        let dark_dlat = lat - dark_lat;
        let dark_dlon = atan2(sin(lon - dark_lon), cos(lon - dark_lon));
        let dark_spot = exp(-(dark_dlat * dark_dlat * 138.0 + dark_dlon * dark_dlon * 28.0));
        let methane_wisp = smoothstep(0.28, 0.62, dark_spot) * (1.0 - smoothstep(0.64, 0.92, dark_spot));
        color = mix(color, u.ocean_color.rgb * 0.58, smoothstep(0.44, 0.90, dark_spot) * ice_like * 0.44);
        color = mix(color, u.snow_color.rgb * 1.18, methane_wisp * ice_like * 0.36);
    }

    let polar_haze = smoothstep(0.60, 0.96, abs(dir.y));
    let polar_storms = smoothstep(0.74, 0.95, abs(dir.y))
                     * smoothstep(0.58, 0.90, ridged_fbm(dir * 22.0 + seed * 2.0, 2));
    color = mix(color, u.atmosphere_color.rgb * 0.95, polar_haze * mix(0.22, 0.50, ice_like));
    color = mix(color, u.snow_color.rgb * vec3<f32>(1.06, 1.02, 0.92), polar_storms * mix(0.20, 0.10, ice_like));
    return max(color, vec3<f32>(0.0));
}

fn dir_from_lat_lon(lat: f32, lon: f32) -> vec3<f32> {
    let c = cos(lat);
    return normalize(vec3<f32>(c * cos(lon), sin(lat), c * sin(lon)));
}

fn stellar_layer_dir(lat: f32, lon: f32, time: f32, rate: f32, differential: f32) -> vec3<f32> {
    let s2 = sin(lat) * sin(lat);
    let phase = time * rate * (1.0 - differential * s2);
    return dir_from_lat_lon(lat, lon + phase);
}

fn stellar_surface(dir: vec3<f32>, world_normal: vec3<f32>, view_dir: vec3<f32>, time: f32) -> vec3<f32> {
    let mu = clamp(dot(world_normal, view_dir), 0.0, 1.0);
    let base = max(u.land_color.rgb, vec3<f32>(0.04));
    let warmth = clamp((base.r - base.b) * 1.45, 0.0, 1.0);
    let hotness = clamp((base.b - base.r) * 2.2, 0.0, 1.0);
    let solar_like = exp(-pow((base.g - 0.92) / 0.18, 2.0)) * (1.0 - hotness * 0.6);
    let seed = u.seed_block.xyz;
    let lat = asin(clamp(dir.y, -1.0, 1.0));
    let lon = atan2(dir.z, dir.x);
    let rotation_bias = 1.0 + hotness * 0.70 - warmth * 0.22;
    let fine_layer = stellar_layer_dir(lat, lon, time, 0.055 * rotation_bias, 0.34);
    let deep_layer = stellar_layer_dir(lat, lon, time, -0.015 * rotation_bias, 0.18);
    let magnetic_layer = stellar_layer_dir(lat, lon, time, 0.020 * rotation_bias, 0.42);
    let slow_time = vec3<f32>(time * 0.08, time * -0.035, time * 0.02);

    // Temperature-sensitive convection: blue-white stars stay comparatively
    // smooth, solar stars get fine rice-grain granulation, and cool K/M stars
    // grow large mottled cells.
    let fine_scale = mix(62.0, 12.0, warmth);
    let large_scale = mix(11.0, 3.0, warmth);
    let fine = fbm(fine_layer * fine_scale + seed + slow_time, 3) - 0.5;
    let cells = ridged_fbm(deep_layer * large_scale + seed * 1.7 - slow_time.yzx, 2) - 0.45;
    let hot_mottle = fine * hotness * 0.08;
    var color = base * (1.0 + fine * mix(0.18, 0.52, warmth) + cells * (0.16 + warmth * 0.22) + hot_mottle);

    // Cool-star spots: not a physically simulated magnetic field, but
    // latitude-gated dark active regions make G/K/M detail views read as
    // stellar photospheres instead of flat emissive discs.
    let spot_field = fbm(magnetic_layer * mix(8.0, 3.8, warmth) + seed + vec3<f32>(0.0, time * 0.018, 51.0), 2);
    let solar_band = exp(-pow((abs(dir.y) - 0.34), 2.0) * 17.0);
    let cool_gate = 0.72 + 0.28 * fbm(deep_layer * 2.2 + seed * 0.4, 1);
    let spot_lat = mix(solar_band, cool_gate, warmth);
    let spot_threshold = mix(0.58, 0.40, warmth) - solar_like * 0.10;
    let spots = smoothstep(spot_threshold, spot_threshold + 0.18, spot_field)
              * spot_lat
              * (solar_like * 0.78 + warmth * 1.05)
              * (1.0 - hotness * 0.92);
    var active_spots = 0.0;
    for (var i: i32 = 0; i < 2; i = i + 1) {
        let fi = f32(i);
        let h0 = hash3_s(seed + vec3<f32>(17.0 + fi, 41.0, 9.0));
        let h1 = hash3_s(seed + vec3<f32>(71.0, 13.0 + fi, 29.0));
        let h2 = hash3_s(seed + vec3<f32>(5.0, 97.0, 23.0 + fi));
        let spot_lat_c = (h0 * 0.72 - 0.36) * mix(0.75, 1.25, warmth);
        let spot_lon_c = h1 * 6.2831853 + time * (0.010 + fi * 0.004);
        let d_lat = lat - spot_lat_c;
        let d_lon = atan2(sin(lon - spot_lon_c), cos(lon - spot_lon_c));
        let oval = exp(-(d_lat * d_lat * mix(180.0, 54.0, warmth)
                       + d_lon * d_lon * mix(72.0, 24.0, warmth)));
        let gate = smoothstep(0.18, 0.58, h2) * (solar_like * 0.80 + warmth * 0.95) * (1.0 - hotness);
        active_spots = max(active_spots, oval * gate);
    }
    let starspots = max(spots, active_spots);
    let spot_tint = mix(vec3<f32>(0.42, 0.35, 0.28), vec3<f32>(0.30, 0.15, 0.09), warmth);
    color = mix(color, color * spot_tint, clamp(starspots, 0.0, 0.84));
    color = max(vec3<f32>(0.0), base + (color - base) * 1.65);

    // Extra resolved photosphere detail: bright granule walls, magnetic plage,
    // and thread-like dark filaments. These are procedural stand-ins for the
    // texture contrast visible in SDO/HMI and AIA imagery.
    let granule_wall = smoothstep(0.02, 0.34, cells + fine * 0.32 + 0.18);
    let plage_field = smoothstep(0.48, 0.82, spot_field + fine * 0.22)
                    * spot_lat * (solar_like * 0.72 + warmth * 0.36) * (1.0 - hotness * 0.55);
    let filament_field = smoothstep(
        0.78,
        0.96,
        ridged_fbm(vec3<f32>(lat * 17.0, lon * 2.5 + time * 0.036, 4.0) + seed * 1.3, 2)
    ) * spot_lat * (solar_like * 0.42 + warmth * 0.54) * (1.0 - hotness * 0.75);
    let chromo_network = smoothstep(0.08, 0.36, cells + hot_mottle + 0.20)
                       * spot_lat * (solar_like * 0.26 + warmth * 0.24) * (1.0 - hotness * 0.55);
    color = color * (1.0 + granule_wall * mix(0.08, 0.22, warmth) + plage_field * 0.34 + chromo_network * 0.20);
    color = mix(color, color * vec3<f32>(0.56, 0.34, 0.22), filament_field * 0.26);

    let edge = 1.0 - mu;
    let limb = mix(0.72 + 0.28 * mu, 0.30 + 1.72 * mu - 0.18 * mu * mu, warmth);
    let faculae = pow(edge, 2.1)
                * (solar_like * 0.32 + warmth * 0.18)
                * (0.74 + granule_wall * 0.46);
    let az = atan2(dir.z, dir.x);
    let active_arc = smoothstep(
        0.91,
        0.995,
        sin(az * (3.0 + floor(fract(u.seed_block.x * 1.7) * 5.0)) + u.seed_block.y * 5.0 + time * 0.045) * 0.5 + 0.5
    ) * pow(edge, 7.0) * (warmth * 0.38 + solar_like * 0.14);
    let prominence = smoothstep(
        0.935,
        0.995,
        sin(az * (5.0 + floor(fract(u.seed_block.z * 2.3) * 4.0)) + lat * 8.0 + time * 0.055) * 0.5 + 0.5
    ) * pow(edge, 10.0) * (warmth * 0.48 + solar_like * 0.22) * (1.0 - hotness * 0.38);
    let chromosphere = mix(vec3<f32>(0.75, 0.88, 1.45), vec3<f32>(1.35, 0.34, 0.18), warmth);
    let limb_tint = mix(vec3<f32>(0.90, 0.96, 1.12), vec3<f32>(1.12, 0.72, 0.45), warmth);
    let tinted = mix(color, color * limb_tint, edge * 0.55);

    return tinted * limb * (1.48 + hotness * 0.56)
         + u.sand_color.rgb * faculae * 0.92
         + chromosphere * active_arc * 1.95
         + chromosphere * prominence * 3.10
         + u.snow_color.rgb * pow(edge, 5.0) * (0.10 + hotness * 0.14);
}

fn asteroid_surface(dir: vec3<f32>) -> vec3<f32> {
    let base = mix(u.mountain_color.rgb, u.land_color.rgb, fbm(dir * 3.0 + u.seed_block.xyz, 3) * 0.5 + 0.5);
    let dust = mix(base, u.sand_color.rgb, smoothstep(-0.1, 0.5, fbm(dir * 12.0 + u.seed_block.xyz, 3)) * 0.35);
    let shallow_basins = smoothstep(
        0.58,
        0.86,
        ridged_fbm(dir * 7.5 + u.seed_block.xyz + vec3<f32>(3.0, 17.0, 23.0), 2)
    );
    let boulders = smoothstep(
        0.62,
        0.90,
        ridged_fbm(dir * 38.0 + u.seed_block.xyz * 3.2, 3)
    );
    let shadow_pits = smoothstep(
        0.66,
        0.92,
        ridged_fbm(dir * 52.0 + u.seed_block.xyz * 4.1 + vec3<f32>(29.0, 7.0, 13.0), 2)
    );
    let vein_a = abs(sin(dot(dir, normalize(vec3<f32>(0.41, 0.73, 0.55))) * 38.0 + u.seed_block.x * 2.0));
    let vein_b = abs(sin(dot(dir, normalize(vec3<f32>(0.76, -0.22, 0.61))) * 31.0 + u.seed_block.y * 2.7));
    let veins = smoothstep(0.985, 0.998, max(vein_a, vein_b)) * smoothstep(0.25, 0.70, fbm(dir * 7.0 + u.seed_block.xyz, 2) * 0.5 + 0.5);
    var color = mix(dust, dust * 0.50, shallow_basins * 0.36);
    color = mix(color, u.snow_color.rgb * 0.78, boulders * 0.28);
    color = mix(color, color * 0.58, shadow_pits * 0.18);
    color = mix(color, u.snow_color.rgb * 0.95, veins * 0.24);
    return color;
}

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
    let body_kind = u.planet_params.w;

    let sea_h        = u.planet_params.z;
    let mountain_amp = u.planet_params.y;
    let base_radius  = u.resolution.w;
    var radius       = base_radius;
    if (body_kind < 0.5) {
        let raw_h = terrain_field(dir);
        // Match fragment coastline perturbation so mesh silhouettes do not
        // stair-step against the smoothed land/ocean colour boundary.
        let coast_detail = coastline_detail(dir, raw_h, sea_h) * 0.035;
        let h = clamp(raw_h + coast_detail, -1.0, 1.0);
        let above = relief_above_sea(h, sea_h);
        radius = base_radius + above * mountain_amp * base_radius;
    } else if (body_kind > 2.5) {
        radius = base_radius * asteroid_shape(dir);
    }
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

fn surface_dir_from_screen(frag_xy: vec2<f32>, fallback: vec3<f32>) -> vec3<f32> {
    let ndc = vec2<f32>(
        frag_xy.x / max(u.resolution.x, 1.0) * 2.0 - 1.0,
        1.0 - frag_xy.y / max(u.resolution.y, 1.0) * 2.0
    );
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
    // Sample the visible spherical surface by casting the current fragment
    // back through the camera and intersecting the analytic base sphere.
    // This keeps continents and cloud bands glued to the planet as they
    // rotate over the limb; interpolated cubesphere directions stretch on
    // steep perspective angles and make features appear to grow at the edge.
    // Asteroids keep the mesh direction because their irregular silhouette is
    // intentionally not an analytic sphere.
    let mesh_dir = normalize(in.sphere_dir);
    let body_kind = u.planet_params.w;
    var dir = mesh_dir;
    if (body_kind <= 2.5) {
        dir = surface_dir_from_screen(in.position.xy, mesh_dir);
    }
    let base_world_normal = normalize((u.model * vec4<f32>(dir, 0.0)).xyz);
    let base_radius = u.resolution.w;
    let analytic_world_pos = (u.model * vec4<f32>(dir * base_radius, 1.0)).xyz;
    let base_surface_pos = select(in.world_pos, analytic_world_pos, body_kind <= 2.5);
    let base_view_dir = normalize(u.camera_pos.xyz - base_surface_pos);
    let sun_dir = normalize(u.sun_dir.xyz);
    let base_n_dot_l = max(dot(base_world_normal, sun_dir), 0.0);
    if (body_kind > 1.5 && body_kind < 2.5) {
        return vec4(stellar_surface(dir, base_world_normal, base_view_dir, u.misc.y), 1.0);
    }
    if (body_kind > 0.5 && body_kind < 1.5) {
        let gas = gas_giant_surface(dir, u.misc.y, u.misc.w, body_kind);
        let ambient = u.atmosphere_color.rgb * 0.11 + vec3<f32>(0.030);
        let limb_haze = pow(1.0 - max(dot(base_world_normal, base_view_dir), 0.0), 2.4);
        var lit_gas = gas * (ambient + base_n_dot_l * 1.14);
        lit_gas = mix(lit_gas, u.atmosphere_color.rgb * (0.50 + base_n_dot_l * 0.55), limb_haze * 0.34);
        lit_gas = lit_gas + vec3<f32>(1.0, 0.56, 0.24) * smoothstep(0.0, 0.18, base_n_dot_l) * (1.0 - smoothstep(0.18, 0.42, base_n_dot_l)) * 0.10;
        return vec4(lit_gas, 1.0);
    }
    if (body_kind > 2.5) {
        let ast = asteroid_surface(dir);
        let ambient = vec3<f32>(0.040);
        let rim = pow(1.0 - max(dot(base_world_normal, base_view_dir), 0.0), 3.0);
        let lit_ast = ast * (ambient + base_n_dot_l * 0.95) + u.sand_color.rgb * rim * 0.040;
        return vec4(lit_ast, 1.0);
    }
    let sea_h = u.planet_params.z;
    let mountain_amp = u.planet_params.y;
    let quality = u.misc.w;
    let view_dist = length(u.camera_pos.xyz) / max(u.resolution.w, 0.001);
    let close_zoom = smoothstep(2.8, 1.35, view_dist);
    let raw_h = terrain_field(dir);
    let coast_amp = mix(0.055, 0.075, quality);
    let h = clamp(raw_h + coastline_detail(dir, raw_h, sea_h) * coast_amp, -1.0, 1.0);
    // Coast mask uses a wider height footprint when zoomed in so the land/ocean
    // boundary and shallow-water rim do not follow atlas texel stairsteps.
    let raw_h_coast = terrain_field_smoothed(dir, close_zoom);
    let h_coast = clamp(
        mix(raw_h, raw_h_coast, close_zoom) + coastline_detail(dir, raw_h, sea_h) * coast_amp,
        -1.0,
        1.0
    );
    let water_delta = mix(h - sea_h, h_coast - sea_h, close_zoom);
    // Screen-space AA widens the blend wherever the coast crosses pixels quickly.
    let coast_aa = max(fwidth(water_delta) * 1.75, 0.0012);
    // Continuous land/ocean weight — replaces the old hard threshold that
    // produced single-pixel stairsteps and binary normal switching at coasts.
    let coast_band = mix(0.04, 0.09, close_zoom) + coast_aa;
    let land_factor = smoothstep(-coast_band, coast_band, water_delta);
    // Normalised height above sea level in roughly [0, 1] regardless of sea_h,
    // so biome thresholds (alpine, snow_alt) keep working at desert worlds
    // (very low sea_h) and water worlds (very high sea_h).
    let above_range = max(1.0 - sea_h, 0.0001);
    let above_amt = max(h - sea_h, 0.0) / above_range;

    // Build a tangent frame from the sphere direction so we can do finite-difference
    // gradients on the terrain field. We pick an arbitrary helper vector and project.
    let helper = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(dir.y) > 0.95);
    let tangent = normalize(cross(helper, dir));
    let bitangent = normalize(cross(dir, tangent));

    var local_normal: vec3<f32>;
    var slope: f32 = 0.0;
    var land_normal = dir;
    var ocean_normal = dir;
    if (quality > 0.45) {
        let relief_ramp = mix(0.14, 0.24, close_zoom);
        let terrain_smooth = close_zoom * 0.9;
        let eps = mix(0.0025, 0.0050, close_zoom);
        let h0 = h;
        let ht = terrain_field_smoothed(normalize(dir + tangent * eps), terrain_smooth);
        let hb = terrain_field_smoothed(normalize(dir + bitangent * eps), terrain_smooth);
        let dx = (relief_above_sea_ramp(ht, sea_h, relief_ramp) - relief_above_sea_ramp(h0, sea_h, relief_ramp)) * mountain_amp / (eps * above_range);
        let dy = (relief_above_sea_ramp(hb, sea_h, relief_ramp) - relief_above_sea_ramp(h0, sea_h, relief_ramp)) * mountain_amp / (eps * above_range);
        land_normal = normalize(dir - tangent * dx - bitangent * dy);
        slope = 1.0 - clamp(dot(land_normal, dir), 0.0, 1.0);
        // Fine-scale land detail — perturbs the lit normal so flat plateaus pick
        // up texture and mountain flanks scatter light instead of reading flat.
        let detail_a = fbm(dir * 55.0 + u.seed_block.xyz, 2);
        let detail_b = fbm(dir * 55.0 + u.seed_block.xyz + vec3<f32>(13.7, 0.0, 0.0), 2);
        land_normal = normalize(land_normal + tangent * detail_a * 0.025 + bitangent * detail_b * 0.025);
    }
    if (quality > 0.55) {
        // Wave shimmer — subtle moving normal perturbation gives the ocean
        // surface life and lets the sun specular scatter into a wider, more
        // believable highlight rather than a single dot.
        let wave_a = fbm(dir * 35.0 + u.seed_block.xyz + vec3<f32>(u.misc.y * 0.40, 0.0, 0.0), 2);
        let wave_b = fbm(dir * 35.0 + u.seed_block.xyz + vec3<f32>(0.0, 0.0, u.misc.y * 0.40), 2);
        ocean_normal = normalize(dir + tangent * wave_a * 0.014 + bitangent * wave_b * 0.014);
    }
    local_normal = normalize(mix(ocean_normal, land_normal, land_factor));

    let world_normal = normalize((u.model * vec4<f32>(local_normal, 0.0)).xyz);

    let surface_radius = base_radius + relief_above_sea(h, sea_h) * mountain_amp * base_radius;
    let surface_world_pos = (u.model * vec4<f32>(dir * surface_radius, 1.0)).xyz;
    // Soft terminator penumbra — real sun discs subtend ~0.5°; widen the band
    // when the camera is close so mesh facets do not read as a jagged cut.
    let n_dot_l_raw = dot(world_normal, sun_dir);
    let term_low = -0.05 - close_zoom * 0.08;
    let term_high = 0.08 + close_zoom * 0.06;
    let n_dot_l = smoothstep(term_low, term_high, n_dot_l_raw);
    let view_dir = normalize(u.camera_pos.xyz - surface_world_pos);

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
    var land_surface: vec3<f32> = biome_color_blended(dir);

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

    {
        // --- Elevation-driven gradient ---
        // Real Earth-from-space photos show a smooth elevation
        // gradient: bright sandy coast → biome interior → rocky highlands.
        // Continuous smoothsteps (not biome flags) so the transition
        // is gradient-driven — no cell-aligned edges.
        let coast_t = smoothstep(0.0, 0.035, above_amt_n);
        let alpine_t = smoothstep(0.35, 0.70, above_amt_n);
        // Pull coastline tones toward sand — but the biome already
        // accounts for ice / volcanic via its colour, so this just
        // mixes a slight warm cast where elevation is low.
        land_surface = mix(u.sand_color.rgb, land_surface, coast_t);
        // Pull alpine tones toward mountain rock.
        land_surface = mix(land_surface, u.mountain_color.rgb, alpine_t * 0.45);

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
            land_surface = mix(land_surface, vegetated, clamp(veg_richness, 0.0, 1.0) * vegetated_band * 0.65);
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
        land_surface = mix(land_surface, u.sand_color.rgb, desert_strength);

        // --- Slope-based rock ---
        // Exposed cliffs / valleys / river banks read as bare rock.
        let rocky = smoothstep(0.06, 0.28, slope);
        land_surface = mix(land_surface, u.mountain_color.rgb, rocky * 0.65);

        // --- Mid-scale tint noise ---
        // Fine procedural variation breaks up uniformity.
        let tint_n = fbm(dir * 9.0 + u.seed_block.xyz + vec3<f32>(101.3, 47.7, -9.1), 3);
        land_surface = land_surface * (0.88 + tint_n * 0.24);

        // --- Beach strip ---
        // Bright sandy band right at the waterline. Only on humid
        // worlds. Continuous gating on elevation — no biome flag.
        if (veg_richness > 0.05) {
            let beach = 1.0 - smoothstep(0.0, 0.022, above_amt_n);
            let beach_color = mix(u.sand_color.rgb, vec3<f32>(0.98, 0.92, 0.74), 0.45);
            land_surface = mix(land_surface, beach_color, beach * 0.75);
            // Feather land into shallow water colour over a wider band so
            // the continuous land_factor blend does not reveal atlas stairs.
            let shore_water = mix(u.ocean_color.rgb * 1.50, vec3<f32>(0.35, 0.78, 0.78), 0.32);
            let shore_band = mix(0.045, 0.11, close_zoom) + coast_aa;
            let shore_feather = 1.0 - smoothstep(0.0, shore_band, water_delta);
            land_surface = mix(land_surface, shore_water, shore_feather * 0.32);
        }

        // --- Rivers ---
        // Ridged FBM gives bright thin lines in flat low valleys on
        // vegetated worlds. Continuous gates: veg + low slope + low
        // elevation + low latitude. No biome flag.
        if (veg_richness > 0.10 && u.planet_params.x > 0.20) {
            let river_n = ridged_fbm(dir * 16.0 + u.seed_block.xyz + vec3<f32>(91.0, -17.0, 41.0), 3);
            let river_line = smoothstep(mix(0.88, 0.83, close_zoom), mix(0.96, 0.92, close_zoom), river_n);
            let in_valley  = 1.0 - smoothstep(0.0, 0.15, slope);
            let lowland    = 1.0 - smoothstep(0.05, 0.40, above_amt_n);
            let temperate  = 1.0 - smoothstep(0.62, 0.85, lat);
            let river = river_line * in_valley * lowland * temperate * veg_richness * 0.9;
            land_surface = mix(land_surface, u.ocean_color.rgb * 1.6, clamp(river, 0.0, 0.7));
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
        let dry_world = step(u.planet_params.x, 0.15);
        let snow_alt = smoothstep(0.62 + snow_jitter, 0.86 + snow_jitter, above_amt_n) * (1.0 - dry_world);
        let snow_amt = clamp(snow_alt + snow_polar * (1.0 - dry_world), 0.0, 1.0);
        let ice_detail = fbm(dir * 14.0 + u.seed_block.xyz + vec3<f32>(91.0, 17.0, -33.0), 3) * 0.5 + 0.5;
        let crack_n = ridged_fbm(dir * 22.0 + u.seed_block.xyz + vec3<f32>(41.0, 113.0, -57.0), 2);
        let ice_cracks = smoothstep(0.86, 0.96, crack_n);
        let ice_tone = u.snow_color.rgb * (0.85 + ice_detail * 0.25) * (1.0 - ice_cracks * 0.55);
        land_surface = mix(land_surface, ice_tone, snow_amt);
    }

    // --- Three-tone water with smooth depth gradient ---
    var ocean_surface: vec3<f32>;
    {
        let depth = sea_h - mix(h, h_coast, close_zoom * 0.85);
        let turquoise = mix(u.ocean_color.rgb * 1.55, vec3<f32>(0.35, 0.78, 0.78), 0.35);
        let open_ocean = u.ocean_color.rgb * 0.72;
        let ocean_grain = fbm(dir * 18.0 + u.seed_block.xyz + vec3<f32>(-137.0, 19.0, 61.0), 2);
        let shallow_band = mix(0.028, 0.065, close_zoom) + max(fwidth(depth) * 1.5, 0.0008);
        let shallow = pow(1.0 - smoothstep(0.0, shallow_band, depth), 2.0);
        var water = open_ocean * (0.985 + ocean_grain * 0.018);
        let shallow_tint = select(0.0, shallow * 0.18, quality > 0.55);
        water = mix(water, turquoise, shallow_tint);
        ocean_surface = water;
        let ice_lat = u.seed_block.w;
        let sea_lobe = fbm(dir * 3.5 + u.seed_block.xyz + vec3<f32>(0.0, 0.0, 503.1), 3) * 0.14;
        let sea_finger = ridged_fbm(dir * 11.0 + u.seed_block.xyz + vec3<f32>(17.0, 31.0, -41.0), 2) * 0.06;
        let sea_off = sea_lobe + sea_finger - 0.03;
        let polar = smoothstep(ice_lat - 0.08 + sea_off, ice_lat + 0.05 + sea_off, lat);
        ocean_surface = mix(ocean_surface, u.snow_color.rgb * 0.94, polar);
    }

    var surface = mix(ocean_surface, land_surface, land_factor);

    // ---------- Atmospheric haze / fine grain ----------
    // Subtle global noise for satellite-photo realism. Strength biased
    // toward LAND so oceans stay clean. No global desaturation —
    // ISS / Blue Marble photos show vivid greens / browns / blues.
    let dirt_low = fbm(dir * 2.2 + u.seed_block.xyz + vec3<f32>(311.0, -47.0, 89.0), 3);
    let dirt_hi  = fbm(dir * 26.0 + u.seed_block.xyz + vec3<f32>(7.0, 53.0, -113.0), 2);
    let warm_dirt = vec3<f32>(1.06, 0.97, 0.86);
    // Keep oceans clean at low quality. Broad low-frequency grain over water
    // reads as square GPU/noise tiles when the user zooms in; land still gets
    // enough variation to avoid flat-fill continents.
    let patch_amt = smoothstep(0.0, 0.4, dirt_low) * mix(0.015, 0.14, land_factor);
    surface = mix(surface, surface * warm_dirt, patch_amt);
    surface = surface * (1.0 + dirt_hi * mix(0.012, 0.07, land_factor));

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
    let coverage   = u.misc.z * smoothstep(0.05, 0.25, u.planet_params.x);
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
    // Slightly wider smoothstep band — softer cloud edges cast gentler
    // surface shadows instead of hard aliased cutouts on coastlines.
    let cloud_low  = mix(0.82, 0.28, coverage);
    let cloud_high = mix(1.05, 0.55, coverage);
    var cloud_density = smoothstep(cloud_low, cloud_high, cloud_raw);
    if (quality <= 0.55) {
        cloud_density = 0.0;
    }

    // Cast a soft shadow from clouds onto the surface by sampling the cloud
    // field offset toward the sun in local frame. Reuse the same warp so the
    // shadow tracks the actual cloud shape rather than the unwarped field.
    var shadow_factor = 1.0;
    if (quality > 0.55) {
        let cloud_shadow_dir = normalize(dir + sun_dir_local * 0.035) + cloud_warp + swirl_vec + vortex_disp;
        let cloud_p_shadow   = cloud_shadow_dir * band_warp * cloud_freq + cloud_off + vec3<f32>(time * 0.015, 0.0, 0.0);
        let cloud_raw_shadow = fbm(cloud_p_shadow, 4) * 0.5 + 0.5;
        let shadow_low = cloud_low - 0.06;
        let shadow_high = cloud_high + 0.04;
        let cloud_aa = max(fwidth(cloud_raw_shadow) * 0.85, 0.02);
        let cloud_shadow = smoothstep(shadow_low - cloud_aa, shadow_high + cloud_aa, cloud_raw_shadow);
        shadow_factor = 1.0 - cloud_shadow * 0.42;
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
    let water_factor = 1.0 - land_factor;
    if (water_factor > 0.001) {
        let cos_v = max(dot(world_normal, view_dir), 0.0);
        let f0 = 0.02;
        let fresnel_v = f0 + (1.0 - f0) * pow(1.0 - cos_v, 5.0);
        // Mild sky reflection; saturation kept modest so the limb doesn't
        // become a bright ring of sky.
        let sky_tint = u.atmosphere_color.rgb * (0.45 + n_dot_l * 0.5);
        lit = mix(lit, sky_tint, fresnel_v * 0.45 * water_factor);

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
        // matching ISS sun-glint photographs. Tuned wider than pure Cox-Munk
        // so the highlight spreads as a soft glow rather than a sharp streak.
        let a_t = 0.18;
        let a_b = 0.32;
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
        // Multiplier scales the spread-out GGX peak. Lowered from 18 → 8
        // to soften the highlight; the wider αs above already spread the
        // energy further, so the visible glint stays comparable while
        // streaky artifacts from wave-shimmer normals are damped.
        let spec = d_aniso * fresnel_h / (4.0 * n_dot_v);
        lit = lit + sun_color * spec * sun_mask * 8.0 * water_factor;
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
    if (quality > 0.25 && population > 0.02 && land_factor > 0.5) {
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
