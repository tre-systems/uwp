// System-overview render — fullscreen triangle that paints the entire scene:
// background stars, the central star (raymarched emissive sphere with limb
// darkening + corona), optional binary companion star, the orbital paths of
// each planet (raymarched faint rings in the system's equatorial plane),
// asteroid belts (mottled dust in the same plane), the planets themselves
// (raymarched spheres with body-class procedural surfaces — gas-giant
// bands, terrestrial continents, icy crackings, etc.), and per-planet moon
// dots.
//
// This shader is the *only* draw call in system view. The detail-render
// planet/atmosphere pipelines are skipped.

@group(1) @binding(0) var<uniform> sys: SystemData;

const TAU: f32 = 6.2831853;
const PI:  f32 = 3.1415926535;
const MAX_PLANETS: u32 = 16u;

// Body-class IDs (must match BodyType enum order in system.rs).
const BT_ROCKY: f32       = 0.0;
const BT_TERRESTRIAL: f32 = 1.0;
const BT_SUPEREARTH: f32  = 2.0;
const BT_MININEPTUNE: f32 = 3.0;
const BT_ICEGIANT: f32    = 4.0;
const BT_GASGIANT: f32    = 5.0;
const BT_INFERNO: f32     = 6.0;
const BT_FROZEN: f32      = 7.0;

