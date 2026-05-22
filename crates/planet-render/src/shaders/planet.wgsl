// Procedural planet shader.
//
// Vertex shader displaces the cubesphere mesh along its normal using FBM noise.
// Fragment shader recomputes the height field for per-pixel normals, blends biome
// colors, lights with a directional sun, layers procedural clouds, and adds a
// Fresnel atmosphere rim. Output is linear; framebuffer is sRGB so gamma is automatic.

struct Uniforms {
    view_proj:       mat4x4<f32>,
    inv_view_proj:   mat4x4<f32>,
    model:           mat4x4<f32>,
    camera_pos:      vec4<f32>,
    sun_dir:         vec4<f32>,
    ocean_color:     vec4<f32>,
    land_color:      vec4<f32>,
    mountain_color:  vec4<f32>,
    sand_color:      vec4<f32>,
    snow_color:      vec4<f32>,
    atmosphere_color:vec4<f32>,
    // xyz = seed offsets, w = ice latitude (0..1)
    seed_block:      vec4<f32>,
    // x = sea_level, y = mountain_amp, z = noise_freq, w = noise_octaves
    planet_params:   vec4<f32>,
    // x = atmosphere_density, y = time, z = cloud_coverage, w = -
    misc:            vec4<f32>,
    // x = width, y = height, z = aspect, w = planet radius
    resolution:      vec4<f32>,
    // x = crater_density, y = population_intensity, z = vegetation_richness, w = surface_age
    world_features:  vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

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
// pick a random crater position + radius, find the closest one to `p`, and
// return a vertical displacement: bowl-shaped depression inside, raised rim
// just outside the bowl edge. Returns 0 outside any crater's reach.
fn crater_layer(p: vec3<f32>, scale: f32, depth: f32) -> f32 {
    let sp = p * scale;
    let ip = floor(sp);
    let fp = fract(sp);
    var best_r = 1e9;
    var best_norm = 0.0;
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
                let d = length(centre - fp);
                let normalised = d / radius;
                if (normalised < 1.0 && d < best_r) {
                    best_r = d;
                    best_norm = normalised;
                }
            }
        }
    }
    if (best_r >= 1e9) { return 0.0; }
    let r = best_norm;
    // Bowl up to r=0.85, then a raised rim that smoothly tapers back to 0 by r=1.
    if (r < 0.85) {
        let t = r / 0.85;
        // Smooth cosine bowl — flat-bottomed at r=0, lifts back to 0 at the rim base.
        let bowl = -0.5 * (1.0 + cos(t * 3.14159265));
        return bowl * depth;
    }
    let t = (r - 0.85) / 0.15;
    let ring = sin(t * 3.14159265);  // 0 -> 1 -> 0
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

fn ray_sphere(orig: vec3<f32>, dir: vec3<f32>, radius: f32) -> vec2<f32> {
    let b = dot(orig, dir);
    let c = dot(orig, orig) - radius * radius;
    let h = b * b - c;
    if (h < 0.0) { return vec2<f32>(-1.0, -1.0); }
    let s = sqrt(h);
    return vec2<f32>(-b - s, -b + s);
}

