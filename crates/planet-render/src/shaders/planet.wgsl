// Procedural planet shader.
//
// Vertex shader displaces the cubesphere mesh along its normal using FBM noise.
// Fragment shader recomputes the height field for per-pixel normals, blends biome
// colors, lights with a directional sun, layers procedural clouds, and adds a
// Fresnel atmosphere rim. Output is linear; framebuffer is sRGB so gamma is automatic.

struct Uniforms {
    view_proj:       mat4x4<f32>,
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

// Combined continental + ridged terrain field. Result is roughly in [-1, 1] so
// downstream biome thresholds are predictable.
fn terrain_field(dir: vec3<f32>) -> f32 {
    let freq = u.planet_params.z;
    let oct  = i32(u.planet_params.w);
    let off  = u.seed_block.xyz;
    let p = dir * freq + off;
    let continents = fbm(p, oct);                                  // ~[-1, 1]
    let ridges     = ridged_fbm(p * 2.7 + vec3<f32>(13.7, 91.3, 47.1), max(oct - 1, 2)); // ~[0, 1]
    // Push continents toward bi-modal (clearer ocean / land split) and add ridge detail.
    let shaped = sign(continents) * pow(abs(continents), 0.85);
    return clamp(shaped * 0.85 + (ridges - 0.55) * 0.30, -1.0, 1.0);
}

// ---------- Vertex ----------

struct VsIn {
    @location(0) position: vec3<f32>,
};

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) world_pos: vec3<f32>,
    @location(1) sphere_dir: vec3<f32>,
    @location(2) elevation: f32,
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
    o.clip = u.view_proj * vec4<f32>(world, 1.0);
    o.world_pos = world;
    o.sphere_dir = dir;
    o.elevation = h;
    return o;
}

// ---------- Fragment ----------

fn aces(c: vec3<f32>) -> vec3<f32> {
    let a = 2.51; let b = 0.03; let cc = 2.43; let d = 0.59; let e = 0.14;
    return clamp((c * (a * c + b)) / (c * (cc * c + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let dir = normalize(in.sphere_dir);
    let h = in.elevation;
    let sea_h = u.planet_params.x * 2.0 - 1.0;
    let mountain_amp = u.planet_params.y;
    let above_water = h > sea_h;
    let above_amt = max(h - sea_h, 0.0);

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
    if (above_water) {
        let dx = (max(ht - sea_h, 0.0) - max(h0 - sea_h, 0.0)) * mountain_amp / eps;
        let dy = (max(hb - sea_h, 0.0) - max(h0 - sea_h, 0.0)) * mountain_amp / eps;
        local_normal = normalize(dir - tangent * dx - bitangent * dy);
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

    // ---------- Lighting ----------
    let ambient = u.atmosphere_color.rgb * 0.06 + vec3<f32>(0.015);
    var lit = surface * (ambient + n_dot_l);

    // Specular highlights on water
    if (!above_water) {
        let halfway = normalize(sun_dir + view_dir);
        let spec = pow(max(dot(world_normal, halfway), 0.0), 80.0);
        lit = lit + vec3<f32>(spec) * 0.65 * n_dot_l;
    }

    // ---------- Cloud layer ----------
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
    let cloud_lit = vec3<f32>(1.0) * (ambient + n_dot_l * 1.05);
    lit = mix(lit, cloud_lit, cloud_density * 0.85);

    // ---------- Atmosphere rim glow (Fresnel) ----------
    let fresnel = pow(1.0 - max(dot(world_normal, view_dir), 0.0), 3.2);
    let atmo_density = u.misc.x;
    let lit_side = clamp(n_dot_l * 1.7 + 0.18, 0.0, 1.6);
    let atmo = u.atmosphere_color.rgb * fresnel * atmo_density * lit_side;
    lit = lit + atmo;

    // Subtle night-side ambient (so the dark side isn't pitch black on a thick-atmo planet)
    lit = lit + u.atmosphere_color.rgb * (1.0 - n_dot_l) * 0.015 * atmo_density;

    return vec4<f32>(aces(lit), 1.0);
}
