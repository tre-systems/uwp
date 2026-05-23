// System-overview render — fullscreen triangle that paints the entire scene:
// background stars, the central star (raymarched emissive sphere with limb
// darkening and corona), the orbital paths of each planet (raymarched faint
// rings in the star's equatorial plane), and the planets themselves
// (raymarched spheres at their current orbital position).
//
// This shader is the *only* draw call in system view. The detail-render
// planet/atmosphere pipelines are skipped.

@group(1) @binding(0) var<uniform> sys: SystemData;

const TAU: f32 = 6.2831853;
const PI:  f32 = 3.1415926535;
const MAX_PLANETS: u32 = 16u;

// Packed system data. Layout matches `SystemUniforms` in renderer.rs.
//   planets[2i  ]: xyz = world position, w = display radius
//   planets[2i+1]: xyz = base colour,    w = orbital radius (scene units)
//   moons[i]     : xyz = world position, w = display radius (sign = icy flag)
//   belts[i]     : x = inner_au, y = outer_au, z = density [0..1]
struct SystemData {
    /// x = planet count, y = star display radius, z = star intensity,
    /// w = moon count.
    info: vec4<f32>,
    /// xyz = star colour, w = belt count.
    star_color: vec4<f32>,
    planets: array<vec4<f32>, 32>,
    moons: array<vec4<f32>, 32>,
    belts: array<vec4<f32>, 4>,
};

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