// Combined continental + ridged terrain field. Result is roughly in [-1, 1] so
// downstream biome thresholds are predictable.
//
// Continents are domain-warped so coastlines flow organically instead of reading
// as round noise-blobs. The shaping curve (pow(|x|, 0.85)) pushes the histogram
// slightly bi-modal for clearer ocean/land separation.
fn terrain_field(dir: vec3<f32>) -> f32 {
    let freq = u.planet_params.z;
    let oct  = i32(u.planet_params.w);
    let off  = u.seed_block.xyz;
    let p = dir * freq + off;

    let warp = vec3<f32>(
        fbm(p * 0.55 + vec3<f32>( 0.0,  17.3, 0.0), 3),
        fbm(p * 0.55 + vec3<f32>(43.1,   0.0, 0.0), 3),
        fbm(p * 0.55 + vec3<f32>( 0.0,   0.0, 71.9), 3),
    ) * 0.45;
    let pw = p + warp;

    let continents = fbm(pw, oct);
    let ridges     = ridged_fbm(pw * 2.7 + vec3<f32>(13.7, 91.3, 47.1), max(oct - 1, 2));
    let shaped = sign(continents) * pow(abs(continents), 0.85);
    let base = shaped * 0.85 + (ridges - 0.55) * 0.30;
    let crater = craters(dir);
    return clamp(base + crater, -1.0, 1.0);
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
    let h = terrain_field(dir);

    let sea_h        = u.planet_params.x * 2.0 - 1.0;
    let mountain_amp = u.planet_params.y;
    let above        = max(h - sea_h, 0.0);
    let radius       = 1.0 + above * mountain_amp;
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
    let sea_h = u.planet_params.x * 2.0 - 1.0;
    let mountain_amp = u.planet_params.y;
    let above_water = h > sea_h;
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

    let eps = 0.0025;
    let h0 = h;
    let ht = terrain_field(normalize(dir + tangent * eps));
    let hb = terrain_field(normalize(dir + bitangent * eps));

    var local_normal: vec3<f32>;
    var slope: f32 = 0.0;
    if (above_water) {
        let dx = (max(ht - sea_h, 0.0) - max(h0 - sea_h, 0.0)) * mountain_amp / (eps * above_range);
        let dy = (max(hb - sea_h, 0.0) - max(h0 - sea_h, 0.0)) * mountain_amp / (eps * above_range);
        local_normal = normalize(dir - tangent * dx - bitangent * dy);
        slope = 1.0 - clamp(dot(local_normal, dir), 0.0, 1.0);
        // Fine-scale land detail — perturbs the lit normal so flat plateaus pick
        // up texture and mountain flanks scatter light instead of reading flat.
        let detail_a = fbm(dir * 55.0 + u.seed_block.xyz, 2);
        let detail_b = fbm(dir * 55.0 + u.seed_block.xyz + vec3<f32>(13.7, 0.0, 0.0), 2);
        local_normal = normalize(local_normal + tangent * detail_a * 0.025 + bitangent * detail_b * 0.025);
    } else {
        // Wave shimmer — subtle moving normal perturbation gives the ocean
        // surface life and lets the sun specular scatter into a wider, more
        // believable highlight rather than a single dot.
        let wave_a = fbm(dir * 35.0 + u.seed_block.xyz + vec3<f32>(u.misc.y * 0.40, 0.0, 0.0), 2);
        let wave_b = fbm(dir * 35.0 + u.seed_block.xyz + vec3<f32>(0.0, 0.0, u.misc.y * 0.40), 2);
        local_normal = normalize(dir + tangent * wave_a * 0.030 + bitangent * wave_b * 0.030);
    }

    let world_normal = normalize((u.model * vec4<f32>(local_normal, 0.0)).xyz);

    let sun_dir = normalize(u.sun_dir.xyz);
    let n_dot_l = max(dot(world_normal, sun_dir), 0.0);
    let view_dir = normalize(u.camera_pos.xyz - in.world_pos);

    // Latitude proxy: |y| component of unrotated direction (poles at top/bottom).
    let lat = abs(dir.y);
    let ice_lat = u.seed_block.w;

    // ---------- Biome colour ----------
    var surface: vec3<f32>;
    if (above_water) {
        let coast  = smoothstep(0.0, 0.025, above_amt);
        // Alpine threshold pushed high so the bulk of land reads as land/grass.
        let alpine = smoothstep(0.35, 0.70, above_amt);
        let base_land = mix(u.sand_color.rgb, u.land_color.rgb, coast);
        var land = mix(base_land, u.mountain_color.rgb, alpine);

        // Vegetation richness: multi-scale noise picks between deep forest /
        // bright grassland / dry savanna / outright desert. Driven by
        // world_features.z (wired from UWP atm + hydro). At richness 0
        // (Mars-like) the noise contributes nothing and the land stays its
        // base palette.
        let veg_richness = u.world_features.z;
        if (veg_richness > 0.02) {
            // Two noise scales — large continental zones + medium patches.
            let zone_n = fbm(dir * 1.4 + u.seed_block.xyz + vec3<f32>(193.4, 17.3, -41.0), 4);
            let patch_n = fbm(dir * 3.8 + u.seed_block.xyz + vec3<f32>(57.1, -83.2, 119.7), 3);
            let combined = zone_n * 0.7 + patch_n * 0.3;  // ~[-1, 1]
            // Dark conifer for low values, brighter grassland for mid, sand
            // for high. Pushes more saturation than the user's land_color
            // alone so continents read with clear regional differences.
            let forest   = u.land_color.rgb * vec3<f32>(0.45, 0.62, 0.40);  // deep dark green
            let grass    = u.land_color.rgb * vec3<f32>(1.25, 1.20, 0.95);  // brighter, slightly yellower
            let savanna  = mix(u.land_color.rgb, u.sand_color.rgb, 0.75);
            var vegetated = mix(forest, grass, smoothstep(-0.55, 0.15, combined));
            vegetated = mix(vegetated, savanna, smoothstep(0.20, 0.65, combined));
            let vegetated_band = (1.0 - alpine) * coast;
            land = mix(land, vegetated, veg_richness * vegetated_band);
        }

        // Big desert zones — large low-freq noise carves out unambiguous arid
        // continents (Sahara, Australian outback). Combined with the
        // latitudinal aridity for that "subtropical dry belt" look.
        let desert_zone = fbm(dir * 0.9 + u.seed_block.xyz + vec3<f32>(-19.4, 78.1, 31.6), 3) * 0.5 + 0.5;
        let lat_arid = smoothstep(0.08, 0.30, lat) * (1.0 - smoothstep(0.42, 0.68, lat));
        let big_desert = smoothstep(0.62, 0.82, desert_zone);
        let desert_mask = clamp(lat_arid * 0.5 + big_desert * 0.8, 0.0, 1.0);
        land = mix(land, u.sand_color.rgb, desert_mask * (1.0 - alpine) * coast * (0.5 + veg_richness * 0.3));

        // Steep slopes read as exposed rock regardless of elevation — gives cliffs,
        // valleys, river banks a believable rocky texture.
        let rocky = smoothstep(0.06, 0.28, slope);
        land = mix(land, u.mountain_color.rgb, rocky * 0.65);

        // Fine-scale tint noise breaks up the palette so continents read as
        // patchy terrain rather than flat-fill polygons.
        let tint_n = fbm(dir * 9.0 + u.seed_block.xyz + vec3<f32>(101.3, 47.7, -9.1), 3);
        land = land * (0.88 + tint_n * 0.24);

        // Snow on real peaks or polar regions. Suppress polar ice when there's
        // no water on the planet — frost belongs to wet worlds. Polar caps get
        // a noise-driven jagged edge and brightness variation so they read as
        // natural ice sheets rather than a uniform white cap.
        let snow_alt   = smoothstep(0.68, 0.92, above_amt);
        let polar_jitter = fbm(dir * 4.5 + u.seed_block.xyz + vec3<f32>(0.0, 0.0, 503.1), 3) * 0.05;
        let snow_polar = smoothstep(ice_lat - 0.05 + polar_jitter, ice_lat + 0.04 + polar_jitter, lat);
        let dry_world  = step(u.planet_params.x, 0.15);
        let snow = clamp(snow_alt + snow_polar * (1.0 - dry_world * 0.85), 0.0, 1.0);
        let ice_detail = fbm(dir * 14.0 + u.seed_block.xyz + vec3<f32>(91.0, 17.0, -33.0), 3) * 0.5 + 0.5;
        let ice_tone = u.snow_color.rgb * (0.85 + ice_detail * 0.25);
        surface = mix(land, ice_tone, snow);
    } else {
        let depth = sea_h - h;
        // Three-tone water: turquoise shallows (continental shelves), bright
        // ocean blue mid-depth, and deep navy abyss. Coast-side fragments
        // pick up an extra cyan boost so reefs / shallow seas read clearly.
        let turquoise = mix(u.ocean_color.rgb * 1.8, vec3<f32>(0.35, 0.78, 0.78), 0.55);
        let shallow = u.ocean_color.rgb * 1.55;
        let deep    = u.ocean_color.rgb * 0.34;
        var water = mix(turquoise, shallow, smoothstep(0.0, 0.06, depth));
        water = mix(water, deep, smoothstep(0.10, 0.55, depth));
        surface = water;
        // Polar ice on water — slightly sharper than the land snow line.
        let polar = smoothstep(ice_lat - 0.015, ice_lat + 0.04, lat);
        surface = mix(surface, u.snow_color.rgb * 0.94, polar);
    }

    // ---------- Cloud noise ----------
    // Latitudinal banding: compress longitude sampling so clouds form east-west
    // streaks rather than isotropic blobs. Strength varies from "barely there"
    // for thin atmospheres up to "pure Jupiter stripes" for atm F (unusual).
    let cloud_freq = u.planet_params.z * 2.4;
    let cloud_off  = u.seed_block.xyz + vec3<f32>(213.7, 71.0, -109.4);
    let banding    = u.world_features.w;
    let band_x     = 1.0 - sqrt(banding) * 0.95;       // 1.0 at banding=0, ~0.05 at banding=1
    let band_warp  = vec3<f32>(band_x, 1.0, band_x);
    let cloud_p    = dir * band_warp * cloud_freq + cloud_off + vec3<f32>(u.misc.y * 0.015, 0.0, 0.0);
    let cloud_raw  = fbm(cloud_p, 5) * 0.5 + 0.5;
    let coverage   = u.misc.z;
    let cloud_low  = mix(0.85, 0.20, coverage);
    let cloud_high = mix(1.05, 0.55, coverage);
    let cloud_density = smoothstep(cloud_low, cloud_high, cloud_raw);

    // Cast a soft shadow from clouds onto the surface by sampling the cloud field
    // at a position offset toward the sun. Cloud noise is sampled in LOCAL planet
    // space (so clouds rotate with the surface), but `sun_dir` is in WORLD space.
    // Rotate the sun into the planet's local frame before mixing — otherwise the
    // shadow offset is in the wrong reference frame and visibly slides over the
    // surface as the planet rotates. `u.model` is a pure rotation, so its inverse
    // is its transpose.
    let sun_dir_local    = (transpose(u.model) * vec4<f32>(sun_dir, 0.0)).xyz;
    let cloud_shadow_dir = normalize(dir + sun_dir_local * 0.035);
    let cloud_p_shadow   = cloud_shadow_dir * band_warp * cloud_freq + cloud_off + vec3<f32>(u.misc.y * 0.015, 0.0, 0.0);
    let cloud_raw_shadow = fbm(cloud_p_shadow, 4) * 0.5 + 0.5;
    let cloud_shadow     = smoothstep(cloud_low, cloud_high, cloud_raw_shadow);
    let shadow_factor    = 1.0 - cloud_shadow * 0.55;

    // ---------- Lighting ----------
    let ambient   = u.atmosphere_color.rgb * 0.06 + vec3<f32>(0.015);
    let n_dot_l_s = n_dot_l * shadow_factor;
    var lit = surface * (ambient + n_dot_l_s);

    // Ocean: Fresnel sky reflection + tight specular sun spot.
    // Fresnel mix kept modest so the limb doesn't read as a bright ring of sky.
    if (!above_water) {
        let cos_v = max(dot(world_normal, view_dir), 0.0);
        let f0 = 0.02;
        let fresnel = f0 + (1.0 - f0) * pow(1.0 - cos_v, 5.0);
        let sky_tint = u.atmosphere_color.rgb * (0.45 + n_dot_l * 0.5);
        lit = mix(lit, sky_tint, fresnel * 0.45);

        // Tight sun glint — high exponent keeps it a small bright dot rather than
        // a wide blob that bloom would smear into a halo.
        let halfway = normalize(sun_dir + view_dir);
        let spec = pow(max(dot(world_normal, halfway), 0.0), 280.0);
        lit = lit + vec3<f32>(spec) * 0.9 * n_dot_l_s;
    }

    // ---------- Cloud composite ----------
    // Sample the cloud field a second time at a slightly higher "altitude"
    // (offset toward the sun in local space). If that upper layer is dense,
    // this pixel is sitting under a cloud and should read darker — gives
    // clouds a 3D volume feel rather than a flat painted layer.
    let upper_dir = normalize(dir + sun_dir_local * 0.020);
    let upper_p = upper_dir * band_warp * cloud_freq + cloud_off + vec3<f32>(u.misc.y * 0.015, 0.0, 0.0);
    let upper_raw = fbm(upper_p, 4) * 0.5 + 0.5;
    let upper_density = smoothstep(cloud_low, cloud_high, upper_raw);
    let cloud_self_shadow = 1.0 - upper_density * 0.55;

    // Silver lining: mid-density edges read brighter than the dense centre.
    // Cloud peak brightness kept under sRGB-1.0 so the bloom pass can't latch
    // onto the lit cloud tops and smear them into a giant white blob.
    //
    // Tint the cloud body toward the atmosphere colour as density rises — at
    // Earth-ish density (≤ 0.6) clouds are white-ish, but for thick exotic
    // atmospheres (Venus's sulfuric, dense tainted) the clouds pick up the
    // atmosphere's hue instead of reading generic-white.
    let lining = smoothstep(0.18, 0.45, cloud_density)
                * (1.0 - smoothstep(0.5, 0.85, cloud_density));
    let atm_d = u.misc.x;
    let cloud_tint_amt = smoothstep(0.55, 1.10, atm_d);
    let cloud_tint = mix(vec3<f32>(0.93), u.atmosphere_color.rgb * 1.25, cloud_tint_amt * 0.7);
    let cloud_lit = cloud_tint * (ambient + n_dot_l * 0.92 * cloud_self_shadow) * (1.0 + lining * 0.35);
    lit = mix(lit, cloud_lit, cloud_density * 0.85);

    // ---------- City lights ----------
    // High-population worlds glow on the night side. Sampled procedurally so
    // populated regions cluster along coasts and along habitable mid-latitudes
    // rather than uniformly. Visible only on land, on the dark hemisphere,
    // not buried under cloud cover.
    let population = u.world_features.y;
    if (population > 0.02 && above_water) {
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
        let urban     = clustered * dotted * coast_bias * habit_lat;
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

    return vec4<f32>(lit, 1.0);
}
