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

// Sinless hashes (Dave Hoskins "Hash without Sine"). The background draws every
// detail frame and its value_noise3 issues 8 hash31 per sample, so the old
// fract(sin(...)) form added avoidable transcendental load behind the planet.
fn hash11(x: f32) -> f32 {
    var p = fract(x * 0.1031);
    p = p * (p + 33.33);
    p = p * (p + p);
    return fract(p);
}

fn hash21(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn hash31(p_in: vec3<f32>) -> f32 {
    var p = fract(p_in * 0.1031);
    p = p + dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
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

// Ridged fbm — accentuates the high contour of each noise octave, producing
// line-like ridge structures. Used on icy moons for crack/lineae texture.
fn ridged_fbm3(p_in: vec3<f32>, octaves: i32) -> f32 {
    var p = p_in;
    var sum = 0.0;
    var amp = 0.5;
    var norm = 0.0;
    for (var i: i32 = 0; i < octaves; i = i + 1) {
        let n = 1.0 - abs(value_noise3(p) * 2.0 - 1.0);
        sum = sum + amp * n * n;
        norm = norm + amp;
        amp = amp * 0.5;
        p = p * 2.05;
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

// Compute orbital position. Each moon slot lives in a separate, widely
// spaced shell so two moons can't physically clip into each other (the
// previous 1.7 / 2.8 / 3.9-radii shells were inside Earth-Moon-distance
// scaled down ~30×, and inner pairs would have crossed Roche-limit on
// real bodies). New shells: ~5 / ~15 / ~38 planet radii — closer than
// Earth-Moon (60 R) so the moons still read in-frame at default zoom,
// but separated by enough that two moons in the same system never share
// space. Inclination range widened so the orbital planes are also
// genuinely distinct.
fn orbit_pos(slot: i32, idx: f32, base_r: f32, time: f32) -> vec3<f32> {
    let r_h = hash11(idx * 7.13);
    let inc_h = hash11(idx * 13.31 + 4.7);
    let ph_h = hash11(idx * 19.71 + 9.3);
    let node_h = hash11(idx * 27.19 + 1.7);
    // Shell radii roughly 4-6, 12-18, 30-45 planet radii.
    var shell_min: f32 = 4.0;
    var shell_max: f32 = 6.0;
    if (slot == 1) { shell_min = 12.0; shell_max = 18.0; }
    if (slot == 2) { shell_min = 30.0; shell_max = 45.0; }
    let orbit_r = base_r * mix(shell_min, shell_max, r_h);
    // Inclination ±50° — second and third moons can have steep planes;
    // close-in moons (slot 0) settled into the equatorial plane in real
    // systems through tidal evolution, so we restrict slot 0 to ±15°.
    let inc_range = select(0.9, 0.26, slot == 0);
    let inclination = (inc_h - 0.5) * inc_range;
    let node_a = node_h * TAU;
    // Kepler: ω ∝ R^-1.5. Tuned so the closest moon takes ~1 minute.
    let omega = 0.012 / pow(orbit_r, 1.5);
    let phase = ph_h * TAU + time * omega;
    let cp = cos(phase); let sp = sin(phase);
    let ci = cos(inclination); let si = sin(inclination);
    let cn = cos(node_a); let sn = sin(node_a);
    // Orbit plane: rotate around X by inclination, then around Y by
    // ascending node. Gives a genuinely 3D orbital plane that doesn't
    // align with any other moon's plane by default.
    let p0 = vec3<f32>(cp * orbit_r, sp * si * orbit_r, sp * ci * orbit_r);
    return vec3<f32>(p0.x * cn + p0.z * sn, p0.y, -p0.x * sn + p0.z * cn);
}

// Per-moon surface character. Returns base highland / maria tint plus a
// modifier mode (0 = rocky cratered, 1 = icy with streaks, 2 = reddish
// ferrous, 3 = dusty captured asteroid).
struct MoonStyle {
    highland: vec3<f32>,
    maria: vec3<f32>,
    mode: i32,
    rough: f32,    // 0 = smooth Europa-like, 1 = heavily pockmarked
};

fn moon_style_for(idx: f32) -> MoonStyle {
    let h = hash11(idx * 41.7 + 3.3);
    var s: MoonStyle;
    if (h < 0.55) {
        // Rocky / Earth's-Moon-like — common case.
        s.highland = vec3<f32>(0.66, 0.62, 0.56);
        s.maria    = vec3<f32>(0.24, 0.22, 0.20);
        s.mode = 0;
        s.rough = 0.85;
    } else if (h < 0.78) {
        // Icy (Europa / Enceladus / Triton). Bright white-blue with cracks.
        s.highland = vec3<f32>(0.88, 0.92, 1.00);
        s.maria    = vec3<f32>(0.52, 0.62, 0.78);
        s.mode = 1;
        s.rough = 0.25;
    } else if (h < 0.92) {
        // Ferrous / weathered (Io / Phobos / Deimos colour family).
        s.highland = vec3<f32>(0.74, 0.52, 0.36);
        s.maria    = vec3<f32>(0.36, 0.20, 0.12);
        s.mode = 2;
        s.rough = 0.95;
    } else {
        // Carbonaceous chondrite — dark and very rough (Phobos true colour).
        s.highland = vec3<f32>(0.32, 0.30, 0.27);
        s.maria    = vec3<f32>(0.13, 0.11, 0.10);
        s.mode = 3;
        s.rough = 1.0;
    }
    return s;
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
    let quality = u.misc.w;
    let body_kind = u.planet_params.w;

    // ---------- Background gradient + stars (anchored to celestial sphere) ----------
    let sky = sky_uv(ray_dir);
    var stars = vec3<f32>(0.0);
    // Three star populations: rare bright (giants), common mid, dense dim.
    // Lower quality profiles keep the bright layer, then add back dim density
    // only when the device budget can afford the extra full-screen work.
    stars = stars + star_layer(sky, 28.0,  0.060,  0.25, time);
    if (quality > 0.45) {
        stars = stars + star_layer(sky, 72.0,  0.030, -0.05, time) * 0.85;
    }
    if (quality > 0.85) {
        stars = stars + star_layer(sky, 180.0, 0.014, -0.18, time) * 0.65;
    }

    // Faint deep-space gradient — sub-percent linear values so the background
    // tonemaps to genuine black, only barely lifted by the atmosphere tint.
    let base_sky = vec3<f32>(0.0008, 0.0010, 0.0018)
                 + u.atmosphere_color.rgb * 0.0015;
    var bg_color = base_sky + stars;
    if (quality > 0.55) {
        bg_color = bg_color + milky_way(ray_dir);
    }

    var best_t = 1e9;
    var best_color = bg_color;
    var has_hit = false;

    // ---------- Moons ----------
    // Count derived from a seed hash: roughly 0=40%, 1=35%, 2=20%, 3=5%.
    let moon_h = hash31(u.seed_block.xyz * 0.13 + vec3<f32>(7.1, 3.7, -1.9));
    var n_moons: i32 = 0;
    if (moon_h > 0.40) { n_moons = 1; }
    if (moon_h > 0.75) { n_moons = 2; }
    if (moon_h > 0.95) { n_moons = 3; }
    if (body_kind > 1.5) { n_moons = 0; }
    n_moons = min(n_moons, select(select(1, 2, quality > 0.50), 3, quality > 0.85));
    for (var i: i32 = 0; i < 3; i = i + 1) {
        if (i >= n_moons) { break; }
        let idx = f32(i + 1) + u.seed_block.x * 0.073 + u.seed_block.y * 0.131;
        let moon_pos = orbit_pos(i, idx, planet_radius, time);
        // Size range expanded — small captured asteroids (4 %) to substantial
        // sister-worlds (25 %) so a system can have a Phobos-style speck
        // alongside a Charon-style near-twin.
        let moon_radius = planet_radius * mix(0.04, 0.25, pow(hash11(idx * 5.9), 1.6));
        let t = ray_sphere_t(ray_origin, ray_dir, moon_pos, moon_radius);
        if (t > 0.0 && t < best_t) {
            let hit_pos = ray_origin + ray_dir * t;
            let n = normalize(hit_pos - moon_pos);
            let style = moon_style_for(idx);
            let surf_seed = vec3<f32>(idx * 13.7, idx * 7.3, idx * 19.1);
            let h_low = fbm3(n * 1.8 + surf_seed, 3);
            let h_mid = fbm3(n * 6.0 + surf_seed * 1.3, 3);
            let h_hi  = fbm3(n * 18.0 + surf_seed * 0.9, 2);
            // Maria / dark-region fraction varies by moon type — rocky bodies
            // are highly contrasted; icy bodies have subtle albedo variation.
            let maria_strength = mix(0.45, 0.92, style.rough);
            let maria_factor = smoothstep(0.42, 0.65, h_low) * maria_strength;
            var base_tone = mix(style.highland, style.maria, maria_factor);
            // Pockmark depth scales with surface roughness (more on rocky
            // moons, less on smooth icy ones).
            let pock = ((h_mid - 0.5) * 0.30 + (h_hi - 0.5) * 0.18) * style.rough;
            // Icy moons get linear surface cracks (Europa-style chaos terrain).
            if (style.mode == 1) {
                let crack = ridged_fbm3(n * 9.0 + surf_seed * 0.7, 2);
                let crack_line = smoothstep(0.78, 0.93, crack);
                base_tone = base_tone * (1.0 - crack_line * 0.45)
                          + vec3<f32>(0.18, 0.25, 0.40) * crack_line * 0.6;
            }
            // Reddish bodies (Io/Phobos colour family) get sulphur-yellow
            // splotches at high-noise spots — volcanic deposits etc.
            if (style.mode == 2) {
                let sulphur = smoothstep(0.60, 0.85, h_low);
                base_tone = mix(base_tone, vec3<f32>(0.95, 0.78, 0.32), sulphur * 0.30);
            }
            let surface = base_tone * (1.0 + pock);
            let n_dot_l = max(dot(n, sun_dir), 0.0);
            best_color = surface * (n_dot_l * 0.95 + 0.03);
            best_t = t;
            has_hit = true;
        }
    }

    // ---------- Rings ----------
    // Giant planets usually carry at least faint particle rings. Keep the
    // plane equatorial, but make the optical depth translucent and feathered
    // so the result reads like dusty ice bands instead of a solid plate.
    let ring_h = hash31(u.seed_block.xyz * 0.27 + vec3<f32>(31.0, -17.0, 53.0));
    let ring_strength = mix(0.38, 1.0, smoothstep(0.12, 0.98, ring_h));
    if (ring_strength > 0.035 && body_kind > 0.5 && body_kind < 1.5) {
        let ring_normal = normalize((u.model * vec4<f32>(0.0, 1.0, 0.0, 0.0)).xyz);
        let denom = dot(ray_dir, ring_normal);
        if (abs(denom) > 1e-4) {
            let t = -dot(ray_origin, ring_normal) / denom;
            if (t > 0.0 && t < best_t) {
                let hit_pos = ray_origin + ray_dir * t;
                let radial = length(hit_pos);
                let inner = planet_radius * mix(1.28, 1.48, hash11(ring_h * 7.0));
                let outer = planet_radius * (2.05 + hash11(ring_h * 11.0) * 0.72);
                if (radial > inner && radial < outer) {
                    let r_norm = (radial - inner) / (outer - inner);
                    let az = atan2(hit_pos.z, hit_pos.x);
                    let soft_edges = smoothstep(0.00, 0.10, r_norm)
                                   * (1.0 - smoothstep(0.88, 1.0, r_norm));
                    let broad = 0.48 + 0.52 * sin(r_norm * 23.0 + hash11(ring_h) * TAU);
                    let ringlets = 0.50 + 0.50 * sin(r_norm * 96.0 + hash11(ring_h * 3.0) * TAU);
                    let dust = fbm3(vec3<f32>(r_norm * 34.0, az * 1.8, ring_h * 9.0), 3);
                    // Broad divisions plus a thin Cassini-like trough. These
                    // reduce opacity rather than cutting hard black gaps.
                    let cassini = 1.0 - 0.88 * exp(-pow((r_norm - 0.67) / 0.020, 2.0));
                    let inner_gap = 1.0 - 0.46 * exp(-pow((r_norm - 0.31) / 0.032, 2.0));
                    let outer_gap = 1.0 - 0.34 * exp(-pow((r_norm - 0.82) / 0.024, 2.0));
                    let radial_density = (0.22 + broad * 0.42 + ringlets * 0.18 + dust * 0.24)
                                       * cassini * inner_gap * outer_gap * soft_edges;
                    let spoke = 1.0 + 0.08 * sin(az * (7.0 + floor(ring_h * 8.0)) + r_norm * 18.0 + time * 0.035)
                                      * smoothstep(0.24, 0.82, r_norm);
                    let optical_depth = clamp(radial_density * spoke * ring_strength, 0.0, 1.0);
                    let view_open = smoothstep(0.10, 0.85, abs(denom));
                    let alpha = clamp(optical_depth * mix(0.20, 0.58, ring_strength) * (0.50 + view_open * 0.72), 0.0, 0.68);
                    if (alpha > 0.010) {
                        // Sun lighting: lit on whichever side the sun is on,
                        // with a little forward scatter through dusty material.
                        let lit = abs(dot(ring_normal, sun_dir)) * 0.72 + 0.12;
                        let forward = pow(max(dot(ray_dir, sun_dir), 0.0), 10.0) * 0.24;
                        let ice_tint  = vec3<f32>(0.92, 0.88, 0.77);
                        let dust_tint = vec3<f32>(0.44, 0.37, 0.27);
                        let ring_color = mix(dust_tint, ice_tint, smoothstep(0.18, 0.78, optical_depth + ring_h * 0.25));
                        let ring_lit = ring_color * (lit * (0.48 + optical_depth * 1.15) + forward);
                        best_color = mix(best_color, ring_lit, alpha);
                        // Do not write depth for translucent rings. The
                        // planet pass should cover the parts that cross in
                        // front of the disc instead of cutting a hard chord.
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
    let n_sats = min(
        i32(floor(pop * 14.0)),
        select(select(4, 8, quality > 0.50), 14, quality > 0.85),
    );
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
        out.color = vec4<f32>(best_color, 1.0);
        out.depth = 0.9999;
    }
    return out;
}