fn hash11(x: f32) -> f32 { return fract(sin(x * 12.9898 + 78.233) * 43758.5453); }
fn hash21(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn star_color_temp(t: f32) -> vec3<f32> {
    let red  = vec3<f32>(1.0, 0.55, 0.32);
    let sun  = vec3<f32>(1.0, 0.93, 0.85);
    let blue = vec3<f32>(0.78, 0.85, 1.0);
    return mix(mix(red, sun, smoothstep(0.0, 0.55, t)),
               blue, smoothstep(0.55, 1.0, t));
}

fn sky_uv(d: vec3<f32>) -> vec2<f32> {
    let lon = atan2(d.z, d.x) / TAU;
    let lat = asin(clamp(d.y, -1.0, 1.0)) / PI;
    return vec2<f32>(lon * 4.0, lat * 2.0);
}

// Pixel-scale gaussian-PSF star — same recipe as background.wgsl, kept here
// so this shader runs standalone.
fn star_point(uv: vec2<f32>, scale: f32, density: f32, mag_bias: f32) -> vec3<f32> {
    let cell = floor(uv * scale);
    let local = fract(uv * scale);
    let h_present = hash21(cell);
    if (h_present > density) { return vec3<f32>(0.0); }
    let h_x = hash21(cell + vec2<f32>(17.31, 41.7));
    let h_y = hash21(cell + vec2<f32>(53.9, 19.2));
    let star_pos = vec2<f32>(0.15 + 0.7 * h_x, 0.15 + 0.7 * h_y);
    let d = distance(local, star_pos);
    let h_mag = hash21(cell + vec2<f32>(89.0, 0.7));
    let mag = pow(h_mag, 6.0) * 0.85 + 0.10 + mag_bias;
    let core = exp(-d * d / (2.0 * 0.012 * 0.012));
    let halo = exp(-d * d / (2.0 * 0.045 * 0.045)) * smoothstep(0.55, 0.95, mag) * 0.35;
    let t_raw = hash21(cell + vec2<f32>(127.4, 311.7));
    let tint = star_color_temp(mix(0.30, 0.85, t_raw));
    return tint * (core + halo) * mag * 1.6;
}

// Ray-sphere: nearest positive t or -1.
fn ray_sphere(orig: vec3<f32>, dir: vec3<f32>, centre: vec3<f32>, radius: f32) -> f32 {
    let oc = orig - centre;
    let b = dot(oc, dir);
    let c = dot(oc, oc) - radius * radius;
    let h = b * b - c;
    if (h < 0.0) { return -1.0; }
    let s = sqrt(h);
    let t0 = -b - s;
    if (t0 > 0.0) { return t0; }
    return -b + s;
}

// AgX display transform (matches atmosphere.wgsl).
fn agx(c_in: vec3<f32>) -> vec3<f32> {
    let m1 = mat3x3<f32>(
        0.842479062, 0.0423282, 0.0423756,
        0.0784335,   0.878468,  0.0784336,
        0.0792237,   0.0791661, 0.879142,
    );
    let min_ev = -8.0;
    let max_ev =  4.026069;
    var v = m1 * max(c_in, vec3<f32>(0.0));
    v = log2(max(v, vec3<f32>(1e-10)));
    v = clamp((v - min_ev) / (max_ev - min_ev), vec3<f32>(0.0), vec3<f32>(1.0));
    let x  = v;
    let x2 = x * x;
    let x4 = x2 * x2;
    let s  = 15.5 * x4 * x2
           - 40.14 * x4 * x
           + 31.96 * x4
           -  6.868 * x2 * x
           +  0.4298 * x2
           +  0.1191 * x
           -  0.00232;
    let m2 = mat3x3<f32>(
         1.196879, -0.0528015, -0.0528992,
        -0.0980219,  1.151944, -0.0980505,
        -0.0989032, -0.0989030, 1.151013,
    );
    return m2 * s;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    // Reconstruct view ray.
    let ndc_near = vec4<f32>(in.ndc.x, in.ndc.y, 0.0, 1.0);
    let ndc_far  = vec4<f32>(in.ndc.x, in.ndc.y, 1.0, 1.0);
    let w_near = u.inv_view_proj * ndc_near;
    let w_far  = u.inv_view_proj * ndc_far;
    let p_near = w_near.xyz / w_near.w;
    let p_far  = w_far.xyz / w_far.w;
    let ray_origin = u.camera_pos.xyz;
    let ray_dir = normalize(p_far - p_near);

    // ---------- Background ----------
    let sky = sky_uv(ray_dir);
    var stars = vec3<f32>(0.0);
    stars = stars + star_point(sky, 28.0,  0.060,  0.25);
    stars = stars + star_point(sky, 72.0,  0.030, -0.05) * 0.85;
    stars = stars + star_point(sky, 180.0, 0.014, -0.18) * 0.65;
    var color = vec3<f32>(0.0008, 0.0010, 0.0018) + stars;

    var best_t = 1e9;
    var hit_color = vec3<f32>(0.0);
    var has_hit = false;

    // ---------- Orbit rings ----------
    // Render each orbit as a thin ring lying in the y=0 plane.
    let n_planets = i32(sys.info.x);
    let ring_n = vec3<f32>(0.0, 1.0, 0.0);
    let denom = dot(ray_dir, ring_n);
    if (abs(denom) > 1e-5) {
        let t_plane = -dot(ray_origin, ring_n) / denom;
        if (t_plane > 0.0) {
            let p = ray_origin + ray_dir * t_plane;
            let r = length(p.xz);
            // Find the nearest orbit radius to this hit point and check if
            // we're within the ring band.
            var nearest_diff = 1e9;
            var orbit_tint = vec3<f32>(0.5, 0.6, 0.9);
            for (var i: i32 = 0; i < i32(MAX_PLANETS); i = i + 1) {
                if (i >= n_planets) { break; }
                let orbit_r = sys.planets[u32(i) * 2u + 1u].w;
                let band_width = max(orbit_r * 0.0035, 0.0008 * length(p - ray_origin) * 0.01);
                let diff = abs(r - orbit_r);
                if (diff < band_width && diff < nearest_diff) {
                    nearest_diff = diff;
                    // Tint orbit by planet body colour for visual association.
                    orbit_tint = sys.planets[u32(i) * 2u + 1u].xyz * 0.55 + vec3<f32>(0.25);
                }
            }
            if (nearest_diff < 1e8) {
                // Fall off with distance to keep distant orbits readable.
                let dist_falloff = 1.0 / (1.0 + t_plane * 0.005);
                color = color + orbit_tint * 0.18 * dist_falloff;
            }
        }
    }

    // ---------- Asteroid belts ----------
    // Render belts as a faintly mottled band in the y=0 plane between
    // inner_au and outer_au. We add to `color` (the background) so belts
    // sit behind planets/moons via the standard hit-test ordering.
    let n_belts = i32(sys.star_color.w);
    if (abs(denom) > 1e-5 && n_belts > 0) {
        let t_plane2 = -dot(ray_origin, ring_n) / denom;
        if (t_plane2 > 0.0) {
            let p = ray_origin + ray_dir * t_plane2;
            let r = length(p.xz);
            for (var bi: i32 = 0; bi < 4; bi = bi + 1) {
                if (bi >= n_belts) { break; }
                let belt = sys.belts[u32(bi)];
                let inner = belt.x;
                let outer = belt.y;
                let density = belt.z;
                if (r >= inner && r <= outer) {
                    // Mottled density via 2D hash on the hit point — gives a
                    // grainy look without sampling actual particles.
                    let cell = floor(p.xz * 8.0);
                    let h = hash21(cell);
                    let h2 = hash21(cell + vec2<f32>(13.0, 7.0));
                    let speck = step(0.55, h) * (0.4 + h2 * 0.6);
                    let edge_in  = smoothstep(inner, inner + (outer - inner) * 0.10, r);
                    let edge_out = 1.0 - smoothstep(outer - (outer - inner) * 0.10, outer, r);
                    let band = edge_in * edge_out;
                    let dust = vec3<f32>(0.55, 0.48, 0.40);
                    color = color + dust * (0.12 + speck * 0.35) * density * band;
                }
            }
        }
    }

    // ---------- Planets ----------
    for (var i: i32 = 0; i < i32(MAX_PLANETS); i = i + 1) {
        if (i >= n_planets) { break; }
        let slot_a = sys.planets[u32(i) * 2u + 0u];
        let slot_b = sys.planets[u32(i) * 2u + 1u];
        let p_pos = slot_a.xyz;
        let p_r   = slot_a.w;
        let p_col = slot_b.xyz;
        let t = ray_sphere(ray_origin, ray_dir, p_pos, p_r);
        if (t > 0.0 && t < best_t) {
            let hit_pos = ray_origin + ray_dir * t;
            let n = normalize(hit_pos - p_pos);
            let sun_d = normalize(-p_pos);
            let nl = max(dot(n, sun_d), 0.0);
            let shaded = p_col * (0.08 + nl * 0.95);
            hit_color = shaded;
            best_t = t;
            has_hit = true;
        }
    }

    // ---------- Moons ----------
    let n_moons = i32(sys.info.w);
    for (var i: i32 = 0; i < 32; i = i + 1) {
        if (i >= n_moons) { break; }
        let m = sys.moons[u32(i)];
        let m_pos = m.xyz;
        let m_r = abs(m.w);
        let icy = m.w > 0.0;
        let t = ray_sphere(ray_origin, ray_dir, m_pos, m_r);
        if (t > 0.0 && t < best_t) {
            let hit_pos = ray_origin + ray_dir * t;
            let n = normalize(hit_pos - m_pos);
            let sun_d = normalize(-m_pos);
            let nl = max(dot(n, sun_d), 0.0);
            let base = select(vec3<f32>(0.62, 0.58, 0.54),
                              vec3<f32>(0.92, 0.95, 1.00),
                              icy);
            hit_color = base * (0.10 + nl * 0.90);
            best_t = t;
            has_hit = true;
        }
    }

    // ---------- Star ----------
    let star_radius = sys.info.y;
    let star_t = ray_sphere(ray_origin, ray_dir, vec3<f32>(0.0), star_radius);
    if (star_t > 0.0 && star_t < best_t) {
        let hit_pos = ray_origin + ray_dir * star_t;
        let n = normalize(hit_pos);
        // Limb darkening (Eddington approximation): I(μ) = I₀ (2 + 3μ) / 5.
        let mu = max(dot(n, -ray_dir), 0.0);
        let limb = (2.0 + 3.0 * mu) / 5.0;
        // Granulation: tight noise on the surface for a textured photosphere.
        let g = hash21(floor(n.xz * 80.0) + n.y * 20.0);
        let grain = 0.92 + 0.08 * g;
        let intensity = sys.info.z;
        hit_color = sys.star_color.rgb * limb * grain * intensity;
        best_t = star_t;
        has_hit = true;
    }

    if (has_hit) { color = hit_color; }

    // Corona around the star — view-aligned halo that builds up as the ray
    // gets close to the star's centre direction. Sharply masked at the
    // angular radius of the star disc so it reads as a tight glow rather
    // than a planet-swallowing wash.
    let to_star = -ray_origin;
    let star_dist = length(to_star);
    if (star_dist > 1e-3 && star_t <= 0.0) {
        let star_dir_w = to_star / star_dist;
        let cos_align = max(dot(ray_dir, star_dir_w), 0.0);
        // Angular radius of the star disc as seen from the camera.
        let ang_disc = atan2(star_radius, max(star_dist - star_radius, 1e-3));
        let cos_disc = cos(ang_disc);
        // Outside-the-disc distance (in cosine space). Peaks at the limb
        // (cos_align ≈ cos_disc) and falls off rapidly as the ray angles
        // further from the star. Normalised by disc radius so the corona
        // width scales with the star's apparent size.
        let outside = max(cos_disc - cos_align, 0.0);
        let outside_norm = outside / max(1.0 - cos_disc, 1e-3);
        let corona = exp(-outside_norm * 4.0) * 0.55
                   + exp(-outside_norm * 20.0) * 0.35;
        color = color + sys.star_color.rgb * corona * sys.info.z * 0.40;
    }

    return vec4<f32>(agx(color), 1.0);
}
