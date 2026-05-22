// Procedural starfield + faint nebula gradient, plus raymarched moons,
// rings and satellites that sit in space around the planet. Each hit
// writes per-pixel depth so the planet mesh (drawn after) occludes the
// far half of a ring, hides moons behind it, etc.

const TAU: f32 = 6.2831853;

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) ndc: vec2<f32>,
};

struct BgOut {
    @location(0) color: vec4<f32>,
    @builtin(frag_depth) depth: f32,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {
    var pos = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 3.0, -1.0),
        vec2<f32>(-1.0,  3.0),
    );
    var o: VsOut;
    o.clip = vec4<f32>(pos[vi], 0.9999, 1.0);
    o.ndc = pos[vi];
    return o;
}

fn hash11(x: f32) -> f32 {
    return fract(sin(x * 12.9898 + 78.233) * 43758.5453);
}

fn hash31(p: vec3<f32>) -> f32 {
    return fract(sin(dot(p, vec3<f32>(12.9898, 78.233, 37.719))) * 43758.5453);
}

// Smooth value noise — trilinear interp over hash31 lattice. Output [0, 1].
fn value_noise3(p: vec3<f32>) -> f32 {
    let i = floor(p);
    let f = p - i;
    let s = f * f * (3.0 - 2.0 * f);
    let n000 = hash31(i + vec3<f32>(0.0, 0.0, 0.0));
    let n100 = hash31(i + vec3<f32>(1.0, 0.0, 0.0));
    let n010 = hash31(i + vec3<f32>(0.0, 1.0, 0.0));
    let n110 = hash31(i + vec3<f32>(1.0, 1.0, 0.0));
    let n001 = hash31(i + vec3<f32>(0.0, 0.0, 1.0));
    let n101 = hash31(i + vec3<f32>(1.0, 0.0, 1.0));
    let n011 = hash31(i + vec3<f32>(0.0, 1.0, 1.0));
    let n111 = hash31(i + vec3<f32>(1.0, 1.0, 1.0));
    let nx00 = mix(n000, n100, s.x);
    let nx10 = mix(n010, n110, s.x);
    let nx01 = mix(n001, n101, s.x);
    let nx11 = mix(n011, n111, s.x);
    let nxy0 = mix(nx00, nx10, s.y);
    let nxy1 = mix(nx01, nx11, s.y);
    return mix(nxy0, nxy1, s.z);
}

fn fbm3(p_in: vec3<f32>, octaves: i32) -> f32 {
    var p = p_in;
    var sum = 0.0;
    var amp = 0.5;
    var norm = 0.0;
    for (var i: i32 = 0; i < octaves; i = i + 1) {
        sum = sum + amp * value_noise3(p);
        norm = norm + amp;
        amp = amp * 0.5;
        p = p * 2.07;
    }
    return sum / norm;
}

