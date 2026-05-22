// Raymarched atmospheric scattering pass.
// Runs as a fullscreen triangle. Reconstructs a world-space view ray per pixel,
// samples the HDR planet color rendered in the previous pass, then integrates
// Rayleigh + Mie in-scattering along the view ray and composites:
//     final = planet * transmittance + in_scatter
// Finally tonemaps to display.

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
    seed_block:      vec4<f32>,
    planet_params:   vec4<f32>,
    misc:            vec4<f32>,
    resolution:      vec4<f32>,
    world_features:  vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(1) @binding(0) var scene_color: texture_2d<f32>;
@group(1) @binding(1) var scene_sampler: sampler;

const PI: f32 = 3.141592653589793;
const R_PLANET: f32 = 1.0;
const R_ATMO: f32 = 1.075;
const VIEW_STEPS: i32 = 16;
const LIGHT_STEPS: i32 = 6;
const SCALE_R: f32 = 0.024;
const SCALE_M: f32 = 0.0035;
const G_MIE: f32 = 0.76;

// Returns (t_near, t_far). Negative if no intersection.
fn ray_sphere(orig: vec3<f32>, dir: vec3<f32>, radius: f32) -> vec2<f32> {
    let b = dot(orig, dir);
    let c = dot(orig, orig) - radius * radius;
    let h = b * b - c;
    if (h < 0.0) { return vec2<f32>(-1.0, -1.0); }
    let s = sqrt(h);
    return vec2<f32>(-b - s, -b + s);
}

// Atmospheric density at altitude `h` above planet surface.
// .x = Rayleigh, .y = Mie
fn density_at(h: f32) -> vec2<f32> {
    let hh = max(h, 0.0);
    return vec2<f32>(exp(-hh / SCALE_R), exp(-hh / SCALE_M));
}

// Optical depth from `pos` toward the sun (or until the ray would exit the atmosphere).
// Returns vec2(1e9) when the planet body blocks the sun (terminator shadow).
fn light_optical_depth(pos: vec3<f32>, sun: vec3<f32>) -> vec2<f32> {
    let t_atmo = ray_sphere(pos, sun, R_ATMO);
    if (t_atmo.y < 0.0) { return vec2<f32>(0.0); }
    let t_planet = ray_sphere(pos, sun, R_PLANET);
    if (t_planet.x > 0.0) { return vec2<f32>(1e9); }

    let dt = t_atmo.y / f32(LIGHT_STEPS);
    var od = vec2<f32>(0.0);
    for (var i: i32 = 0; i < LIGHT_STEPS; i = i + 1) {
        let t = (f32(i) + 0.5) * dt;
        let p = pos + sun * t;
        let h = length(p) - R_PLANET;
        od = od + density_at(h) * dt;
    }
    return od;
}

