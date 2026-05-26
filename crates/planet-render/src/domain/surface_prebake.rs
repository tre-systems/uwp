//! Surface pre-bake: per-seed multi-channel atlas sampled on a
//! latitude-longitude grid.
//!
//! Channels:
//!
//!   - `heightmap`: signed elevation in [-1, 1].
//!   - `plate_id`: index of the dominant plate (debug + future shading).
//!   - `moisture`: normalised moisture in [0, 1] (latitude bands + noise).
//!   - `temperature_k`: local mean temperature in Kelvin (climate-aware).
//!   - `biome_id`: canonical biome computed once from the channels above.
//!
//! The heightmap is built from two physics-motivated layers:
//!
//!   1. **Plate tectonics** — sample ~8 random "plate centres" on the
//!      sphere with associated velocities. For each surface point find
//!      the two nearest plates; if their velocities converge at the
//!      boundary the cell gets uplift (mountains, volcanic arcs); if
//!      they diverge it gets a rift (lowland / basin). This is the
//!      "broad continental shape" that hand-rolled multi-octave noise
//!      can't produce convincingly.
//!
//!   2. **Multi-octave value noise** layered on top for terrain
//!      texture so the plates don't read as flat polygons.
//!
//! Moisture and temperature are computed per-cell from latitude,
//! elevation, and the BakeInput climate scalars. Biome classification
//! is Rust-owned — the globe shader, surface map, and region view all
//! sample the same `biome_id` instead of each re-deriving biomes from
//! noise. That's the only way the three views can stay visually
//! consistent.
//!
//! Generation is cached in a small thread-local LRU keyed by every
//! BakeInput field that affects the output. The renderer, the surface-
//! map generator, and the JS preview all hit this cache, so flipping
//! between views or worlds doesn't re-bake on each hop.

#![allow(dead_code)]

use std::cell::RefCell;

use serde::{Deserialize, Serialize};

pub const PREBAKE_LON: usize = 1024;
pub const PREBAKE_LAT: usize = 512;

/// Resolution tiers selected by render profile. Heightmap RAM cost
/// (4 bytes/cell) and the biome/moisture/temp companions scale
/// linearly with cell count, so weak devices fall back to the smallest
/// tier and capable desktops can pick up the largest.
pub const PREBAKE_LOW_LON: usize = 512;
pub const PREBAKE_LOW_LAT: usize = 256;
pub const PREBAKE_HIGH_LON: usize = 2048;
pub const PREBAKE_HIGH_LAT: usize = 1024;

const LRU_CAPACITY: usize = 4;

/// Map a 0..1 render-quality scalar to a (lon, lat) atlas resolution.
/// Mirrors the JS-side renderProfile tiers so atlas size lines up with
/// shader detail level.
pub fn resolution_for_quality(quality: f32) -> (u32, u32) {
    if quality < 0.55 {
        (PREBAKE_LOW_LON as u32, PREBAKE_LOW_LAT as u32)
    } else if quality < 0.95 {
        (PREBAKE_LON as u32, PREBAKE_LAT as u32)
    } else {
        (PREBAKE_HIGH_LON as u32, PREBAKE_HIGH_LAT as u32)
    }
}

thread_local! {
    static PREBAKE_LRU: RefCell<Vec<PreBakeCacheEntry>> = const { RefCell::new(Vec::new()) };
}

#[derive(Clone)]
struct PreBakeCacheEntry {
    key: PreBakeKey,
    bake: PreBake,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PreBakeKey {
    seed: u32,
    water_bits: u32,
    ice_bits: u32,
    temp_bits: u32,
    veg_bits: u32,
    lon_cells: u32,
    lat_cells: u32,
}

impl PreBakeKey {
    fn from_input(input: &BakeInput) -> Self {
        Self {
            seed: input.seed,
            water_bits: input.water_fraction.clamp(0.0, 1.0).to_bits(),
            ice_bits: input.ice_latitude.clamp(0.0, 1.0).to_bits(),
            temp_bits: input.mean_temp_k.max(0.0).to_bits(),
            veg_bits: input.vegetation_richness.clamp(0.0, 1.0).to_bits(),
            lon_cells: input.lon_cells,
            lat_cells: input.lat_cells,
        }
    }
}

/// Inputs that influence the pre-bake. `seed` should be a stable hash of
/// the world's identity (see `surface_seed`); the climate scalars come
/// from the planet's `ClimateSummary`.
#[derive(Clone, Copy, Debug)]
pub struct BakeInput {
    pub seed: u32,
    /// Target fraction of cells below sea level, 0..1.
    pub water_fraction: f32,
    /// Normalised |latitude| (0..1) at which permanent ice cover begins.
    pub ice_latitude: f32,
    /// Global mean surface temperature, Kelvin. ~288 for Earth.
    pub mean_temp_k: f32,
    /// 0 = barren rock, 1 = lush Earth. Drives moisture amplitude.
    pub vegetation_richness: f32,
    /// Longitude resolution of the atlas. Defaults to PREBAKE_LON; use
    /// `resolution_for_quality()` to pick a tier from a render profile.
    pub lon_cells: u32,
    /// Latitude resolution of the atlas. Defaults to PREBAKE_LAT.
    pub lat_cells: u32,
}

impl BakeInput {
    /// Default Earth-ish scalars used by the legacy two-arg entry point.
    pub fn earthlike(seed: u32, water_fraction: f32) -> Self {
        Self {
            seed,
            water_fraction,
            ice_latitude: 0.82,
            mean_temp_k: 288.0,
            vegetation_richness: 0.65,
            lon_cells: PREBAKE_LON as u32,
            lat_cells: PREBAKE_LAT as u32,
        }
    }