// Packed system data. Layout matches `SystemUniforms` in scenes/system.rs.
//   planets[2i  ]: xyz = world position,   w = display radius
//   planets[2i+1]: xyz = base palette tint, w = orbital radius
//   planet_meta[i]: x = body_type, y = seed, z = axial tilt (rad), w = unused
//   moons[i]      : xyz = world position,  w = display radius (sign = icy flag)
//   belts[i]      : x = inner_au, y = outer_au, z = density, w = unused
//   companion     : xyz = position, w = display radius (0 = no companion)
//   companion_color: xyz = colour, w = intensity
//   stars_meta    : x/y = primary temp/warmth, z/w = companion temp/warmth
//   star_params   : x/y = primary seed/radius, z/w = companion seed/radius
struct SystemData {
    /// x = planet count, y = primary-star display radius, z = primary intensity,
    /// w = moon count.
    info: vec4<f32>,
    /// xyz = primary-star colour, w = belt count.
    star_color: vec4<f32>,
    planets: array<vec4<f32>, 32>,
    planet_meta: array<vec4<f32>, 16>,
    moons: array<vec4<f32>, 32>,
    belts: array<vec4<f32>, 4>,
    companion: vec4<f32>,
    companion_color: vec4<f32>,
    /// x = primary temperature K, y = primary warmth (R-B from blackbody),
    /// z = companion temperature K, w = companion warmth.
    stars_meta: vec4<f32>,
    /// x = primary seed, y = primary radius_solar, z = companion seed,
    /// w = companion radius_solar.
    star_params: vec4<f32>,
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

#include "chunks/agx.wgsl"

// ---------- Procedural surfaces per body class ----------
// Each body type renders with a recognisable look: gas-giant bands, ice-giant
// methane blue, terrestrial continents+oceans, rocky cratering, frozen ice
// cracks, etc. Surfaces are sampled on the unit normal of the hit point.

fn gas_giant_surface(n: vec3<f32>, base: vec3<f32>, seed: f32) -> vec3<f32> {
    let lat = n.y;
    // Latitudinal bands — combine low-freq dominant bands with higher-freq
    // turbulence and a thin jet stream pattern.
    let major = sin(lat * (8.0 + seed * 5.0) + seed * 6.28) * 0.5 + 0.5;
    let minor = sin(lat * 28.0 + seed * 3.7) * 0.5 + 0.5;
    let zone = mix(major, minor, 0.3);
    // Domain-warp the band noise with longitude turbulence so the bands swirl
    // rather than reading as clean parallels.
    let lon = atan2(n.z, n.x) / TAU;
    let warp = fbm3(vec3<f32>(lon * 6.0, lat * 4.0, seed) + seed, 3);
    let band = clamp(zone + (warp - 0.5) * 0.18, 0.0, 1.0);
    // Dark belts vs light zones — alternating colour temperature.
    let dark  = base * vec3<f32>(0.72, 0.66, 0.55);
    let light = base * vec3<f32>(1.12, 1.05, 0.92);
    var c = mix(dark, light, band);
    // Storm spot — single great-red-spot-style oval at a mid-latitude.
    let s_lat = (hash11(seed * 7.1) - 0.5) * 0.7;
    let s_lon = hash11(seed * 11.3);
    let d_lat = lat - s_lat;
    let d_lon = fract(lon - s_lon + 0.5) - 0.5;
    let d2 = d_lat * d_lat * 8.0 + d_lon * d_lon * 5.0;
    let storm = exp(-d2 * 12.0);
    let storm_col = mix(vec3<f32>(0.92, 0.42, 0.30),
                        vec3<f32>(0.85, 0.85, 0.92),
                        step(0.5, hash11(seed * 19.7)));
    c = mix(c, storm_col, storm * 0.55);
    return c;
}

fn ice_giant_surface(n: vec3<f32>, base: vec3<f32>, seed: f32) -> vec3<f32> {
    let lat = n.y;
    let lon = atan2(n.z, n.x) / TAU;
    // Mostly smooth methane-blue with subtle bands and a few high cloud streaks.
    let band = sin(lat * 5.0 + seed * 3.0) * 0.06;
    let streak = fbm3(vec3<f32>(lon * 12.0, lat * 4.0, seed * 2.0), 3) * 0.10;
    let c = base + vec3<f32>(band * 0.4, band, band * 1.2) + vec3<f32>(streak * 0.7);
    return c;
}

fn terrestrial_surface(n: vec3<f32>, base: vec3<f32>, seed: f32) -> vec3<f32> {
    // Continent vs ocean field, with polar ice caps. Aimed at the system-view
    // scale where the planet is only a small disc — we don't need detail
    // beyond about 20 cells per hemisphere.
    let seed_off = vec3<f32>(seed * 13.7, seed * 5.3, seed * 17.1);
    let h = fbm3(n * 2.3 + seed_off, 4);
    let land = smoothstep(0.48, 0.55, h);
    // Continent shading uses the user-chosen base tint to keep the system
    // view colour-coherent with the eventual detail render.
    let ocean = vec3<f32>(0.10, 0.28, 0.55);
    let land_a = base * vec3<f32>(0.85, 1.05, 0.75);
    let land_b = base * vec3<f32>(1.10, 0.95, 0.65);
    let h2 = fbm3(n * 5.0 + seed_off + vec3<f32>(91.0, 31.0, -41.0), 3);
    let land_mix = mix(land_a, land_b, h2);
    var surface = mix(ocean, land_mix, land);
    // Cloud streaks — thin high cirrus across the whole planet.
    let cloud = smoothstep(0.55, 0.78, fbm3(n * 6.0 + seed_off, 3));
    surface = mix(surface, vec3<f32>(0.95), cloud * 0.45);
    // Polar caps.
    let polar = smoothstep(0.72, 0.92, abs(n.y));
    surface = mix(surface, vec3<f32>(0.95, 0.96, 1.0), polar);
    return surface;
}

fn super_earth_surface(n: vec3<f32>, base: vec3<f32>, seed: f32) -> vec3<f32> {
    // Larger continents, less ocean — more rust/yellow tint than blue Earth.
    let seed_off = vec3<f32>(seed * 9.1, seed * 3.7, seed * 11.3);
    let h = fbm3(n * 2.0 + seed_off, 4);
    let land = smoothstep(0.40, 0.55, h);
    let ocean = base * vec3<f32>(0.40, 0.55, 0.70);
    let land_c = base * vec3<f32>(1.15, 0.95, 0.70);
    var surface = mix(ocean, land_c, land);
    let polar = smoothstep(0.78, 0.95, abs(n.y));
    surface = mix(surface, vec3<f32>(0.90, 0.92, 0.96), polar * 0.6);
    return surface;
}

fn rocky_surface(n: vec3<f32>, base: vec3<f32>, seed: f32) -> vec3<f32> {
    // Mars / Mercury class — dusty rock with darker mare and visible
    // crater-like patches at this zoom.
    let seed_off = vec3<f32>(seed * 7.7, seed * 2.3, seed * 15.5);
    let h_low = fbm3(n * 2.0 + seed_off, 4);
    let h_high = fbm3(n * 10.0 + seed_off, 3);
    // Three-band shading: highland (bright), maria (dark), regolith dust.
    let bright = base * vec3<f32>(1.20, 1.05, 0.95);
    let dark = base * vec3<f32>(0.50, 0.42, 0.35);
    var surface = mix(dark, bright, smoothstep(0.40, 0.62, h_low));
    surface = surface * (0.85 + h_high * 0.30);
    return surface;
}

fn frozen_surface(n: vec3<f32>, base: vec3<f32>, seed: f32) -> vec3<f32> {
    // Europa / Pluto class — icy with surface cracks and dark dirt.
    let seed_off = vec3<f32>(seed * 13.7, seed * 5.3, seed * 17.1);
    let h = fbm3(n * 4.0 + seed_off, 4);
    // Mostly white ice tinted with the base palette; dark cracks via thresholded fbm.
    let ice = mix(vec3<f32>(0.92, 0.95, 1.0), base * 1.10, 0.35);
    let crack = smoothstep(0.55, 0.65, h);
    let crack_color = vec3<f32>(0.45, 0.40, 0.35);
    var surface = mix(ice, crack_color, crack * 0.6);
    // Subtle large-scale tint variation.
    let tint = fbm3(n * 1.5 + seed_off, 3);
    surface = surface * (0.92 + tint * 0.16);
    return surface;
}

fn inferno_surface(n: vec3<f32>, base: vec3<f32>, seed: f32) -> vec3<f32> {
    // Venus / lava world — hot, glowing patches.
    let seed_off = vec3<f32>(seed * 4.9, seed * 1.7, seed * 23.1);
    let h = fbm3(n * 5.0 + seed_off, 4);
    let lava = vec3<f32>(2.0, 0.65, 0.15);
    let crust = base * vec3<f32>(0.85, 0.55, 0.40);
    let molten = smoothstep(0.58, 0.78, h);
    var surface = mix(crust, lava, molten * 0.7);
    return surface;
}

fn mini_neptune_surface(n: vec3<f32>, base: vec3<f32>, seed: f32) -> vec3<f32> {
    // Like a smaller gas giant but with thicker haze that washes out features.
    let g = gas_giant_surface(n, base, seed);
    return mix(g, base * 1.05, 0.55);
}

// Dispatch by body type.
fn planet_surface(body_type: f32, n: vec3<f32>, base: vec3<f32>, seed: f32) -> vec3<f32> {
    if (body_type < 0.5)  { return rocky_surface(n, base, seed); }
    if (body_type < 1.5)  { return terrestrial_surface(n, base, seed); }
    if (body_type < 2.5)  { return super_earth_surface(n, base, seed); }
    if (body_type < 3.5)  { return mini_neptune_surface(n, base, seed); }
    if (body_type < 4.5)  { return ice_giant_surface(n, base, seed); }
    if (body_type < 5.5)  { return gas_giant_surface(n, base, seed); }
    if (body_type < 6.5)  { return inferno_surface(n, base, seed); }
    return frozen_surface(n, base, seed);
}

// ---------- Star rendering ----------
struct StarHit {
    color: vec3<f32>,
    t: f32,
    hit: bool,
};

fn render_star(
    orig: vec3<f32>,
    dir: vec3<f32>,
    centre: vec3<f32>,
    radius: f32,
    base: vec3<f32>,
    intensity: f32,
    temperature_k: f32,
    warmth: f32,
    physical_radius: f32,
    seed: f32,
    best_t: f32,
) -> StarHit {
    var h: StarHit;
    h.hit = false;
    h.t = 1e9;
    h.color = vec3<f32>(0.0);
    let t = ray_sphere(orig, dir, centre, radius);
    if (t > 0.0 && t < best_t) {
        let hit_pos = orig + dir * t;
        let n = normalize(hit_pos - centre);
        let seed_vec = vec3<f32>(
            seed * 0.013 + 17.0,
            seed * 0.021 - 43.0,
            seed * 0.034 + 91.0,
        );
        let cool = 1.0 - smoothstep(3900.0, 5600.0, temperature_k);
        let hot = smoothstep(7600.0, 12000.0, temperature_k);
        let solar = exp(-pow((temperature_k - 5778.0) / 2300.0, 2.0));
        let giant = smoothstep(1.8, 8.0, physical_radius);
        // Eddington limb darkening I(μ) = I₀ (a + b·μ + c·μ²). Standard
        // photometric limb-darkening laws give stronger darkening for cooler
        // stars (their photospheres are more opaque to grazing rays). We bias
        // the cooler-end coefficient to read as a more saturated red limb on
        // M-dwarfs and a near-uniform disc on O/B stars.
        let mu = max(dot(n, -dir), 0.0);
        let cool_strength = clamp(warmth * 1.4, 0.0, 1.0);
        let limb = mix((0.70 + 0.30 * mu),                  // hot star, mild
                       (0.32 + 1.68 * mu - 0.20 * mu * mu), // cool star, strong
                       max(cool_strength, cool));

        // Granulation cell size: small for hot blue stars (~smooth photosphere),
        // big and chunky for cool M-dwarfs (Sol's granules are ~1500 km,
        // M-dwarf granules can be ~10 % of the star's radius). The shader
        // scale is in normal-space — smaller scale = larger visible cells.
        let g_scale = mix(64.0, 10.0, cool) / (1.0 + giant * 0.55);
        let g_amp   = (mix(0.16, 0.55, cool) + solar * 0.10 + giant * 0.08) * (1.0 - hot * 0.45);
        let fine_grain = fbm3(n * g_scale + seed_vec, 4) - 0.5;
        let super_gran = fbm3(n * mix(8.0, 3.2, cool) + seed_vec * 1.9, 3) - 0.5;
        let hot_mottle = (fbm3(n * 26.0 + seed_vec * 2.7, 3) - 0.5) * hot * 0.10;
        let grain = 1.0 + fine_grain * g_amp + super_gran * (0.12 + cool * 0.20) + hot_mottle;

        // Sunspots: F/G/K stars show small dark spots; M-dwarfs show large
        // irregular active regions; O/B/A are nearly featureless. Spots cluster
        // at sub-equatorial latitudes for solar-types and anywhere on M-dwarfs.
        let spot_band = exp(-pow((abs(n.y) - 0.35), 2.0) * 18.0);
        let spot_anywhere = 0.72 + 0.28 * fbm3(n * 2.4 + seed_vec * 0.7, 2);
        let spot_lat = mix(spot_band, spot_anywhere, cool);
        let spot_field = fbm3(n * mix(8.5, 3.8, cool) + seed_vec + vec3<f32>(13.0, -29.0, 7.0), 4);
        let spot_threshold = mix(0.60, 0.42, cool) - solar * 0.08;
        let solar_spot_mask = smoothstep(spot_threshold, spot_threshold + 0.16, spot_field);
        let m_spot_mask = smoothstep(0.42, 0.66, spot_field);
        // Spot strength ramps up between A (warmth ~0) and M (warmth ~0.6).
        let spot_strength = (solar * 0.72 + cool * 1.00) * (1.0 - hot * 0.92);
        let solar_spots = solar_spot_mask * spot_lat * 0.42;
        let m_spots = m_spot_mask * spot_lat * 0.55;
        let spots = mix(solar_spots, m_spots, smoothstep(0.30, 0.55, warmth))
                  * spot_strength;
        let lat = asin(clamp(n.y, -1.0, 1.0));
        let lon = atan2(n.z, n.x);
        var active_spots = 0.0;
        for (var i: i32 = 0; i < 4; i = i + 1) {
            let fi = f32(i);
            let h0 = hash31(seed_vec + vec3<f32>(17.0 + fi, 41.0, 9.0));
            let h1 = hash31(seed_vec + vec3<f32>(71.0, 13.0 + fi, 29.0));
            let h2 = hash31(seed_vec + vec3<f32>(5.0, 97.0, 23.0 + fi));
            let spot_lat_c = (h0 * 0.72 - 0.36) * mix(0.75, 1.25, cool);
            let spot_lon_c = h1 * TAU;
            let d_lat = lat - spot_lat_c;
            let d_lon = atan2(sin(lon - spot_lon_c), cos(lon - spot_lon_c));
            let oval = exp(-(d_lat * d_lat * mix(180.0, 54.0, cool)
                           + d_lon * d_lon * mix(72.0, 24.0, cool)));
            let gate = smoothstep(0.18, 0.58, h2) * (solar * 0.78 + cool * 0.95) * (1.0 - hot);
            active_spots = max(active_spots, oval * gate);
        }
        let starspots = max(spots, active_spots);

        // Final surface multiplier — darker where spots fall.
        let spot_tint = mix(vec3<f32>(0.36, 0.32, 0.27), vec3<f32>(0.18, 0.11, 0.08), cool);
        let surface = grain * mix(vec3<f32>(1.0), spot_tint, clamp(starspots, 0.0, 0.88));

        // Warmth-tint shift on the limb — bias toward red/orange at the edge
        // for K/M, toward blue for hot stars (Doppler-like illusion).
        let limb_tint_warm = vec3<f32>(1.10, 0.70, 0.40);
        let limb_tint_cool = vec3<f32>(0.85, 0.92, 1.10);
        let limb_tint = mix(limb_tint_cool, limb_tint_warm, cool_strength);
        let edge = 1.0 - mu;
        let tinted = mix(base, base * limb_tint, edge * 0.55);

        let faculae = pow(edge, 2.1)
            * (solar * 0.30 + cool * 0.16)
            * (0.65 + fbm3(n * 18.0 + seed_vec * 0.4, 3) * 0.70);
        let az = atan2(n.z, n.x);
        let active_arc = smoothstep(
            0.90,
            0.995,
            sin(az * (3.0 + floor(fract(seed * 0.2) * 5.0)) + seed * 0.071) * 0.5 + 0.5
        ) * pow(edge, 7.0) * (cool * 0.34 + solar * 0.12);
        let chromosphere = mix(vec3<f32>(0.75, 0.88, 1.45), vec3<f32>(1.35, 0.34, 0.18), cool_strength + cool * 0.35);

        h.color = tinted * limb * surface * intensity
                + base * faculae * intensity * 0.70
                + chromosphere * active_arc * intensity * 0.55;
        h.t = t;
        h.hit = true;
    }
    return h;
}

fn render_corona(
    orig: vec3<f32>,
    dir: vec3<f32>,
    centre: vec3<f32>,
    radius: f32,
    base: vec3<f32>,
    intensity: f32,
    temperature_k: f32,
    seed: f32,
) -> vec3<f32> {
    let to_star = centre - orig;
    let star_dist = length(to_star);
    if (star_dist < 1e-3) { return vec3<f32>(0.0); }
    let star_dir_w = to_star / star_dist;
    let cos_align = max(dot(dir, star_dir_w), 0.0);
    let ang_disc = atan2(radius, max(star_dist - radius, 1e-3));
    let cos_disc = cos(ang_disc);
    let outside = max(cos_disc - cos_align, 0.0);
    let outside_norm = outside / max(1.0 - cos_disc, 1e-3);
    let hot = smoothstep(7600.0, 12000.0, temperature_k);
    let cool = 1.0 - smoothstep(3900.0, 5600.0, temperature_k);
    let helper = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(star_dir_w.y) > 0.92);
    let axis_u = normalize(cross(helper, star_dir_w));
    let axis_v = normalize(cross(star_dir_w, axis_u));
    let az = atan2(dot(dir, axis_v), dot(dir, axis_u));
    let ray_count = mix(5.0, 11.0, hot);
    let ray_phase = seed * 0.037;
    let ray_hash = sin(az * ray_count + ray_phase) * 0.5 + 0.5;
    let streamers = pow(max(1.0 - outside_norm, 0.0), mix(3.2, 1.8, hot))
        * smoothstep(0.56, 0.96, ray_hash)
        * (0.08 + hot * 0.13 + cool * 0.05);
    let corona = exp(-outside_norm * mix(5.2, 2.9, hot)) * 0.42
               + exp(-outside_norm * 18.0) * 0.26
               + streamers;
    let corona_tint = mix(vec3<f32>(0.86, 0.94, 1.24), vec3<f32>(1.20, 0.62, 0.34), cool);
    return base * corona_tint * corona * intensity * 0.36;
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
    let n_planets = i32(sys.info.x);
    let ring_n = vec3<f32>(0.0, 1.0, 0.0);
    let denom = dot(ray_dir, ring_n);
    if (abs(denom) > 1e-5) {
        let t_plane = -dot(ray_origin, ring_n) / denom;
        if (t_plane > 0.0) {
            let p = ray_origin + ray_dir * t_plane;
            let r = length(p.xz);
            var nearest_diff = 1e9;
            var orbit_tint = vec3<f32>(0.5, 0.6, 0.9);
            for (var i: i32 = 0; i < i32(MAX_PLANETS); i = i + 1) {
                if (i >= n_planets) { break; }
                let orbit_r = sys.planets[u32(i) * 2u + 1u].w;
                let band_width = max(orbit_r * 0.0035, 0.0008 * length(p - ray_origin) * 0.01);
                let diff = abs(r - orbit_r);
                if (diff < band_width && diff < nearest_diff) {
                    nearest_diff = diff;
                    orbit_tint = sys.planets[u32(i) * 2u + 1u].xyz * 0.55 + vec3<f32>(0.25);
                }
            }
            if (nearest_diff < 1e8) {
                let dist_falloff = 1.0 / (1.0 + t_plane * 0.005);
                color = color + orbit_tint * 0.18 * dist_falloff;
            }
        }
    }

