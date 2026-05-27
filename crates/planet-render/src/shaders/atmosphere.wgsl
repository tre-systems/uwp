// Raymarched atmospheric scattering pass.
// Runs as a fullscreen triangle. Reconstructs a world-space view ray per pixel,
// samples the HDR planet color rendered in the previous pass, then integrates
// Rayleigh + Mie + ozone in-scattering along the view ray and composites:
//     final = planet * transmittance + in_scatter
// Finally tonemaps with AGX for display.
//
// References:
//   * Bruneton & Neyret 2008, "Precomputed Atmospheric Scattering" — Rayleigh/Mie/
//     ozone model and integration scheme.
//   * Sébastien Hillaire 2020, "A Scalable and Production Ready Sky and Atmosphere
//     Rendering Technique" — multi-scattering approximation, ozone tent profile.
//   * Troy Sobotka, AgX, https://github.com/sobotka/AgX — display transform.
//     Polynomial fit by bwrensch / Filmic Worlds.

@group(1) @binding(0) var scene_color: texture_2d<f32>;
@group(1) @binding(1) var scene_sampler: sampler;
@group(1) @binding(2) var scene_depth: texture_depth_2d;

const PI: f32 = 3.141592653589793;
const ATMO_REL_THICKNESS: f32 = 0.075;
const VIEW_STEPS: i32 = 12;
const LIGHT_STEPS: i32 = 4;
const SCALE_R: f32 = 0.024;
const SCALE_M: f32 = 0.0035;
const G_MIE: f32 = 0.76;

// Ozone density profile: tent centred at H_OZ with half-width W_OZ
// (matching the Bruneton/Hillaire layer placement, but scaled to our
// relative-thickness atmosphere shell).
const H_OZ: f32 = 0.025;
const W_OZ: f32 = 0.015;

// Returns (t_near, t_far). Negative if no intersection.
fn ray_sphere(orig: vec3<f32>, dir: vec3<f32>, radius: f32) -> vec2<f32> {
    let b = dot(orig, dir);
    let c = dot(orig, orig) - radius * radius;
    let h = b * b - c;
    if (h < 0.0) { return vec2<f32>(-1.0, -1.0); }
    let s = sqrt(h);
    return vec2<f32>(-b - s, -b + s);
}

// Density at altitude `h` for the three atmospheric constituents.
// .x = Rayleigh (exponential, scale height SCALE_R)
// .y = Mie     (exponential, scale height SCALE_M)
// .z = Ozone   (tent profile around H_OZ, mirrors Earth's stratospheric layer)
fn density_at(h: f32) -> vec3<f32> {
    let hh = max(h, 0.0);
    let ozone = max(0.0, 1.0 - abs(hh - H_OZ) / W_OZ);
    return vec3<f32>(exp(-hh / SCALE_R), exp(-hh / SCALE_M), ozone);
}

// Optical depth from `pos` toward the sun (or until the ray would exit the atmosphere).
// Returns vec3(1e9) when the planet body blocks the sun (terminator shadow).
fn light_optical_depth(pos: vec3<f32>, sun: vec3<f32>, r_planet: f32, r_atmo: f32, light_steps: i32) -> vec3<f32> {
    let t_atmo = ray_sphere(pos, sun, r_atmo);
    if (t_atmo.y < 0.0) { return vec3<f32>(0.0); }
    let t_planet = ray_sphere(pos, sun, r_planet);
    if (t_planet.x > 0.0) { return vec3<f32>(1e9); }

    let dt = t_atmo.y / f32(light_steps);
    var od = vec3<f32>(0.0);
    for (var i: i32 = 0; i < LIGHT_STEPS; i = i + 1) {
        if (i >= light_steps) { break; }
        let t = (f32(i) + 0.5) * dt;
        let p = pos + sun * t;
        let h = length(p) - r_planet;
        od = od + density_at(h) * dt;
    }
    return od;
}