    /// Apply a render-quality scalar (0..1) to pick the atlas
    /// resolution tier. Use this in renderer paths that have access to
    /// the player's render profile.
    pub fn with_quality(mut self, quality: f32) -> Self {
        let (lon, lat) = resolution_for_quality(quality);
        self.lon_cells = lon;
        self.lat_cells = lat;
        self
    }
}

/// Stable identity for a world. The seed handed to the pre-bake is
/// `surface_seed(&identity)`; the same identity always paints the same
/// atlas. No backend storage required — the hash *is* the persistence.
#[derive(Clone, Copy, Debug)]
pub struct SurfaceIdentity<'a> {
    pub sector_seed: u32,
    pub subsector_seed: u32,
    pub hex_col: u8,
    pub hex_row: u8,
    /// 9-character UWP string, e.g. "B564500-9". Edits change the seed
    /// so a Referee's override is reflected in the surface visuals.
    pub uwp: &'a str,
    /// Display name. Renaming a world locks in its new look.
    pub name: &'a str,
}

/// Compose a `SurfaceIdentity` into a stable u32 seed. Uses a
/// SplitMix-style 64-bit mixer over each field so any single bit change
/// in any input avalanches into the output.
pub fn surface_seed(identity: &SurfaceIdentity<'_>) -> u32 {
    let mut h: u64 = 0xA02D_1F5E_8C13_24B5;
    h = mix64(h ^ identity.sector_seed as u64);
    h = mix64(h ^ identity.subsector_seed as u64);
    h = mix64(h ^ ((identity.hex_col as u64) << 8 | identity.hex_row as u64));
    for byte in identity.uwp.bytes() {
        h = mix64(h.wrapping_add(byte as u64));
    }
    for byte in identity.name.bytes() {
        h = mix64(h.wrapping_add((byte as u64) << 16));
    }
    (h >> 32) as u32
}