    // ---------- Asteroid belts ----------
    // Discrete-particle look: two grain scales (coarse rocks + fine dust),
    // angular streaks following orbital direction, soft Kirkwood-style gaps
    // at 2:1 / 3:1 resonance fractions of the belt width, and a small
    // out-of-plane tolerance so the belt has perceptible thickness.
    let n_belts = i32(sys.star_color.w);
    if (n_belts > 0) {
        for (var bi: i32 = 0; bi < 4; bi = bi + 1) {
            if (bi >= n_belts) { break; }
            let belt = sys.belts[u32(bi)];
            let inner = belt.x;
            let outer = belt.y;
            let density = belt.z;
            let width = max(outer - inner, 1e-3);

            // Out-of-plane thickness: ~3% of belt width as 1-sigma.
            let half_thick = max(width * 0.04, 0.01);
            // Quick conservative bound: only ray-march when the ray
            // direction can plausibly hit the slab.
            if (abs(ray_dir.y) < 1e-4) { continue; }

            // Take two plane samples (top + bottom of slab) and integrate
            // the discrete-particle response across the segment between.
            let t_top = (half_thick - ray_origin.y) / ray_dir.y;
            let t_bot = (-half_thick - ray_origin.y) / ray_dir.y;
            let t_near = min(t_top, t_bot);
            let t_far  = max(t_top, t_bot);
            if (t_far <= 0.0) { continue; }
            let t0 = max(t_near, 0.0);
            let t1 = t_far;
            // Three samples through the slab — cheap and enough to
            // resolve the particles edge-on without ghosting.
            let dt = (t1 - t0) / 3.0;
            var accum = vec3<f32>(0.0);
            var alpha = 0.0;
            for (var s: i32 = 0; s < 3; s = s + 1) {
                let t = t0 + dt * (f32(s) + 0.5);
                let p = ray_origin + ray_dir * t;
                let r = length(p.xz);
                if (r < inner || r > outer) { continue; }

                // Soft inner / outer edges
                let edge_in  = smoothstep(inner, inner + width * 0.06, r);
                let edge_out = 1.0 - smoothstep(outer - width * 0.06, outer, r);
                let band = edge_in * edge_out;
                if (band <= 0.0) { continue; }

                // Kirkwood-like resonance gaps. Place two narrow depletion
                // bands inside the belt — 2:1 (one-third in from outer edge)
                // and 3:1 (two-thirds in). These read as visible gaps the
                // real solar-system belt has.
                let u_belt = (r - inner) / width;  // 0 at inner, 1 at outer
                let gap_a = 1.0 - exp(-pow((u_belt - 0.40) / 0.05, 2.0));
                let gap_b = 1.0 - exp(-pow((u_belt - 0.68) / 0.04, 2.0));
                let gap = clamp(gap_a * gap_b, 0.0, 1.0);

                // Out-of-plane Gaussian — particles thicken near the centre
                // plane and thin to almost nothing at the slab edges.
                let z_falloff = exp(-pow(p.y / half_thick, 2.0) * 2.0);

                // Coarse grains: thresholded hash on a moderate grid.
                let cell_c = floor(p.xz * 22.0);
                let h_c = hash21(cell_c);
                let h_c2 = hash21(cell_c + vec2<f32>(11.0, 73.0));
                let coarse = step(0.74, h_c) * (0.4 + h_c2 * 0.6);

                // Fine dust: tiny grains at much higher frequency, lower
                // contribution, fills the gaps between rocks.
                let cell_f = floor(p.xz * 96.0);
                let h_f = hash21(cell_f);
                let fine = step(0.94, h_f) * 0.45;

                // Slow azimuthal streaks: aligned with orbital direction so
                // the belt reads as motion-blurred dust rather than a tile.
                let theta = atan2(p.z, p.x);
                let streak = smoothstep(0.42, 0.62, sin(theta * 280.0 + r * 60.0) * 0.5 + 0.5) * 0.10;

                let particle = (coarse + fine + streak) * z_falloff * gap * band;

                let dust = vec3<f32>(0.58, 0.50, 0.42);
                let sun_lit = 0.65 + 0.35 * max(dot(normalize(-p), normalize(vec3<f32>(0.4, 0.18, 0.7))), 0.0);
                accum = accum + dust * particle * density * sun_lit;
                alpha = alpha + particle * density * 0.3;
            }
            color = color + accum * 0.7;
            color = mix(color, color * 0.9, clamp(alpha, 0.0, 0.4));
        }
    }

