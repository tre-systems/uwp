// Procedural starfield + faint Milky Way band, plus raymarched moons,
// rings and satellites that sit in space around the planet. Each hit
// writes per-pixel depth so the planet mesh (drawn after) occludes the
// far half of a ring, hides moons behind it, etc.
//
// The starfield samples the celestial sphere via (lon, lat) — so stars
// stay anchored to the sky and visibly rotate as the camera orbits the
// planet, rather than being painted onto the screen.

const TAU: f32 = 6.2831853;
const PI: f32 = 3.1415926535;

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

fn hash21(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
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

// ---------- Stellar colour ----------
// Map a temperature index t in [0, 1] to an RGB tint that roughly approximates
// the blackbody locus over the stellar B-V range (M-class red at 0, hot blue
// O-class at 1). Used so the starfield isn't pure white — real long-exposure
// star photographs show clear colour variation.
fn star_color(t: f32) -> vec3<f32> {
    // Three reference colours along the locus.
    let red  = vec3<f32>(1.0, 0.55, 0.32);   // ~3000 K, M-class
    let sun  = vec3<f32>(1.0, 0.93, 0.85);   // ~5800 K, G-class
    let blue = vec3<f32>(0.78, 0.85, 1.0);   // ~12000 K, B-class
    return mix(mix(red, sun, smoothstep(0.0, 0.55, t)),
               blue,
               smoothstep(0.55, 1.0, t));
}

// Map a view direction to a (lon, lat)-based sky UV. Both components are
// scaled so each cell of star_layer covers a visually similar angular
// resolution across the sphere (lat is doubled vs lon because lat sweeps π
// while lon sweeps 2π).
fn sky_uv(d: vec3<f32>) -> vec2<f32> {
    let lon = atan2(d.z, d.x) / TAU;                // [-0.5, 0.5]
    let lat = asin(clamp(d.y, -1.0, 1.0)) / PI;     // [-0.5, 0.5]
    return vec2<f32>(lon * 4.0, lat * 2.0);
}

// Returns RGB contribution from a single star layer at sky uv. `scale` is
// cells per unit; `density` is the fraction of cells that host a star;
// `mag_bias` boosts brighter populations (0 = average; positive = magnitude
// concentrated toward bright; negative = mostly dim).
//
// Per-cell hash drives: star position inside the cell, brightness (log
// distribution), colour temperature, and twinkle phase. Profile is a tight
// gaussian for the core plus a faint exponential halo for the brightest
// stars — closer to a real telescope PSF than the smoothstep disc the
// previous implementation used.
fn star_layer(uv: vec2<f32>, scale: f32, density: f32, mag_bias: f32, time: f32) -> vec3<f32> {
    let cell = floor(uv * scale);
    let local = fract(uv * scale);

    let h_present = hash21(cell);
    if (h_present > density) { return vec3<f32>(0.0); }

    // Star position inside the cell (avoid the very edges so neighbour cells
    // don't double-up at boundaries).
    let h_x = hash21(cell + vec2<f32>(17.31, 41.7));
    let h_y = hash21(cell + vec2<f32>(53.9, 19.2));
    let star_pos = vec2<f32>(0.15 + 0.7 * h_x, 0.15 + 0.7 * h_y);
    let d = distance(local, star_pos);

    // Log-normal-ish magnitude distribution: most stars are dim, a tiny
    // fraction are bright. `mag_bias` shifts the centre of the distribution.
    let h_mag = hash21(cell + vec2<f32>(89.0, 0.7));
    let mag = pow(h_mag, 6.0) * 0.85 + 0.10 + mag_bias;

    // Tight gaussian core. sigma in cell units — kept small so stars read as
    // pixel-scale points rather than blobs.
    let sigma = 0.012;
    let core = exp(-d * d / (2.0 * sigma * sigma));

    // Halo only matters for bright stars. Falls off much faster than a real
    // diffraction halo so dim stars don't bleed into each other.
    let halo_sigma = 0.045;
    let halo = exp(-d * d / (2.0 * halo_sigma * halo_sigma))
             * smoothstep(0.55, 0.95, mag) * 0.35;

    // Four-point diffraction spike on the very brightest stars only. The
    // cross-shape reads like an unresolved point source captured by a
    // telescope (or by long-exposure astrophotography), which is the visual
    // grammar a human associates with "bright star" rather than "white dot".
    let spike_mask = smoothstep(0.85, 1.05, mag);
    let dx = local.x - star_pos.x;
    let dy = local.y - star_pos.y;
    let spike_h = exp(-dy * dy * 3500.0) * exp(-abs(dx) * 9.0);
    let spike_v = exp(-dx * dx * 3500.0) * exp(-abs(dy) * 9.0);
    let spike = (spike_h + spike_v) * spike_mask * 0.45;

    // Scintillation — small intensity wobble. Per-star phase prevents the
    // whole sky from breathing in unison.
    let phase = hash21(cell + vec2<f32>(7.7, 3.1)) * TAU;
    let twinkle = 0.85 + 0.15 * sin(time * 1.3 + phase);

    // Colour temperature: a slight bias toward sun-like (most main-sequence
    // stars in the visible sky are FGK class). Pure end-points are rare.
    let t_raw = hash21(cell + vec2<f32>(127.4, 311.7));
    let temp_idx = mix(0.30, 0.85, smoothstep(0.0, 1.0, t_raw));
    let tint = star_color(temp_idx);

    // Multiplier boosts the dimmer half of the population above the AgX toe
    // so the dim layer doesn't disappear in tonemap. The bright population's
    // gaussian core already saturates so this only lifts dim values.
    return tint * (core + halo + spike) * mag * twinkle * 1.8;
}

// Milky Way band: a wide dim noise-modulated stripe across the celestial
// sphere. Tilted ~32° from the equator so it sits at a more natural angle
// than a great-circle through the planet's axis. The colour follows the
// classic pinkish-warm/blue-cool emission seen in long-exposure astrophotos.
fn milky_way(ray: vec3<f32>) -> vec3<f32> {
    // Rotate the ray so the galactic plane lies at a chosen inclination.
    let c = 0.848; let s = 0.530;  // 32° tilt
    let ry = vec3<f32>(ray.x * c - ray.y * s, ray.x * s + ray.y * c, ray.z);
    // Distance from the band's midline (sin-of-latitude in tilted frame).
    let band = exp(-ry.y * ry.y * 22.0);

    // Density variation along the band: dark dust lanes interleaved with
    // bright clouds.
    let cloud = fbm3(ry * 5.5 + vec3<f32>(11.3, 7.7, 5.1), 4);
    let dust  = fbm3(ry * 14.0 + vec3<f32>(91.0, 41.3, 17.7), 3);
    let bright = smoothstep(0.30, 0.85, cloud) * (0.55 + 0.45 * (1.0 - smoothstep(0.30, 0.65, dust)));

    // Warm core (hydrogen H-alpha pink) blending out into cool blue scattered
    // dust at the band edges.
    let warm = vec3<f32>(0.65, 0.42, 0.50);
    let cool = vec3<f32>(0.28, 0.36, 0.55);
    let tint = mix(cool, warm, smoothstep(0.4, 0.95, cloud));

    // Multiplier kept low so the band reads as a faint structural hint, not a
    // bright stripe — AGX's midtone response would otherwise dominate stars.
    return tint * band * bright * 0.018;
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

// Compute orbital position. Each moon index gets its own orbital shell
// (1.7, 2.7, 3.8 base radii), with per-moon random jitter inside the shell —
// so multiple moons don't pile up at the same distance from the planet.
fn orbit_pos(slot: i32, idx: f32, base_r: f32, time: f32) -> vec3<f32> {
    let r_h = hash11(idx * 7.13);
    let inc_h = hash11(idx * 13.31 + 4.7);
    let ph_h = hash11(idx * 19.71 + 9.3);
    let shell = 1.7 + f32(slot) * 1.1;          // 1.7, 2.8, 3.9
    let orbit_r = base_r * (shell + r_h * 0.4);
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

    // ---------- Background gradient + stars (anchored to celestial sphere) ----------
    let sky = sky_uv(ray_dir);
    var stars = vec3<f32>(0.0);
    // Three star populations: rare bright (giants), common mid, dense dim.
    stars = stars + star_layer(sky, 28.0,  0.060,  0.25, time);
    stars = stars + star_layer(sky, 72.0,  0.030, -0.05, time) * 0.85;
    stars = stars + star_layer(sky, 180.0, 0.014, -0.18, time) * 0.65;

    // Faint deep-space gradient — sub-percent linear values so the background
    // tonemaps to genuine black, only barely lifted by the atmosphere tint.
    let base_sky = vec3<f32>(0.0008, 0.0010, 0.0018)
                 + u.atmosphere_color.rgb * 0.0015;
    var bg_color = base_sky + milky_way(ray_dir) + stars;

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
        let moon_pos = orbit_pos(i, idx, planet_radius, time);
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
    // Rendered as tiny bright-grey pinpoints — just a ~1 px soft gaussian per
    // satellite. No glint, no halo, no diffraction spikes.
    let pop = u.world_features.y;
    let n_sats = i32(floor(pop * 14.0));
    let inv_pix = vec2<f32>(u.resolution.x, u.resolution.y) * 0.5;
    for (var i: i32 = 0; i < 14; i = i + 1) {
        if (i >= n_sats) { break; }
        let idx = f32(i + 100) + u.seed_block.x * 0.041 + u.seed_block.y * 0.077;
        let r_h    = hash11(idx * 5.7);
        let inc_h  = hash11(idx * 11.3 + 1.1);
        let node_h = hash11(idx * 17.1 + 2.7);
        let ph_h   = hash11(idx * 23.9 + 5.3);
        let sat_r = planet_radius * mix(1.08, 1.35, r_h);

        // Proper great-circle orbit in a randomly oriented plane through the
        // planet's centre. n_axis is the orbital normal (angular-momentum
        // direction), uniformly distributed over the sphere. The satellite
        // traces position = R * (e1*cos θ + e2*sin θ) where e1,e2 span the
        // orbital plane. Angular speed follows Kepler's third law (ω ∝ 1/r^1.5)
        // so outer satellites orbit slower than inner ones.
        let cos_inc = 2.0 * inc_h - 1.0;
        let sin_inc = sqrt(max(0.0, 1.0 - cos_inc * cos_inc));
        let node_a = node_h * TAU;
        let n_axis = vec3<f32>(sin_inc * cos(node_a), cos_inc, sin_inc * sin(node_a));
        let helper = select(vec3<f32>(0.0, 0.0, 1.0),
                            vec3<f32>(1.0, 0.0, 0.0),
                            abs(n_axis.z) > 0.95);
        let e1 = normalize(cross(n_axis, helper));
        let e2 = cross(n_axis, e1);
        let omega = 0.04 / pow(sat_r, 1.5);
        let theta = ph_h * TAU + time * omega;
        let sat_pos = (e1 * cos(theta) + e2 * sin(theta)) * sat_r;

        let sat_clip = u.view_proj * vec4<f32>(sat_pos, 1.0);
        if (sat_clip.w <= 0.0) { continue; }
        let sat_ndc = sat_clip.xy / sat_clip.w;
        let diff = (in.ndc - sat_ndc) * inv_pix;
        let r2 = diff.x * diff.x + diff.y * diff.y;
        if (r2 > 4.0) { continue; }  // ≤ ~2 px

        let sat_dist = length(sat_pos - ray_origin);
        if (sat_dist > best_t) { continue; }

        let intensity = exp(-r2 * 1.5);
        if (intensity < 0.08) { continue; }
        best_color = vec3<f32>(0.92) * intensity;
        best_t = sat_dist;
        has_hit = true;
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