fn aces(c: vec3<f32>) -> vec3<f32> {
    let a = 2.51; let b = 0.03; let cc = 2.43; let d = 0.59; let e = 0.14;
    return clamp((c * (a * c + b)) / (c * (cc * c + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) ndc: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {
    var pos = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 3.0, -1.0),
        vec2<f32>(-1.0,  3.0),
    );
    var o: VsOut;
    o.clip = vec4<f32>(pos[vi], 0.0, 1.0);
    o.ndc = pos[vi];
    return o;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    // Reconstruct the view ray by un-projecting NDC near & far points.
    let ndc_near = vec4<f32>(in.ndc.x, in.ndc.y, 0.0, 1.0);
    let ndc_far  = vec4<f32>(in.ndc.x, in.ndc.y, 1.0, 1.0);
    let w_near = u.inv_view_proj * ndc_near;
    let w_far  = u.inv_view_proj * ndc_far;
    let p_near = w_near.xyz / w_near.w;
    let p_far  = w_far.xyz / w_far.w;
    let ray_origin = u.camera_pos.xyz;
    let ray_dir = normalize(p_far - p_near);
    let sun_dir = normalize(u.sun_dir.xyz);

    // Sample the HDR planet color. NDC y is up; texture v is down -> flip.
    let uv = vec2<f32>(in.ndc.x * 0.5 + 0.5, in.ndc.y * -0.5 + 0.5);
    let planet_color = textureSample(scene_color, scene_sampler, uv).rgb;

    let t_atmo = ray_sphere(ray_origin, ray_dir, R_ATMO);
    if (t_atmo.y < 0.0) {
        // Ray misses atmosphere entirely — just tonemap the scene as-is.
        return vec4<f32>(aces(planet_color), 1.0);
    }

    let t_planet = ray_sphere(ray_origin, ray_dir, R_PLANET);
    let hit_planet = t_planet.x > 0.0;
    let t_start = max(t_atmo.x, 0.0);
    let t_end = select(t_atmo.y, t_planet.x, hit_planet);
    if (t_end <= t_start) {
        return vec4<f32>(aces(planet_color), 1.0);
    }

    // Tint Rayleigh coefficients with the atmosphere color so the slider stays meaningful
    // (a reddish atmosphere -> Mars-like sunset feel; cool blue -> Earth).
    let atmo_density = u.misc.x;
    let tint = mix(vec3<f32>(0.65), u.atmosphere_color.rgb, 0.85);
    let beta_r = vec3<f32>(3.5, 8.5, 19.5) * tint * atmo_density;
    let beta_m = vec3<f32>(3.8) * atmo_density;

    let dt = (t_end - t_start) / f32(VIEW_STEPS);
    var od_view = vec2<f32>(0.0);
    var in_scatter_r = vec3<f32>(0.0);
    var in_scatter_m = vec3<f32>(0.0);

    for (var i: i32 = 0; i < VIEW_STEPS; i = i + 1) {
        let t = t_start + (f32(i) + 0.5) * dt;
        let p = ray_origin + ray_dir * t;
        let h = length(p) - R_PLANET;
        let d = density_at(h) * dt;
        od_view = od_view + d;

        let od_light = light_optical_depth(p, sun_dir);
        let tau = beta_r * (od_view.x + od_light.x) + beta_m * (od_view.y + od_light.y);
        let trans = exp(-tau);

        in_scatter_r = in_scatter_r + trans * d.x;
        in_scatter_m = in_scatter_m + trans * d.y;
    }

    // Phase functions evaluated at the view-sun angle.
    let mu = dot(ray_dir, sun_dir);
    let phase_r = (3.0 / (16.0 * PI)) * (1.0 + mu * mu);
    let g2 = G_MIE * G_MIE;
    let phase_m_num = (1.0 - g2) * (1.0 + mu * mu);
    let phase_m_den = (2.0 + g2) * pow(max(1.0 + g2 - 2.0 * G_MIE * mu, 0.001), 1.5);
    // Mie's forward-scatter peak is sharp; clamp it so looking through the
    // atmosphere directly at the sun doesn't punch a white-hot circle through
    // the planet's centre via bloom.
    let phase_m = min((3.0 / (8.0 * PI)) * phase_m_num / phase_m_den, 1.8);

    let sun_intensity = 8.0;
    let scatter = sun_intensity *
        (in_scatter_r * beta_r * phase_r + in_scatter_m * beta_m * phase_m);

    // Final transmittance for the planet color through the atmosphere column we traversed.
    let final_trans = exp(-(beta_r * od_view.x + beta_m * od_view.y));
    var final_color = planet_color * final_trans + scatter;

    // Cheap lens bloom: 12 taps in two rings around the pixel, soft HDR threshold,
    // average, add back. Threshold pushed well past sRGB-1.0 so only genuinely
    // burning highlights (sun glint, sun-disk forward scatter) bloom — keeps the
    // ocean's sun glint a tight bright dot rather than a wide blob.
    let texel = 1.0 / u.resolution.xy;
    var bloom = vec3<f32>(0.0);
    let r_outer = 11.0;
    let r_inner = 5.0;
    for (var i: i32 = 0; i < 12; i = i + 1) {
        let a = f32(i) * 0.5235988;  // 2π / 12
        let off = vec2<f32>(cos(a), sin(a));
        let s1 = textureSampleLevel(scene_color, scene_sampler, uv + off * r_inner * texel, 0.0).rgb;
        let s2 = textureSampleLevel(scene_color, scene_sampler, uv + off * r_outer * texel, 0.0).rgb;
        bloom = bloom
            + max(s1 - vec3<f32>(1.25), vec3<f32>(0.0)) * 0.65
            + max(s2 - vec3<f32>(1.25), vec3<f32>(0.0)) * 0.35;
    }
    bloom = bloom / 12.0;
    bloom = bloom + max(scatter - vec3<f32>(1.7), vec3<f32>(0.0)) * 0.22;
    final_color = final_color + bloom * 0.30;

    return vec4<f32>(aces(final_color), 1.0);
}