    // ---------- Planets ----------
    for (var i: i32 = 0; i < i32(MAX_PLANETS); i = i + 1) {
        if (i >= n_planets) { break; }
        let slot_a = sys.planets[u32(i) * 2u + 0u];
        let slot_b = sys.planets[u32(i) * 2u + 1u];
        let pmeta  = sys.planet_meta[u32(i)];
        let p_pos = slot_a.xyz;
        let p_r   = slot_a.w;
        let p_col = slot_b.xyz;
        let body_type = pmeta.x;
        let p_seed = pmeta.y;
        let t = ray_sphere(ray_origin, ray_dir, p_pos, p_r);
        if (t > 0.0 && t < best_t) {
            let hit_pos = ray_origin + ray_dir * t;
            let n_world = normalize(hit_pos - p_pos);
            // Apply axial tilt — rotate the sample normal around the X axis
            // so each planet has its own pole orientation.
            let tilt = pmeta.z;
            let cs = cos(tilt);
            let sn = sin(tilt);
            let n = vec3<f32>(n_world.x,
                              cs * n_world.y - sn * n_world.z,
                              sn * n_world.y + cs * n_world.z);
            let surface = planet_surface(body_type, n, p_col, p_seed);
            let sun_d = normalize(-p_pos);
            let nl = max(dot(n_world, sun_d), 0.0);
            // Lighting: small ambient + Lambert. Slightly elevated ambient for
            // gas/ice giants so the cloud bands are visible even on the dark
            // hemisphere (multi-scatter through their thick atmospheres).
            let amb = select(0.06, 0.16,
                             body_type > 2.5 && body_type < 5.5);
            let lit = surface * (amb + nl * 0.95);
            // Soft terminator warming for terrestrials/inferno: a thin warm
            // tint at the day-night boundary.
            let term = smoothstep(0.0, 0.10, nl) * (1.0 - smoothstep(0.10, 0.28, nl));
            let warm_planet = body_type > 0.5 && body_type < 2.5;
            hit_color = lit + select(vec3<f32>(0.0),
                                     vec3<f32>(0.35, 0.18, 0.08) * term,
                                     warm_planet);
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
            let mottle = 0.85 + hash31(n * 30.0) * 0.30;
            let base = select(vec3<f32>(0.62, 0.58, 0.54),
                              vec3<f32>(0.92, 0.95, 1.00),
                              icy);
            hit_color = base * mottle * (0.10 + nl * 0.90);
            best_t = t;
            has_hit = true;
        }
    }