fn hash21(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn star_layer(uv: vec2<f32>, scale: f32, threshold: f32) -> f32 {
    let g = floor(uv * scale);
    let c = fract(uv * scale);
    let r1 = hash21(g);
    let r2 = hash21(g + vec2<f32>(17.31, 41.7));
    let r3 = hash21(g + vec2<f32>(53.9, 19.2));
    let star_pos = vec2<f32>(r2, r3);
    let d = distance(c, star_pos);
    let star_size = mix(0.03, 0.10, r1);
    let bright = smoothstep(star_size, 0.0, d);
    let mask = smoothstep(threshold, threshold + 0.02, r1);
    return bright * mask * mix(0.5, 1.4, hash21(g + vec2<f32>(89.0, 0.7)));
}

// Ray–sphere intersection: returns the nearest positive t, or -1 on miss.
fn ray_sphere_t(orig: vec3<f32>, dir: vec3<f32>, centre: vec3<f32>, radius: f32) -> f32 {
    let oc = orig - centre;
    let b = dot(oc, dir);
    let c = dot(oc, oc) - radius * radius;
    let h = b * b - c;
    if (h < 0.0) { return -1.0; }
    let s = sqrt(h);
    let t0 = -b - s;
    if (t0 > 0.0) { return t0; }
    let t1 = -b + s;
    return t1;
}

// Compute orbital position. Three independent random params (radius, inclination,
// initial phase). Orbit precesses with planet time at a Kepler-ish rate (outer
// bodies move slower). Radii kept tight enough (1.2 .. 1.55 base_r) that the
// orbit stays inside the default camera frustum — at this view distance,
// anything past ~1.6 base radii consistently swings off-screen.
fn orbit_pos(idx: f32, base_r: f32, time: f32) -> vec3<f32> {
    let r_h = hash11(idx * 7.13);
    let inc_h = hash11(idx * 13.31 + 4.7);
    let ph_h = hash11(idx * 19.71 + 9.3);
    let orbit_r = base_r * (1.20 + r_h * 0.35);
    let inclination = (inc_h - 0.5) * 0.6;
    let omega = 0.06 / orbit_r;
    let phase = ph_h * TAU + time * omega;
    let cp = cos(phase); let sp = sin(phase);
    let ci = cos(inclination); let si = sin(inclination);
    // Orbit plane tilted from XZ by `inclination` around X axis.
    return vec3<f32>(cp * orbit_r, sp * si * orbit_r, sp * ci * orbit_r);
}

@fragment
fn fs_main(in: VsOut) -> BgOut {
    let aspect = u.resolution.z;
    let uv = vec2<f32>(in.ndc.x * aspect, in.ndc.y);

    // ---------- Background gradient + stars ----------
    let glow = smoothstep(2.2, 0.0, length(uv - vec2<f32>(-0.3, 0.2)));
    let base = mix(
        vec3<f32>(0.005, 0.006, 0.012),
        u.atmosphere_color.rgb * 0.07,
        glow * 0.6
    );
    var stars = 0.0;
    stars = stars + star_layer(uv, 35.0,  0.985);
    stars = stars + star_layer(uv, 90.0,  0.992) * 0.7;
    stars = stars + star_layer(uv, 220.0, 0.996) * 0.45;
    let twinkle = 0.9 + 0.1 * sin(u.misc.y * 1.3 + uv.x * 30.0 + uv.y * 20.0);
    var bg_color = base + vec3<f32>(stars) * twinkle;

    // ---------- View ray ----------
    let ndc_near = vec4<f32>(in.ndc.x, in.ndc.y, 0.0, 1.0);
    let ndc_far  = vec4<f32>(in.ndc.x, in.ndc.y, 1.0, 1.0);
    let w_near = u.inv_view_proj * ndc_near;
    let w_far  = u.inv_view_proj * ndc_far;
    let p_near = w_near.xyz / w_near.w;
    let p_far  = w_far.xyz / w_far.w;
    let ray_origin = u.camera_pos.xyz;
    let ray_dir = normalize(p_far - p_near);

    let sun_dir = normalize(u.sun_dir.xyz);
    let planet_radius = u.resolution.w;
    let time = u.misc.y;

    var best_t = 1e9;
    var best_color = vec3<f32>(0.0);
    var has_hit = false;

    // ---------- Moons ----------
    // Count derived from a seed hash: roughly 0=40%, 1=35%, 2=20%, 3=5%.
    let moon_h = hash31(u.seed_block.xyz * 0.13 + vec3<f32>(7.1, 3.7, -1.9));
    var n_moons: i32 = 0;
    if (moon_h > 0.40) { n_moons = 1; }
    if (moon_h > 0.75) { n_moons = 2; }
    if (moon_h > 0.95) { n_moons = 3; }
    for (var i: i32 = 0; i < 3; i = i + 1) {
        if (i >= n_moons) { break; }
        let idx = f32(i + 1) + u.seed_block.x * 0.073 + u.seed_block.y * 0.131;
        let moon_pos = orbit_pos(idx, planet_radius, time);
        let moon_radius = planet_radius * mix(0.10, 0.22, hash11(idx * 5.9));
        let t = ray_sphere_t(ray_origin, ray_dir, moon_pos, moon_radius);
        if (t > 0.0 && t < best_t) {
            let hit_pos = ray_origin + ray_dir * t;
            let n = normalize(hit_pos - moon_pos);
            // Moon surface — multi-octave noise on the unit normal gives
            // continental-scale dark maria, mid-scale pockmarks, fine grain.
            // Stratified into highlands (bright) and maria (dark) regions
            // like Earth's Moon.
            let surf_seed = vec3<f32>(idx * 13.7, idx * 7.3, idx * 19.1);
            let h_low = fbm3(n * 1.8 + surf_seed, 3);
            let h_mid = fbm3(n * 6.0 + surf_seed * 1.3, 3);
            let h_hi  = fbm3(n * 18.0 + surf_seed * 0.9, 2);
            let maria_factor = smoothstep(0.42, 0.65, h_low) * 0.85;
            let highland = vec3<f32>(0.66, 0.62, 0.56);
            let maria    = vec3<f32>(0.24, 0.22, 0.20);
            let base_tone = mix(highland, maria, maria_factor);
            // Pockmark texture darkens patches like rough cratered terrain.
            let pock = (h_mid - 0.5) * 0.30 + (h_hi - 0.5) * 0.18;
            let surface = base_tone * (1.0 + pock);
            let n_dot_l = max(dot(n, sun_dir), 0.0);
            best_color = surface * (n_dot_l * 0.95 + 0.03);
            best_t = t;
            has_hit = true;
        }
    }

    // ---------- Rings ----------
    // ~28% of planets get a ring system, lying in the planet's equatorial plane
    // (rotates with axial tilt via u.model).
    let ring_h = hash31(u.seed_block.xyz * 0.27 + vec3<f32>(31.0, -17.0, 53.0));
    if (ring_h > 0.72) {
        let ring_normal = normalize((u.model * vec4<f32>(0.0, 1.0, 0.0, 0.0)).xyz);
        let denom = dot(ray_dir, ring_normal);
        if (abs(denom) > 1e-4) {
            let t = -dot(ray_origin, ring_normal) / denom;
            if (t > 0.0 && t < best_t) {
                let hit_pos = ray_origin + ray_dir * t;
                let radial = length(hit_pos);
                let inner = planet_radius * 1.35;
                let outer = planet_radius * (2.1 + hash11(ring_h * 11.0) * 0.6);
                if (radial > inner && radial < outer) {
                    let r_norm = (radial - inner) / (outer - inner);
                    // Multiple noise bands stacked for Cassini-division feel.
                    let band1 = 0.5 + 0.5 * sin(r_norm * 28.0 + hash11(ring_h) * TAU);
                    let band2 = 0.5 + 0.5 * sin(r_norm * 9.7 + hash11(ring_h * 3.0) * TAU);
                    let band3 = 0.5 + 0.5 * sin(r_norm * 73.0);
                    let edge_in = smoothstep(0.0, 0.05, r_norm);
                    let edge_out = 1.0 - smoothstep(0.92, 1.0, r_norm);
                    let density = band1 * (0.4 + band2 * 0.6) * (0.6 + band3 * 0.4) * edge_in * edge_out;
                    if (density > 0.18) {
                        // Sun lighting: lit on whichever side the sun is on.
                        let lit = abs(dot(ring_normal, sun_dir)) * 0.7 + 0.15;
                        let ice_tint  = vec3<f32>(0.88, 0.84, 0.74);
                        let dust_tint = vec3<f32>(0.45, 0.38, 0.28);
                        let ring_color = mix(dust_tint, ice_tint, smoothstep(0.2, 0.8, density));
                        best_color = ring_color * lit * (0.4 + density * 0.9);
                        best_t = t;
                        has_hit = true;
                    }
                }
            }
        }
    }

    // ---------- Satellites ----------
    // Count scales with population_intensity, which already encodes pop * tech.
    // Range 0 .. ~20 bright pinpoints in low orbit, drifting with time.
    let pop = u.world_features.y;
    let n_sats = i32(floor(pop * 22.0));
    for (var i: i32 = 0; i < 22; i = i + 1) {
        if (i >= n_sats) { break; }
        let idx = f32(i + 100) + u.seed_block.x * 0.041 + u.seed_block.y * 0.077;
        let r_h = hash11(idx * 5.7);
        let lat_h = hash11(idx * 11.3 + 1.1);
        let lon_h = hash11(idx * 17.1 + 2.7);
        let sat_r = planet_radius * mix(1.08, 1.35, r_h);
        let lat = (lat_h - 0.5) * 3.14159;
        let lon = lon_h * TAU + time * (0.45 / sat_r);
        let cl = cos(lat); let sl = sin(lat);
        let sat_pos = vec3<f32>(cl * cos(lon), sl, cl * sin(lon)) * sat_r;
        let to_sat = sat_pos - ray_origin;
        let along = dot(to_sat, ray_dir);
        if (along > 0.0 && along < best_t) {
            let perp = length(to_sat - ray_dir * along);
            // Angular size threshold gives ~1-2 pixels at default camera distance.
            let pix = along * 0.0018;
            if (perp < pix * 2.5) {
                let intensity = 1.0 - smoothstep(0.0, pix * 2.5, perp);
                best_color = vec3<f32>(1.0, 0.96, 0.86) * intensity * 1.4;
                best_t = along;
                has_hit = true;
            }
        }
    }

    // ---------- Output ----------
    var out: BgOut;
    if (has_hit) {
        out.color = vec4<f32>(best_color, 1.0);
        let world_hit = ray_origin + ray_dir * best_t;
        let clip = u.view_proj * vec4<f32>(world_hit, 1.0);
        out.depth = clip.z / clip.w;
    } else {
        out.color = vec4<f32>(bg_color, 1.0);
        out.depth = 0.9999;
    }
    return out;
}