fn mix64(mut z: u64) -> u64 {
    z = z.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Canonical biome enum. All three render paths (globe shader, hex
/// world map, region view) read this same id and look up colours from
/// the same palette. No path is allowed to re-derive biomes from local
/// noise — that's what made the views disagree before.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[repr(u8)]
pub enum BiomeId {
    DeepOcean = 0,
    ShallowOcean = 1,
    Shore = 2,
    Plain = 3,
    Grassland = 4,
    Forest = 5,
    Savanna = 6,
    Desert = 7,
    Hills = 8,
    Mountain = 9,
    AlpineRock = 10,
    Snow = 11,
    Tundra = 12,
    Ice = 13,
    Volcanic = 14,
    Barren = 15,
}

impl BiomeId {
    pub fn from_u8(v: u8) -> BiomeId {
        match v {
            0 => BiomeId::DeepOcean,
            1 => BiomeId::ShallowOcean,
            2 => BiomeId::Shore,
            3 => BiomeId::Plain,
            4 => BiomeId::Grassland,
            5 => BiomeId::Forest,
            6 => BiomeId::Savanna,
            7 => BiomeId::Desert,
            8 => BiomeId::Hills,
            9 => BiomeId::Mountain,
            10 => BiomeId::AlpineRock,
            11 => BiomeId::Snow,
            12 => BiomeId::Tundra,
            13 => BiomeId::Ice,
            14 => BiomeId::Volcanic,
            _ => BiomeId::Barren,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PreBake {
    pub lon_cells: u32,
    pub lat_cells: u32,
    pub heightmap: Vec<f32>,
    /// Plate index per cell (0..n_plates). Useful for biome tagging and
    /// future shader-side highlighting. Skipped over the WASM bridge —
    /// no JS consumer reads this today and it doubles the payload.
    #[serde(skip)]
    pub plate_id: Vec<u8>,
    /// Plates resolved during generation — bake time inputs preserved so
    /// callers can debug or render plate boundaries.
    #[serde(skip)]
    pub plates: Vec<Plate>,
    /// Sea level chosen so `ocean_fraction(sea_level)` matches
    /// `water_fraction` at the requested quantile. Stored on the bake
    /// so every consumer agrees on where the coastline sits.
    pub sea_level: f32,
    /// Per-cell normalised moisture, 0..1. Internal-only.
    #[serde(skip)]
    pub moisture: Vec<f32>,
    /// Per-cell local mean temperature, Kelvin. Internal-only.
    #[serde(skip)]
    pub temperature_k: Vec<f32>,
    /// Per-cell canonical biome. Sample this in shaders instead of
    /// re-deriving biome from local noise.
    pub biome_id: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Plate {
    /// Unit-sphere centre (Cartesian).
    pub centre: [f32; 3],
    /// Tangential drift direction at the centre (Cartesian, ≈ unit).
    pub drift: [f32; 3],
    /// Mean elevation contribution: oceanic plates push negative,
    /// continental plates push positive.
    pub mean_elev: f32,
}

impl PreBake {
    pub fn sample(&self, lat_norm: f32, lon_norm: f32) -> f32 {
        // Bilinear sample on the equirectangular grid. lat_norm in [0, 1]
        // (0 = south pole, 1 = north), lon_norm in [0, 1] wrapping.
        let lat_cells = self.lat_cells.max(1) as usize;
        let lon_cells = self.lon_cells.max(1) as usize;
        let lat = (lat_norm.clamp(0.0, 1.0) * lat_cells as f32 - 0.5)
            .clamp(0.0, lat_cells.saturating_sub(1) as f32);
        let lon = lon_norm.rem_euclid(1.0) * lon_cells as f32 - 0.5;
        let lon_floor = lon.floor();
        let i0 = lat.floor() as usize;
        let i1 = (i0 + 1).min(lat_cells - 1);
        let j0 = (lon_floor as isize).rem_euclid(lon_cells as isize) as usize;
        let j1 = (j0 + 1) % lon_cells;
        let fi = lat - i0 as f32;
        let fj = lon - lon_floor;
        let h00 = self.heightmap[i0 * lon_cells + j0];
        let h01 = self.heightmap[i0 * lon_cells + j1];
        let h10 = self.heightmap[i1 * lon_cells + j0];
        let h11 = self.heightmap[i1 * lon_cells + j1];
        let h0 = h00 * (1.0 - fj) + h01 * fj;
        let h1 = h10 * (1.0 - fj) + h11 * fj;
        h0 * (1.0 - fi) + h1 * fi
    }

    /// Nearest-neighbour biome lookup. Bilinear doesn't make sense for
    /// a categorical channel.
    pub fn sample_biome(&self, lat_norm: f32, lon_norm: f32) -> BiomeId {
        let (i, j) = self.nearest_cell(lat_norm, lon_norm);
        BiomeId::from_u8(self.biome_id[i * self.lon_cells as usize + j])
    }

    pub fn sample_moisture(&self, lat_norm: f32, lon_norm: f32) -> f32 {
        let (i, j) = self.nearest_cell(lat_norm, lon_norm);
        self.moisture[i * self.lon_cells as usize + j]
    }

    pub fn sample_temperature(&self, lat_norm: f32, lon_norm: f32) -> f32 {
        let (i, j) = self.nearest_cell(lat_norm, lon_norm);
        self.temperature_k[i * self.lon_cells as usize + j]
    }

    fn nearest_cell(&self, lat_norm: f32, lon_norm: f32) -> (usize, usize) {
        let lat_cells = self.lat_cells.max(1) as usize;
        let lon_cells = self.lon_cells.max(1) as usize;
        let i = ((lat_norm.clamp(0.0, 1.0) * lat_cells as f32) as usize).min(lat_cells - 1);
        let j_raw = (lon_norm.rem_euclid(1.0) * lon_cells as f32) as usize;
        let j = j_raw % lon_cells;
        (i, j)
    }

    pub fn ocean_fraction(&self, sea_level: f32) -> f32 {
        let total = self.heightmap.len();
        if total == 0 {
            return 0.0;
        }
        let below = self.heightmap.iter().filter(|h| **h < sea_level).count();
        below as f32 / total as f32
    }
}

struct Rng {
    state: u64,
}

impl Rng {
    fn new(seed: u32) -> Self {
        let mut s = (seed as u64) ^ 0xD2B7_4407_B1C3_8E37;
        if s == 0 {
            s = 0xABCD_EF01_2345_6789;
        }
        Self { state: s }
    }
    fn next_u32(&mut self) -> u32 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        ((z ^ (z >> 31)) >> 32) as u32
    }
    fn f01(&mut self) -> f32 {
        (self.next_u32() as f64 / u32::MAX as f64) as f32
    }
    fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + self.f01() * (hi - lo)
    }
}

/// Legacy two-arg entry point. Equivalent to `generate_with` with
/// Earth-ish defaults for the climate scalars. Existing callers that
/// don't yet thread climate into the pre-bake (the renderer's terrain
/// atlas upload, the JS preview path) keep working.
pub fn generate(seed: u32, water_fraction: f32) -> PreBake {
    generate_with(BakeInput::earthlike(seed, water_fraction))
}

/// Generate the per-seed surface pre-bake. The default 1024×512 grid is
/// deliberately high enough for the globe shader and zoomable surface
/// map to share smooth coastlines without visible atlas blockiness.
pub fn generate_with(input: BakeInput) -> PreBake {
    let key = PreBakeKey::from_input(&input);
    if let Some(bake) = lru_get(&key) {
        return bake;
    }
    let bake = generate_uncached(&input);
    lru_put(key, bake.clone());
    bake
}

fn lru_get(key: &PreBakeKey) -> Option<PreBake> {
    PREBAKE_LRU.with(|slot| {
        let mut slot = slot.borrow_mut();
        let pos = slot.iter().position(|entry| &entry.key == key)?;
        // Move-to-front MRU.
        let entry = slot.remove(pos);
        let bake = entry.bake.clone();
        slot.insert(0, entry);
        Some(bake)
    })
}

fn lru_put(key: PreBakeKey, bake: PreBake) {
    PREBAKE_LRU.with(|slot| {
        let mut slot = slot.borrow_mut();
        // Drop any stale entry for this key (shouldn't happen — lru_get
        // would have hit first — but be defensive against future
        // refactors).
        slot.retain(|entry| entry.key != key);
        slot.insert(0, PreBakeCacheEntry { key, bake });
        if slot.len() > LRU_CAPACITY {
            slot.truncate(LRU_CAPACITY);
        }
    });
}

fn generate_uncached(input: &BakeInput) -> PreBake {
    let seed = input.seed;
    let water_fraction = input.water_fraction.clamp(0.0, 1.0);
    let lon_cells = input.lon_cells.max(16) as usize;
    let lat_cells = input.lat_cells.max(8) as usize;
    let mut rng = Rng::new(seed);
    let plates = make_plates(&mut rng, water_fraction);

    let total = lat_cells * lon_cells;
    let mut heightmap = vec![0.0f32; total];
    let mut plate_id = vec![0u8; total];
    let mut moisture = vec![0.0f32; total];
    let mut temperature_k = vec![0.0f32; total];
    let mut biome_id = vec![0u8; total];

    for i in 0..lat_cells {
        let lat = -std::f32::consts::FRAC_PI_2
            + (i as f32 + 0.5) / lat_cells as f32 * std::f32::consts::PI;
        let (sin_lat, cos_lat) = (lat.sin(), lat.cos());
        for j in 0..lon_cells {
            let lon =
                -std::f32::consts::PI + (j as f32 + 0.5) / lon_cells as f32 * std::f32::consts::TAU;
            // Unit-sphere Cartesian point.
            let p = [cos_lat * lon.cos(), sin_lat, cos_lat * lon.sin()];
            let (best, second) = nearest_two(&plates, p);
            // Boundary closeness: 1 at a perfect interior of a plate,
            // approaching 0 at a boundary. Used to weight uplift.
            let edge = 1.0 - (best.dist / second.dist.max(1e-5)).clamp(0.0, 1.0);
            let plate = &plates[best.idx];

            // Continental / oceanic baseline from the nearest plates. Blend
            // toward the second-nearest plate at boundaries so coastlines and
            // lowlands are not hard Voronoi edges.
            let other = &plates[second.idx];
            let boundary_mix = 0.5 * (1.0 - edge);
            let mut h = plate.mean_elev * (1.0 - boundary_mix) + other.mean_elev * boundary_mix;

            // Boundary forcing: project the plate drift vectors at the
            // sample point and check if they converge (positive) or
            // diverge (negative) along the boundary.
            let dir_to_other = sub_norm(other.centre, plate.centre);
            let conv_self = dot(plate.drift, dir_to_other);
            let conv_other = dot(other.drift, neg(dir_to_other));
            let convergence = (conv_self + conv_other) * 0.5;
            // Boundary weight is strongest at the edge where the two
            // plates' nearest distances are nearly equal.
            let boundary_w = (1.0 - edge).powf(2.0);
            h += convergence * 0.55 * boundary_w;

            // Multi-octave value noise for texture on top.
            let noise = value_noise_3d(p, seed);
            h += noise * 0.24;

            // Clamp into a working range so downstream sea-level picking
            // has a consistent distribution.
            h = h.clamp(-1.0, 1.0);

            let idx = i * lon_cells + j;
            heightmap[idx] = h;
            plate_id[idx] = best.idx as u8;
        }
    }

    // Sea level: pick the quantile of the heightmap that matches the
    // requested water fraction. Done after the heightmap pass so every
    // consumer agrees on where the coastline sits.
    let sea_level = quantile_height(&heightmap, water_fraction);

    // Second pass: moisture and temperature need elevation + sea_level
    // to compute properly, so they have to wait until the heightmap is
    // complete.
    for i in 0..lat_cells {
        let lat = -std::f32::consts::FRAC_PI_2
            + (i as f32 + 0.5) / lat_cells as f32 * std::f32::consts::PI;
        let abs_lat_norm = (lat.abs() / std::f32::consts::FRAC_PI_2).clamp(0.0, 1.0);
        let (sin_lat, cos_lat) = (lat.sin(), lat.cos());
        for j in 0..lon_cells {
            let lon =
                -std::f32::consts::PI + (j as f32 + 0.5) / lon_cells as f32 * std::f32::consts::TAU;
            let p = [cos_lat * lon.cos(), sin_lat, cos_lat * lon.sin()];
            let idx = i * lon_cells + j;
            let h = heightmap[idx];
            let above_sea = (h - sea_level).max(0.0);

            let moisture_v = compute_moisture(p, abs_lat_norm, above_sea, input, seed);
            let temp_v = compute_temperature(abs_lat_norm, above_sea, input);

            moisture[idx] = moisture_v;
            temperature_k[idx] = temp_v;

            // Lat-band noise perturbs the polar cap onset so the
            // Snow / Ice biome boundary reads as ragged peninsulas and
            // gulfs, not a clean smoothstep ring. Coarse FBM gives the
            // lobe shape; high-frequency value noise gives finger
            // detail.
            let cap_lobe =
                value_noise_3d([p[0] * 2.8, p[1] * 2.8, p[2] * 2.8], seed ^ 0xA1_5C_9E_31) * 0.10;
            let cap_finger =
                value_noise_3d([p[0] * 9.0, p[1] * 9.0, p[2] * 9.0], seed ^ 0x47_B3_19_7F) * 0.05;
            let effective_ice_lat = (input.ice_latitude - cap_lobe - cap_finger).clamp(0.05, 0.99);

            let lat_norm_signed = i as f32 / lat_cells as f32; // 0..1, south->north
            biome_id[idx] = classify_biome(
                h,
                sea_level,
                lat_norm_signed,
                moisture_v,
                temp_v,
                input.vegetation_richness,
                effective_ice_lat,
            ) as u8;
        }
    }

    PreBake {
        lon_cells: lon_cells as u32,
        lat_cells: lat_cells as u32,
        heightmap,
        plate_id,
        plates,
        sea_level,
        moisture,
        temperature_k,
        biome_id,
    }
}

/// Quantile-based sea-level pick. Picks the elevation value such that
/// `water_fraction` of cells lie below it.
fn quantile_height(heightmap: &[f32], water_fraction: f32) -> f32 {
    if heightmap.is_empty() {
        return 0.0;
    }
    let mut sorted = heightmap.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let target_below = (water_fraction.clamp(0.0, 1.0) * sorted.len() as f32)
        .clamp(0.0, sorted.len() as f32) as usize;
    if target_below == 0 {
        sorted[0] - 0.001
    } else if target_below >= sorted.len() {
        sorted[sorted.len() - 1] + 0.001
    } else {
        sorted[target_below]
    }
}

/// Per-cell moisture in [0, 1]. Sums:
///   - a latitude band term (Hadley-cell aridity in the subtropics,
///     mid-latitude humidity, polar dryness),
///   - a continental-interior dryness term driven by elevation above
///     sea level (mountains and high plateaus are drier),
///   - a per-seed noise term so deserts / wet zones aren't perfectly
///     zonal.
///
/// Scaled by `vegetation_richness` so barren worlds read uniformly dry.
fn compute_moisture(
    p: [f32; 3],
    abs_lat_norm: f32,
    above_sea: f32,
    input: &BakeInput,
    seed: u32,
) -> f32 {
    // Latitude band: wet at the equator and ~50° latitude, dry at the
    // subtropics (~25°) and at the poles. Modelled as
    // cos(lat) * (1 - exp(-((|lat| - 50°)^2 / 200))) ... but we want a
    // cheap, smooth approximation: a weighted blend of two cosines.
    let equator_band = (1.0 - abs_lat_norm).max(0.0).powf(1.4);
    let mid_band = (1.0 - (abs_lat_norm - 0.55).abs() * 2.2).clamp(0.0, 1.0);
    let polar_dry = 1.0 - (abs_lat_norm - 0.78).clamp(0.0, 0.22) * 4.5;
    let lat_term = (equator_band * 0.55 + mid_band * 0.35).clamp(0.0, 1.0) * polar_dry;

    // Continental interior dryness: above-sea elevation reduces
    // moisture, capped so coastal hills aren't deserts.
    let interior_dry = (above_sea * 1.8).clamp(0.0, 0.7);

    // Seed noise so deserts have real shape.
    let n_low = value_noise_3d([p[0] * 0.9, p[1] * 0.9, p[2] * 0.9], seed ^ 0x4E_3F_19_AB);
    let n_high = value_noise_3d([p[0] * 4.2, p[1] * 4.2, p[2] * 4.2], seed ^ 0x9C_1B_27_55);
    let noise = (n_low * 0.6 + n_high * 0.4) * 0.5 + 0.5; // -> [0,1]

    let base = (lat_term * 0.65 + noise * 0.45 - interior_dry).clamp(0.0, 1.0);
    // Vegetation richness is a global moisture envelope: a Mars-like
    // world has richness ≈ 0 and the moisture channel collapses toward
    // a uniform dry value.
    let richness = input.vegetation_richness.clamp(0.0, 1.0);
    base * richness + (1.0 - richness) * 0.05
}

/// Per-cell temperature in Kelvin. Mean - latitude gradient - lapse
/// rate * elevation. Earth-like equator-to-pole spread is ~60 K; we use
/// that as the gradient amplitude.
fn compute_temperature(abs_lat_norm: f32, above_sea: f32, input: &BakeInput) -> f32 {
    let mean = input.mean_temp_k.max(0.0);
    // Solar angle proxy: cos²(lat). At the poles we lose ~60 K relative
    // to the equator.
    let lat_factor = abs_lat_norm.powf(1.6);
    let lat_drop = 60.0 * lat_factor;
    // Atmospheric lapse rate ≈ 6.5 K/km. Our above_sea is normalised
    // to ~[0, 1] where 1 ≈ continent-top elevation (a few km on Earth).
    // 12 K/unit gives a believable cold-on-peaks effect.
    let lapse = 12.0 * above_sea;
    (mean - lat_drop - lapse).max(0.0)
}

/// Canonical biome classifier. Single source of truth for biome
/// assignment — the globe shader, surface map, and region view all
/// look up biomes from the atlas this produces. If two views disagree
/// on what's at a coordinate, this function is wrong, not them.
#[allow(clippy::too_many_arguments)]
pub fn classify_biome(
    elevation: f32,
    sea_level: f32,
    lat_norm: f32, // 0 = south pole, 1 = north
    moisture: f32,
    temp_k: f32,
    vegetation_richness: f32,
    ice_latitude: f32,
) -> BiomeId {
    const FREEZE_K: f32 = 273.15;
    let abs_lat = (lat_norm - 0.5).abs() * 2.0; // 0 at equator, 1 at poles
    let above = (elevation - sea_level).max(0.0);
    let below = (sea_level - elevation).max(0.0);

    // Polar caps: latitude crosses ice_latitude AND it's cold enough.
    if abs_lat >= ice_latitude && temp_k < FREEZE_K + 5.0 {
        // Ice on water, snow / barren on land.
        if elevation < sea_level {
            return BiomeId::Ice;
        }
        if vegetation_richness < 0.05 {
            return BiomeId::Barren;
        }
        return BiomeId::Snow;
    }

    // Submerged.
    if elevation < sea_level {
        // Anything below ~0.20 raw depth (still working in the heightmap
        // [-1, 1] space) is shallow; deeper than that reads as deep ocean.
        if below < 0.08 {
            return BiomeId::ShallowOcean;
        }
        return BiomeId::DeepOcean;
    }

    // Just above the waterline: coastal strip. Tight, so it reads as a
    // beach band rather than a wide plain.
    if above < 0.015 && vegetation_richness > 0.05 {
        return BiomeId::Shore;
    }

    // Volcanic worlds (very hot) — sprinkle volcanic across high relief.
    if temp_k > 800.0 {
        if above > 0.40 {
            return BiomeId::Volcanic;
        }
        return BiomeId::Mountain;
    }

    // High elevation.
    if above > 0.55 {
        // Cold high peaks pick up snow caps even off-pole.
        if temp_k < FREEZE_K - 2.0 {
            return BiomeId::Snow;
        }
        return BiomeId::Mountain;
    }
    if above > 0.32 {
        // Mid-elevation: alpine rock when cold or dry, hills otherwise.
        if temp_k < FREEZE_K + 2.0 || moisture < 0.18 {
            return BiomeId::AlpineRock;
        }
        return BiomeId::Hills;
    }

    // Cold lowlands → tundra.
    if temp_k < FREEZE_K + 4.0 {
        return BiomeId::Tundra;
    }

    // Barren-world override: no vegetation infrastructure available.
    if vegetation_richness < 0.05 {
        return BiomeId::Barren;
    }

    // Dry hot → desert. Dry temperate → savanna.
    if moisture < 0.22 {
        if temp_k > FREEZE_K + 25.0 {
            return BiomeId::Desert;
        }
        return BiomeId::Savanna;
    }

    // Moist + cool → forest. Moist + temperate → grassland. Moist + hot → savanna.
    if temp_k < FREEZE_K + 22.0 && moisture > 0.45 {
        return BiomeId::Forest;
    }
    if temp_k > FREEZE_K + 30.0 && moisture < 0.55 {
        return BiomeId::Savanna;
    }
    if moisture > 0.55 {
        return BiomeId::Grassland;
    }
    BiomeId::Plain
}

fn make_plates(rng: &mut Rng, water_fraction: f32) -> Vec<Plate> {
    // 6-10 plates - enough to feel like Earth's plate system, not so many
    // that boundary geometry becomes mush at this resolution.
    let n = 6 + (rng.f01() * 5.0) as usize;
    let mut plates = Vec::with_capacity(n);

    // Bias plate baseline elevations so the ocean fraction roughly matches
    // the climate water fraction. Continental plates sit above sea level,
    // oceanic below.
    let continental_count = ((1.0 - water_fraction) * n as f32)
        .round()
        .clamp(1.0, (n - 1) as f32) as usize;

    for k in 0..n {
        let centre = sample_sphere(rng);
        // Drift tangent to the sphere at the centre (orthogonal to centre).
        let drift = sample_tangent(rng, centre);
        let mean_elev = if k < continental_count {
            rng.range(0.25, 0.55)
        } else {
            rng.range(-0.55, -0.20)
        };
        plates.push(Plate {
            centre,
            drift,
            mean_elev,
        });
    }
    plates
}

fn sample_sphere(rng: &mut Rng) -> [f32; 3] {
    // Cylinder-then-project for uniform distribution.
    let z = rng.range(-1.0, 1.0);
    let phi = rng.range(-std::f32::consts::PI, std::f32::consts::PI);
    let r = (1.0 - z * z).max(0.0).sqrt();
    [r * phi.cos(), z, r * phi.sin()]
}

fn sample_tangent(rng: &mut Rng, centre: [f32; 3]) -> [f32; 3] {
    // Pick another point, take the rejection-projected residual as a
    // tangent vector, normalise, scale to a small speed.
    let other = sample_sphere(rng);
    let dotc = dot(other, centre);
    let mut t = [
        other[0] - dotc * centre[0],
        other[1] - dotc * centre[1],
        other[2] - dotc * centre[2],
    ];
    let n = (t[0] * t[0] + t[1] * t[1] + t[2] * t[2]).sqrt();
    if n < 1e-6 {
        return [1.0, 0.0, 0.0];
    }
    t[0] /= n;
    t[1] /= n;
    t[2] /= n;
    let speed = rng.range(0.5, 1.5);
    [t[0] * speed, t[1] * speed, t[2] * speed]
}

#[derive(Clone, Copy)]
struct PlateHit {
    idx: usize,
    dist: f32,
}

fn nearest_two(plates: &[Plate], p: [f32; 3]) -> (PlateHit, PlateHit) {
    let mut best = PlateHit {
        idx: 0,
        dist: f32::INFINITY,
    };
    let mut second = PlateHit {
        idx: 0,
        dist: f32::INFINITY,
    };
    for (i, plate) in plates.iter().enumerate() {
        // Spherical distance: 1 - dot(centre, p). Cheap proxy for arc length.
        let d = 1.0 - dot(plate.centre, p);
        if d < best.dist {
            second = best;
            best = PlateHit { idx: i, dist: d };
        } else if d < second.dist {
            second = PlateHit { idx: i, dist: d };
        }
    }
    (best, second)
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn sub_norm(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    let mut d = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    let n = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt().max(1e-6);
    d[0] /= n;
    d[1] /= n;
    d[2] /= n;
    d
}

fn neg(a: [f32; 3]) -> [f32; 3] {
    [-a[0], -a[1], -a[2]]
}

fn hash3(x: i32, y: i32, z: i32, seed: u32) -> f32 {
    let mut h = ((x as i64).wrapping_mul(374_761_393)
        ^ (y as i64).wrapping_mul(668_265_263)
        ^ (z as i64).wrapping_mul(1_274_126_177)
        ^ (seed as i64)) as u64;
    h = h.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    h ^= h >> 30;
    h = h.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    h ^= h >> 27;
    ((h >> 32) as f32 / u32::MAX as f32) * 2.0 - 1.0
}

fn smoothstep(t: f32) -> f32 {
    t * t * (3.0 - 2.0 * t)
}

fn value_noise_lattice(p: [f32; 3], seed: u32) -> f32 {
    let xi = p[0].floor() as i32;
    let yi = p[1].floor() as i32;
    let zi = p[2].floor() as i32;
    let fx = smoothstep(p[0] - xi as f32);
    let fy = smoothstep(p[1] - yi as f32);
    let fz = smoothstep(p[2] - zi as f32);
    let mut acc = 0.0;
    for dz in 0..2 {
        for dy in 0..2 {
            for dx in 0..2 {
                let h = hash3(xi + dx, yi + dy, zi + dz, seed);
                let wx = if dx == 0 { 1.0 - fx } else { fx };
                let wy = if dy == 0 { 1.0 - fy } else { fy };
                let wz = if dz == 0 { 1.0 - fz } else { fz };
                acc += h * wx * wy * wz;
            }
        }
    }
    acc
}

fn value_noise_3d(p: [f32; 3], seed: u32) -> f32 {
    // 5-octave fractal noise on the unit-sphere point. Frequencies
    // chosen so the lowest octave carries continent-scale features and
    // the highest carries terrain texture without aliasing the 1024×512
    // grid.
    let mut acc = 0.0;
    let mut amp = 0.5;
    let mut freq = 1.5;
    let mut weight = 0.0;
    for octave in 0..5 {
        let q = [p[0] * freq, p[1] * freq, p[2] * freq];
        acc += value_noise_lattice(
            q,
            seed.wrapping_add((octave as u32).wrapping_mul(0x9E37_79B9)),
        ) * amp;
        weight += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    acc / weight
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_for_same_seed() {
        let a = generate(42, 0.7);
        let b = generate(42, 0.7);
        assert_eq!(a.heightmap, b.heightmap);
        assert_eq!(a.plate_id, b.plate_id);
        assert_eq!(a.biome_id, b.biome_id);
        assert_eq!(a.sea_level, b.sea_level);
        for (x, y) in a.moisture.iter().zip(b.moisture.iter()) {
            assert!((x - y).abs() < 1e-6, "moisture diverged: {x} vs {y}");
        }
        for (x, y) in a.temperature_k.iter().zip(b.temperature_k.iter()) {
            assert!((x - y).abs() < 1e-6, "temperature diverged: {x} vs {y}");
        }
    }

    #[test]
    fn heightmap_has_expected_size() {
        let p = generate(1, 0.5);
        assert_eq!(p.heightmap.len(), PREBAKE_LON * PREBAKE_LAT);
        assert_eq!(p.plate_id.len(), PREBAKE_LON * PREBAKE_LAT);
        assert_eq!(p.moisture.len(), PREBAKE_LON * PREBAKE_LAT);
        assert_eq!(p.temperature_k.len(), PREBAKE_LON * PREBAKE_LAT);
        assert_eq!(p.biome_id.len(), PREBAKE_LON * PREBAKE_LAT);
        assert!(p.plates.len() >= 6 && p.plates.len() <= 11);
    }

    #[test]
    fn heightmap_values_in_range() {
        let p = generate(7, 0.5);
        for h in &p.heightmap {
            assert!(h.is_finite());
            assert!(*h >= -1.0 && *h <= 1.0, "out of range: {h}");
        }
        for m in &p.moisture {
            assert!(
                m.is_finite() && (0.0..=1.0).contains(m),
                "moisture {m} out of range"
            );
        }
        for t in &p.temperature_k {
            assert!(t.is_finite() && *t >= 0.0, "temperature {t} not physical");
        }
    }

    #[test]
    fn ocean_fraction_responds_to_water_input() {
        // Same seed, two different water fractions - high should produce
        // more cells below 0 than low. The exact ocean fraction depends
        // on tectonic noise but the ordering is robust.
        let dry = generate(13, 0.20);
        let wet = generate(13, 0.85);
        // Choose sea level at the median of each so we compare like-for-like.
        let dry_below = dry.heightmap.iter().filter(|h| **h < 0.0).count();
        let wet_below = wet.heightmap.iter().filter(|h| **h < 0.0).count();
        assert!(
            wet_below > dry_below,
            "expected wet ({wet_below}) to have more sub-zero cells than dry ({dry_below})"
        );
    }

    #[test]
    fn sample_round_trips_at_cell_centres() {
        let p = generate(99, 0.5);
        // Sample the centre of cell (i, j) using normalised coordinates.
        let i = 12usize;
        let j = 47usize;
        let lat_norm = (i as f32 + 0.5) / PREBAKE_LAT as f32;
        let lon_norm = (j as f32 + 0.5) / PREBAKE_LON as f32;
        let want = p.heightmap[i * PREBAKE_LON + j];
        let got = p.sample(lat_norm, lon_norm);
        // Bilinear of the cell value with itself should equal the value.
        assert!(
            (got - want).abs() < 1e-4,
            "sample {got} far from cell {want}"
        );
    }

    #[test]
    fn sea_level_matches_water_fraction() {
        // Pick a few targets and verify the bake's sea_level lands
        // within ~1 % of the requested quantile.
        for target in [0.2_f32, 0.5, 0.75] {
            let bake = generate(2024, target);
            let actual = bake.ocean_fraction(bake.sea_level);
            assert!(
                (actual - target).abs() < 0.012,
                "ocean fraction {actual} far from target {target}"
            );
        }
    }

    #[test]
    fn surface_seed_is_stable_and_avalanches() {
        let base = SurfaceIdentity {
            sector_seed: 0xCAFE,
            subsector_seed: 0xBEEF,
            hex_col: 3,
            hex_row: 7,
            uwp: "B564500-9",
            name: "Aenis",
        };
        let s1 = surface_seed(&base);
        let s2 = surface_seed(&base);
        assert_eq!(s1, s2, "same identity must hash the same");

        // Each field change must produce a different seed.
        let mut alt = base;
        alt.hex_col = 4;
        assert_ne!(surface_seed(&alt), s1, "hex change should change seed");

        let mut alt = base;
        alt.uwp = "B564500-A";
        assert_ne!(surface_seed(&alt), s1, "uwp change should change seed");

        let mut alt = base;
        alt.name = "Bellis";
        assert_ne!(surface_seed(&alt), s1, "name change should change seed");

        let mut alt = base;
        alt.sector_seed = 0xCAFF;
        assert_ne!(surface_seed(&alt), s1, "sector change should change seed");
    }

    #[test]
    fn biome_classifier_basic_cases() {
        let earth_input = (0.65_f32, 0.82_f32); // veg_rich, ice_lat

        // Deep below sea.
        let b = classify_biome(-0.5, 0.0, 0.5, 0.5, 290.0, earth_input.0, earth_input.1);
        assert_eq!(b, BiomeId::DeepOcean);

        // Just below sea.
        let b = classify_biome(-0.01, 0.0, 0.5, 0.5, 290.0, earth_input.0, earth_input.1);
        assert_eq!(b, BiomeId::ShallowOcean);

        // Coastal strip.
        let b = classify_biome(0.005, 0.0, 0.5, 0.5, 290.0, earth_input.0, earth_input.1);
        assert_eq!(b, BiomeId::Shore);

        // Hot dry equatorial → desert.
        let b = classify_biome(0.10, 0.0, 0.5, 0.10, 305.0, earth_input.0, earth_input.1);
        assert_eq!(b, BiomeId::Desert);

        // Cold polar land → snow.
        let b = classify_biome(0.20, 0.0, 0.97, 0.5, 250.0, earth_input.0, earth_input.1);
        assert_eq!(b, BiomeId::Snow);

        // Cold polar ocean → ice.
        let b = classify_biome(-0.05, 0.0, 0.97, 0.5, 250.0, earth_input.0, earth_input.1);
        assert_eq!(b, BiomeId::Ice);

        // High mountain.
        let b = classify_biome(0.70, 0.0, 0.5, 0.5, 280.0, earth_input.0, earth_input.1);
        assert_eq!(b, BiomeId::Mountain);

        // Barren world → no vegetation.
        let b = classify_biome(0.10, 0.0, 0.5, 0.5, 285.0, 0.0, earth_input.1);
        assert_eq!(b, BiomeId::Barren);
    }

    #[test]
    fn lru_cache_hits_and_evicts() {
        // First generate four distinct bakes; then re-request the first
        // one and verify it didn't have to re-bake by checking
        // determinism (same output) and that the LRU evicts oldest.
        let a = generate(101, 0.3);
        let b = generate(102, 0.3);
        let c = generate(103, 0.3);
        let d = generate(104, 0.3);
        let a2 = generate(101, 0.3);
        assert_eq!(a.heightmap, a2.heightmap, "cache hit must return identical");
        // Force eviction of `b` by adding a 5th distinct key.
        let _e = generate(105, 0.3);
        // `b`'s bake should be re-baked here — it'll still be identical
        // due to determinism, but we can at least verify it still works.
        let b2 = generate(102, 0.3);
        assert_eq!(b.heightmap, b2.heightmap);
        // Touch all references so the compiler doesn't strip them.
        let _ = (c.lon_cells, d.lon_cells);
    }

    #[test]
    fn resolution_for_quality_picks_tiers() {
        let (lo_lon, lo_lat) = resolution_for_quality(0.30);
        let (mid_lon, mid_lat) = resolution_for_quality(0.75);
        let (hi_lon, hi_lat) = resolution_for_quality(1.0);
        assert!(lo_lon < mid_lon && lo_lat < mid_lat);
        assert!(mid_lon < hi_lon && mid_lat < hi_lat);
        // Always a 2:1 aspect to match equirectangular sampling.
        assert_eq!(lo_lon, lo_lat * 2);
        assert_eq!(mid_lon, mid_lat * 2);
        assert_eq!(hi_lon, hi_lat * 2);
    }

    #[test]
    fn bake_respects_explicit_resolution() {
        // Low-tier bake should produce the small atlas.
        let low = generate_with(BakeInput::earthlike(2, 0.6).with_quality(0.20));
        assert_eq!(low.lon_cells, PREBAKE_LOW_LON as u32);
        assert_eq!(low.lat_cells, PREBAKE_LOW_LAT as u32);
        assert_eq!(low.heightmap.len(), PREBAKE_LOW_LON * PREBAKE_LOW_LAT);
        assert_eq!(low.biome_id.len(), PREBAKE_LOW_LON * PREBAKE_LOW_LAT);
        // High-tier bake should produce the large atlas.
        let high = generate_with(BakeInput::earthlike(2, 0.6).with_quality(1.0));
        assert_eq!(high.lon_cells, PREBAKE_HIGH_LON as u32);
        assert_eq!(high.lat_cells, PREBAKE_HIGH_LAT as u32);
    }

    #[test]
    fn cache_keyed_on_climate_scalars() {
        // Same seed + water but different climate should produce
        // different biome ids — proving the cache key includes climate.
        let warm = generate_with(BakeInput {
            seed: 555,
            water_fraction: 0.6,
            ice_latitude: 0.82,
            mean_temp_k: 295.0,
            vegetation_richness: 0.7,
            lon_cells: PREBAKE_LON as u32,
            lat_cells: PREBAKE_LAT as u32,
        });
        let cold = generate_with(BakeInput {
            seed: 555,
            water_fraction: 0.6,
            ice_latitude: 0.55,
            mean_temp_k: 240.0,
            vegetation_richness: 0.7,
            lon_cells: PREBAKE_LON as u32,
            lat_cells: PREBAKE_LAT as u32,
        });
        // Heightmap is purely a function of (seed, water_fraction) so
        // it should match.
        assert_eq!(warm.heightmap, cold.heightmap);
        // Biome ids should differ — cold world has wider ice + tundra.
        assert_ne!(warm.biome_id, cold.biome_id);
    }
}
