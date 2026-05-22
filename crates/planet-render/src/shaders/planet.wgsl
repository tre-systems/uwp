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
    return clamp(shaped * 0.85 + (ridges - 0.55) * 0.30, -1.0, 1.0);
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

    // Slope only contributes above water — the ocean surface is smooth.
    var local_normal: vec3<f32>;
    var slope: f32 = 0.0;
    if (above_water) {
        let dx = (max(ht - sea_h, 0.0) - max(h0 - sea_h, 0.0)) * mountain_amp / (eps * above_range);
        let dy = (max(hb - sea_h, 0.0) - max(h0 - sea_h, 0.0)) * mountain_amp / (eps * above_range);
        local_normal = normalize(dir - tangent * dx - bitangent * dy);
        slope = 1.0 - clamp(dot(local_normal, dir), 0.0, 1.0);
    } else {
        local_normal = dir;
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
        var land   = mix(u.sand_color.rgb, u.land_color.rgb, coast);
        land = mix(land, u.mountain_color.rgb, alpine);

        // Aridity bands: subtropical bands tend toward sand. Kept subtle so green dominates.
        let arid = smoothstep(0.08, 0.30, lat) * (1.0 - smoothstep(0.42, 0.68, lat));
        land = mix(land, u.sand_color.rgb, arid * 0.22);

        // Steep slopes read as exposed rock regardless of elevation — gives cliffs,
        // valleys, river banks a believable rocky texture.
        let rocky = smoothstep(0.06, 0.28, slope);
        land = mix(land, u.mountain_color.rgb, rocky * 0.65);

        // A subtle color noise breaks up the uniform palette so continents read as
        // patchy terrain rather than flat-fill polygons.
        let tint_n = fbm(dir * 9.0 + u.seed_block.xyz + vec3<f32>(101.3, 47.7, -9.1), 3);
        land = land * (0.88 + tint_n * 0.24);

        // Snow only on real peaks or polar regions.
        let snow_alt   = smoothstep(0.68, 0.92, above_amt);
        let snow_polar = smoothstep(ice_lat - 0.04, ice_lat + 0.03, lat);
        let snow = clamp(snow_alt + snow_polar, 0.0, 1.0);
        surface = mix(land, u.snow_color.rgb, snow);
    } else {
        let depth = sea_h - h;
        let shallow = u.ocean_color.rgb * 1.75;
        let deep    = u.ocean_color.rgb * 0.38;
        surface = mix(shallow, deep, smoothstep(0.0, 0.5, depth));
        // Polar ice on water — slightly sharper than the land snow line.
        let polar = smoothstep(ice_lat - 0.015, ice_lat + 0.04, lat);
        surface = mix(surface, u.snow_color.rgb * 0.94, polar);
    }

    // ---------- Cloud noise ----------
    // Sample a second noise field at a different frequency for cloud cover.
    // The smoothstep window is centred so coverage acts intuitively (0 = clear, 1 = overcast).
    let cloud_freq = u.planet_params.z * 2.4;
    let cloud_off  = u.seed_block.xyz + vec3<f32>(213.7, 71.0, -109.4);
    let cloud_p    = dir * cloud_freq + cloud_off + vec3<f32>(u.misc.y * 0.015, 0.0, 0.0);
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
    let cloud_p_shadow   = cloud_shadow_dir * cloud_freq + cloud_off + vec3<f32>(u.misc.y * 0.015, 0.0, 0.0);
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
    // Cloud "silver lining": mid-density edges read brighter than the dense centre.
    // Cloud peak brightness kept under sRGB-1.0 so the bloom pass can't latch onto
    // the lit cloud tops and smear them into a giant white blob over the sun glint.
    //
    // Tint the cloud body toward the atmosphere colour as density rises — at
    // Earth-ish density (≤ 0.6) clouds are white-ish, but for thick exotic
    // atmospheres (Venus's sulfuric, dense tainted, etc.) the clouds pick up
    // the atmosphere's hue so the planet reads as yellow / orange / purple
    // instead of generic-white.
    let lining = smoothstep(0.18, 0.45, cloud_density)
                * (1.0 - smoothstep(0.5, 0.85, cloud_density));
    let atm_d = u.misc.x;
    let cloud_tint_amt = smoothstep(0.55, 1.10, atm_d);
    let cloud_tint = mix(vec3<f32>(0.93), u.atmosphere_color.rgb * 1.25, cloud_tint_amt * 0.7);
    let cloud_lit = cloud_tint * (ambient + n_dot_l * 0.92) * (1.0 + lining * 0.35);
    lit = mix(lit, cloud_lit, cloud_density * 0.85);

    // The atmosphere pass adds Rayleigh + Mie in-scattering + tonemap, so this
    // shader stays in linear HDR. We only emit a faint night-side ambient so the
    // dark hemisphere doesn't read as pure black inside the atmospheric perspective.
    let atmo_density = u.misc.x;
    lit = lit + u.atmosphere_color.rgb * (1.0 - n_dot_l) * 0.020 * atmo_density;

    return vec4<f32>(lit, 1.0);
}