    // ---------- Primary star ----------
    let primary = render_star(
        ray_origin, ray_dir,
        vec3<f32>(0.0), sys.info.y,
        sys.star_color.rgb, sys.info.z,
        sys.stars_meta.x, sys.stars_meta.y,
        sys.star_params.y,
        sys.star_params.x, best_t,
    );
    if (primary.hit) {
        hit_color = primary.color;
        best_t = primary.t;
        has_hit = true;
    }

    // ---------- Companion star (optional) ----------
    let comp_r = sys.companion.w;
    var companion_hit = false;
    if (comp_r > 0.0) {
        let companion = render_star(
            ray_origin, ray_dir,
            sys.companion.xyz, comp_r,
            sys.companion_color.rgb, sys.companion_color.w,
            sys.stars_meta.z, sys.stars_meta.w,
            sys.star_params.w,
            sys.star_params.z, best_t,
        );
        if (companion.hit) {
            hit_color = companion.color;
            best_t = companion.t;
            has_hit = true;
            companion_hit = true;
        }
    }

    if (has_hit) { color = hit_color; }

    // ---------- Coronas ----------
    // Each corona only renders for rays that don't already have a closer hit
    // (planet, moon, the other star). This is the fix for "you can see the
    // star through the planets": planets in front of a star now occlude its
    // corona too, not just the disc.
    if (!has_hit) {
        color = color + render_corona(
            ray_origin, ray_dir,
            vec3<f32>(0.0), sys.info.y,
            sys.star_color.rgb, sys.info.z,
            sys.stars_meta.x, sys.star_params.x,
        );
        if (comp_r > 0.0) {
            color = color + render_corona(
                ray_origin, ray_dir,
                sys.companion.xyz, comp_r,
                sys.companion_color.rgb, sys.companion_color.w,
                sys.stars_meta.z, sys.star_params.z,
            );
        }
    }

    return vec4<f32>(agx(color), 1.0);
}