#include "chunks/agx.wgsl"

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

    let r_planet = u.resolution.w;
    let r_atmo = r_planet + ATMO_REL_THICKNESS * r_planet;

    let t_atmo = ray_sphere(ray_origin, ray_dir, r_atmo);
    if (t_atmo.y < 0.0) {
        // Ray misses atmosphere entirely — just tonemap the scene as-is.
        return vec4<f32>(agx(planet_color), 1.0);
    }

    let t_planet = ray_sphere(ray_origin, ray_dir, r_planet);
    let hit_planet = t_planet.x > 0.0;

    // Cap integration at whatever opaque scene object is at this pixel
    // (the depth buffer holds the closest hit from the background+planet
    // passes). Without this, scattering bleeds through moons/rings/satellites
    // that sit between the camera and the planet's atmosphere shell.
    let pix = vec2<i32>(in.clip.xy);
    let scene_d = textureLoad(scene_depth, pix, 0);
    let ndc_at_d = vec4<f32>(in.ndc.x, in.ndc.y, scene_d, 1.0);
    let w_at_d = u.inv_view_proj * ndc_at_d;
    let scene_world = w_at_d.xyz / w_at_d.w;
    let scene_dist = length(scene_world - ray_origin);

    let t_start = max(t_atmo.x, 0.0);
    var t_end = select(t_atmo.y, t_planet.x, hit_planet);
    // Prefer the analytic sphere endpoint on planet pixels. The depth buffer
    // stores the tessellated cubesphere, and at close zoom its face quantisation
    // otherwise tints oceans as rectangular patches and stair-steps the limb.
    // Only clip to the depth buffer when something clearly sits in front of the
    // planet body (moons, rings, satellites).
    if (hit_planet) {
        let occluder = scene_dist < (t_planet.x - r_planet * 0.30);
        if (occluder) {
            t_end = min(t_end, scene_dist);
        }
    } else {
        t_end = min(t_end, scene_dist);
    }
    if (t_end <= t_start) {
        return vec4<f32>(agx(planet_color), 1.0);
    }

    let atmo_density = u.misc.x;
    let quality = u.misc.w;
    // Rayleigh tint: a tinted vec3 keeps the slider meaningful while preserving
    // the per-wavelength scattering ratio (blue scatters ~5× more than red on
    // Earth — coefficients (5.8, 13.5, 33.1) in literature, here scaled).
    let tint = mix(vec3<f32>(0.65), u.atmosphere_color.rgb, 0.85);
    let beta_r = vec3<f32>(3.5, 8.5, 19.5) * tint * atmo_density;
    let beta_m = vec3<f32>(3.8) * atmo_density;
    // Ozone absorption — pulls the right spectral notch out of grazing-angle
    // sunlight that gives Earth's twilight its characteristic warm-pink lower
    // band and deeper-blue zenith. Coefficients per Hillaire 2020.
    let beta_o = vec3<f32>(0.650, 1.881, 0.085) * atmo_density * 0.6;

    let view_steps = select(select(6, 8, quality > 0.50), VIEW_STEPS, quality > 0.85);
    let light_steps = select(select(2, 3, quality > 0.50), LIGHT_STEPS, quality > 0.85);
    let dt = (t_end - t_start) / f32(view_steps);
    var od_view = vec3<f32>(0.0);
    var in_scatter_r = vec3<f32>(0.0);
    var in_scatter_m = vec3<f32>(0.0);

    for (var i: i32 = 0; i < VIEW_STEPS; i = i + 1) {
        if (i >= view_steps) { break; }
        let t = t_start + (f32(i) + 0.5) * dt;
        let p = ray_origin + ray_dir * t;
        let h = length(p) - r_planet;
        let d = density_at(h) * dt;
        od_view = od_view + d;

        let od_light = light_optical_depth(p, sun_dir, r_planet, r_atmo, light_steps);
        let tau = beta_r * (od_view.x + od_light.x)
                + beta_m * (od_view.y + od_light.y)
                + beta_o * (od_view.z + od_light.z);
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
    // Mie's forward-scatter peak is sharp; clamp it so looking directly at the
    // sun doesn't punch a white-hot circle through the planet via bloom.
    let phase_m = min((3.0 / (8.0 * PI)) * phase_m_num / phase_m_den, 1.8);

    let sun_intensity = 8.0;
    let single = sun_intensity *
        (in_scatter_r * beta_r * phase_r + in_scatter_m * beta_m * phase_m);

    // Multi-scatter approximation (Hillaire 2020 simplified).
    //
    // The full method precomputes a 2D MS LUT keyed on (sun zenith, height)
    // - we approximate it inline. Multi-scatter brightens with optical
    // depth (more atmosphere -> more bounces) and with sun-above-horizon
    // (most bounced light comes from the lit hemisphere). The 1 - exp form
    // saturates as the atmosphere thickens, matching the closed-form
    // single+multi geometric series. Net effect: thicker / sunlit limbs
    // gain proper sky-blue lift, twilight terminators stay soft, and a
    // night-side viewer still gets the bright crescent rim instead of a
    // hard cut to black.
    let od_view_len = length(od_view);
    let sun_above = clamp(sun_dir.y * 0.5 + 0.5, 0.0, 1.0);
    let ms_strength = (1.0 - exp(-od_view_len * 0.85)) * (0.65 + 0.35 * sun_above);
    // Multi-scatter is itself Rayleigh-tinted but with the phase function
    // averaged out (skylight is roughly isotropic), so we drop the
    // mu-dependent factor and just modulate beta_r alone.
    let ms_ambient = sun_intensity * in_scatter_r * beta_r * ms_strength * (1.0 / (4.0 * PI));
    let scatter = single + ms_ambient * 0.55;

    // Final transmittance for the planet color through the atmosphere column we traversed.
    let final_trans = exp(-(beta_r * od_view.x + beta_m * od_view.y + beta_o * od_view.z));
    var final_color = planet_color * final_trans + scatter;

    // HDR bloom for genuinely burning highlights (sun glint, sun-disk forward
    // scatter, the brightest stars, dense city-light cores). Two ring radii
    // — inner ring weighted higher gives a tighter primary halo, outer ring
    // gives a softer extended glow. Threshold tuned with AgX in mind: well
    // above sRGB-1.0 so ordinary lit scene doesn't bloom, but low enough
    // that ocean glint and city cores reliably register.
    let texel = 1.0 / u.resolution.xy;
    var bloom = vec3<f32>(0.0);
    let r_outer = 13.0;
    let r_inner = 5.0;
    let thr_inner = vec3<f32>(1.05);
    let thr_outer = vec3<f32>(1.30);
    let bloom_taps = select(select(4, 8, quality > 0.50), 12, quality > 0.85);
    for (var i: i32 = 0; i < 12; i = i + 1) {
        if (i >= bloom_taps) { break; }
        let a = f32(i) * 0.5235988;  // 2π / 12
        let off = vec2<f32>(cos(a), sin(a));
        let s1 = textureSampleLevel(scene_color, scene_sampler, uv + off * r_inner * texel, 0.0).rgb;
        let s2 = textureSampleLevel(scene_color, scene_sampler, uv + off * r_outer * texel, 0.0).rgb;
        bloom = bloom
            + max(s1 - thr_inner, vec3<f32>(0.0)) * 0.70
            + max(s2 - thr_outer, vec3<f32>(0.0)) * 0.30;
    }
    bloom = bloom / f32(bloom_taps);
    bloom = bloom + max(scatter - vec3<f32>(1.5), vec3<f32>(0.0)) * 0.25;
    final_color = final_color + bloom * 0.35;

    return vec4<f32>(agx(final_color), 1.0);
}
