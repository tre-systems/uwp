//! legacy 2d6-style hex world map for a single planet.
//!
//! Climate-driven v1: rather than waiting on the procedural surface
//! pre-bake (Compute Roadmap item 1), this implementation drives terrain
//! classification straight from the planet's existing ClimateSummary plus
//! latitude and a low-frequency seed noise. It won't match the globe's
//! per-fragment noise stack — that consistency arrives with the pre-bake
//! — but it WILL match the broad bands a user perceives (polar caps,
//! temperate belts, hot deserts) and it gives Cepheus GMs a usable hex
//! world map today.
//!
//! Reference: Cepheus Engine SRD, Book 3, World Mapping section.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

use super::climate::ClimateSummary;
use super::system::{BodyType, Planet};

pub const SURFACE_COLS: u8 = 32;
pub const SURFACE_ROWS: u8 = 16;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum Terrain {
    Ocean,
    Shoreline,
    Plain,
    Forest,
    Hill,
    Mountain,
    Desert,
    Tundra,
    Ice,
    Volcanic,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SurfaceHexCoord {
    pub col: u8,
    pub row: u8,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct SurfaceHex {
    pub coord: SurfaceHexCoord,
    pub terrain: Terrain,
    /// Latitude in degrees, -90 (south) to +90 (north), at the hex centre.
    pub latitude_deg: f32,
    /// Longitude in degrees, -180 to +180.
    pub longitude_deg: f32,
    /// Local equilibrium temperature in Kelvin (climate model band).
    pub temperature_k: f32,
    /// Normalised elevation 0..1 used for terrain selection. Stored for
    /// the inspector so the GM can answer "is this lowland or highland?".
    pub elevation: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Settlement {
    pub coord: SurfaceHexCoord,
    /// 0 = village, 1 = town, 2 = city, 3 = metropolis.
    pub tier: u8,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SurfaceMap {
    pub seed: u32,
    /// Ocean fraction across the grid (matches climate.liquid_water_fraction
    /// up to rounding).
    pub ocean_fraction: f32,
    pub hexes: Vec<SurfaceHex>,
    pub starport: Option<SurfaceHexCoord>,
    pub cities: Vec<Settlement>,
}

impl SurfaceMap {
    pub fn hex_at(&self, coord: SurfaceHexCoord) -> Option<&SurfaceHex> {
        self.hexes
            .iter()
            .find(|h| h.coord.col == coord.col && h.coord.row == coord.row)
    }
}

struct Rng {
    state: u64,
}

impl Rng {
    fn new(seed: u32) -> Self {
        let mut s = (seed as u64) ^ 0xA02D_1F5E_8C13_24B5;
        if s == 0 {
            s = 0x1234_5678_DEAD_BEEF;
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
}

fn elevation_noise(col: u8, row: u8, seed: u32) -> f32 {
    // Cheap value-noise with three octaves so terrain bands have a bit of
    // texture without committing to a full simplex implementation. Output
    // normalised to roughly [-1, 1]; callers map it onto 0..1 as needed.
    let h = |x: i32, y: i32, salt: u32| -> f32 {
        let mut z = ((x as i64).wrapping_mul(374_761_393)
            ^ (y as i64).wrapping_mul(668_265_263)
            ^ (seed as i64))
            .wrapping_add(salt as i64) as u64;
        z = z.wrapping_mul(0x9E37_79B9_7F4A_7C15);
        z ^= z >> 30;
        z = z.wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z ^= z >> 27;
        ((z >> 32) as f32 / u32::MAX as f32) * 2.0 - 1.0
    };
    let scales: [(i32, u32, f32); 3] = [(2, 0xA, 1.0), (4, 0x55, 0.5), (8, 0xC3, 0.25)];
    let mut acc = 0.0;
    let mut weight = 0.0;
    for (s, salt, w) in scales {
        let cx = col as i32 / s;
        let cy = row as i32 / s;
        acc += h(cx, cy, salt) * w;
        weight += w;
    }
    acc / weight
}

pub fn generate(planet: &Planet, climate: &ClimateSummary, seed: u32) -> SurfaceMap {
    let mut hexes = Vec::with_capacity((SURFACE_COLS as usize) * (SURFACE_ROWS as usize));
    let mut ocean_cells = 0usize;
    let mut total_cells = 0usize;

    let water = climate.liquid_water_fraction.clamp(0.0, 1.0);
    let ice = climate.ice_fraction.clamp(0.0, 1.0);
    let mean_t = climate.mean_surface_temp_k;

    // First pass: collect every elevation so we can pick a sea level by
    // quantile — guarantees the ocean fraction lands close to the climate
    // water-inventory regardless of the noise function's distribution.
    let mut elevations: Vec<f32> =
        Vec::with_capacity((SURFACE_COLS as usize) * (SURFACE_ROWS as usize));
    for row in 0..SURFACE_ROWS {
        for col in 0..SURFACE_COLS {
            elevations.push(elevation_noise(col, row, seed));
        }
    }
    let mut sorted = elevations.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let target_below = (water * sorted.len() as f32).clamp(0.0, sorted.len() as f32) as usize;
    let sea_level = if target_below == 0 {
        sorted[0] - 0.001
    } else if target_below >= sorted.len() {
        sorted[sorted.len() - 1] + 0.001
    } else {
        sorted[target_below]
    };

    for row in 0..SURFACE_ROWS {
        for col in 0..SURFACE_COLS {
            let lat_deg = -90.0 + (row as f32 + 0.5) * 180.0 / SURFACE_ROWS as f32;
            let lon_deg = -180.0 + (col as f32 + 0.5) * 360.0 / SURFACE_COLS as f32;
            let idx = row as usize * SURFACE_COLS as usize + col as usize;
            let elev_signed = elevations[idx];
            let elev_norm = (elev_signed * 0.5 + 0.5).clamp(0.0, 1.0);

            // Latitude factor scaled to drive ice extent: at the climate
            // ice_fraction value the polar band starts.
            let abs_lat = lat_deg.abs() / 90.0;

            // Local temperature: mean - latitude-gradient * |lat|.
            // 60 K equator-to-pole spread roughly mirrors Earth.
            let local_t = mean_t - 60.0 * (abs_lat - 0.4).max(0.0);

            let terrain = classify(
                planet.body_type,
                elev_signed,
                sea_level,
                abs_lat,
                ice,
                local_t,
                water,
                seed,
                col,
                row,
            );

            if matches!(terrain, Terrain::Ocean) {
                ocean_cells += 1;
            }
            total_cells += 1;

            hexes.push(SurfaceHex {
                coord: SurfaceHexCoord { col, row },
                terrain,
                latitude_deg: lat_deg,
                longitude_deg: lon_deg,
                temperature_k: local_t,
                elevation: elev_norm,
            });
        }
    }

    let ocean_fraction = ocean_cells as f32 / total_cells.max(1) as f32;
    let starport = pick_starport(&hexes, planet, &mut Rng::new(seed ^ 0x5707_5704));
    let cities = pick_cities(
        &hexes,
        starport,
        population_settlement_count(planet, climate),
        &mut Rng::new(seed ^ 0x0C17_71E5),
    );

    SurfaceMap {
        seed,
        ocean_fraction,
        hexes,
        starport,
        cities,
    }
}

#[allow(clippy::too_many_arguments)]
fn classify(
    body: BodyType,
    elev_signed: f32,
    sea_level: f32,
    abs_lat: f32,
    ice_fraction: f32,
    local_t: f32,
    water: f32,
    seed: u32,
    col: u8,
    row: u8,
) -> Terrain {
    const FREEZE: f32 = 273.15;

    // Tiny tie-break noise so volcanic / desert speckle the broader bands.
    let salt = (col as u32)
        .wrapping_mul(0x9E37_79B9)
        .wrapping_add((row as u32).wrapping_mul(0x85EB_CA6B))
        .wrapping_add(seed)
        .rotate_left(13);
    let speckle = (salt as f32 / u32::MAX as f32).abs();

    // Polar ice extent rises with the global ice fraction.
    let ice_band = 1.0 - ice_fraction.clamp(0.0, 0.8) * 0.55;
    if abs_lat > ice_band {
        if water < 0.05 || elev_signed > sea_level {
            return Terrain::Ice;
        }
        return Terrain::Ice;
    }

    // Submerged
    if elev_signed < sea_level {
        return Terrain::Ocean;
    }
    if (elev_signed - sea_level).abs() < 0.06 && water > 0.1 {
        return Terrain::Shoreline;
    }

    // Volcanic worlds: temperature > 500 K reads as Inferno-like; speckle volcanic.
    if matches!(body, BodyType::Inferno) {
        return if speckle > 0.85 {
            Terrain::Volcanic
        } else {
            Terrain::Mountain
        };
    }

    // High elevation -> mountain. Mid-high -> hill.
    if elev_signed > sea_level + 0.55 {
        return Terrain::Mountain;
    }
    if elev_signed > sea_level + 0.30 {
        return Terrain::Hill;
    }

    // Cold mid-latitudes -> tundra.
    if local_t < FREEZE + 5.0 {
        return Terrain::Tundra;
    }

    // Hot, dry mid-band -> desert.
    if local_t > FREEZE + 35.0 && water < 0.30 {
        return Terrain::Desert;
    }
    // Temperate + water -> forest at moderate elevation, plain at low.
    if water > 0.20
        && (FREEZE + 5.0..FREEZE + 38.0).contains(&local_t)
        && (elev_signed > sea_level + 0.10 || speckle > 0.55)
    {
        return Terrain::Forest;
    }
    Terrain::Plain
}

fn pick_starport(hexes: &[SurfaceHex], planet: &Planet, rng: &mut Rng) -> Option<SurfaceHexCoord> {
    // Habitable, low-elevation, non-ocean cells with a coastal preference.
    if !matches!(
        planet.body_type,
        BodyType::Terrestrial | BodyType::SuperEarth | BodyType::Rocky
    ) {
        return None;
    }
    let mut best: Option<(f32, SurfaceHexCoord)> = None;
    for hex in hexes {
        let mut score = 0.0_f32;
        match hex.terrain {
            Terrain::Plain => score += 1.0,
            Terrain::Shoreline => score += 1.4,
            Terrain::Forest => score += 0.7,
            Terrain::Hill => score += 0.3,
            _ => continue,
        }
        // Prefer mid-latitudes (most habitable).
        score += (1.0 - (hex.latitude_deg.abs() / 60.0).min(1.0)) * 0.6;
        // Tiny jitter so swapping seeds picks different cells when ties.
        score += rng.f01() * 0.15;
        if best.is_none_or(|(b, _)| score > b) {
            best = Some((score, hex.coord));
        }
    }
    best.map(|(_, c)| c)
}

fn population_settlement_count(planet: &Planet, climate: &ClimateSummary) -> usize {
    // Hand-wavy mapping from main-world habitability to settlement count.
    // Real UWP-driven count would key on the pop digit, but we generate
    // the map on demand without re-running the full UWP projection, so
    // use the climate score as a proxy.
    let base = (climate.habitability * 18.0) as usize;
    let class_mult = match planet.body_type {
        BodyType::Terrestrial | BodyType::SuperEarth => 1.0,
        BodyType::Rocky => 0.4,
        _ => 0.0,
    };
    ((base as f32) * class_mult).round().max(0.0) as usize
}

fn pick_cities(
    hexes: &[SurfaceHex],
    starport: Option<SurfaceHexCoord>,
    target: usize,
    rng: &mut Rng,
) -> Vec<Settlement> {
    if target == 0 {
        return Vec::new();
    }
    // Score each habitable cell; sample without replacement weighted by
    // score and enforce a minimum hex separation so cities don't clump.
    let mut scored: Vec<(f32, &SurfaceHex)> = hexes
        .iter()
        .filter_map(|h| {
            let base = match h.terrain {
                Terrain::Plain => 1.0,
                Terrain::Shoreline => 1.3,
                Terrain::Forest => 0.6,
                Terrain::Hill => 0.4,
                _ => return None,
            };
            let lat_score = 1.0 - (h.latitude_deg.abs() / 75.0).min(1.0);
            Some((base * (0.6 + 0.6 * lat_score) + rng.f01() * 0.4, h))
        })
        .collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    let mut placed: Vec<Settlement> = Vec::new();
    let min_gap_sq: i32 = 4;
    for (_, hex) in scored {
        if placed.len() >= target {
            break;
        }
        if let Some(sp) = starport {
            if sp == hex.coord {
                continue;
            }
        }
        let too_close = placed.iter().any(|s| {
            let dc = hex.coord.col as i32 - s.coord.col as i32;
            let dr = hex.coord.row as i32 - s.coord.row as i32;
            dc * dc + dr * dr < min_gap_sq
        });
        if too_close {
            continue;
        }
        let tier = if placed.is_empty() {
            3
        } else if placed.len() < target / 4 {
            2
        } else if placed.len() < target / 2 {
            1
        } else {
            0
        };
        placed.push(Settlement {
            coord: hex.coord,
            tier,
        });
    }
    placed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::system;

    fn earthlike_planet() -> (Planet, ClimateSummary) {
        let mut sys = system::generate(1);
        // Take the most habitable rocky in the generated system; fall back to
        // synthesising one if none qualify.
        let p_idx = sys
            .planets
            .iter()
            .position(|p| {
                matches!(
                    p.body_type,
                    BodyType::Terrestrial | BodyType::SuperEarth | BodyType::Rocky
                )
            })
            .unwrap_or(0);
        let p = sys.planets.remove(p_idx);
        let c = p.climate;
        (p, c)
    }

    #[test]
    fn deterministic_for_same_seed() {
        let (p, c) = earthlike_planet();
        let a = generate(&p, &c, 0xABCD);
        let b = generate(&p, &c, 0xABCD);
        assert_eq!(a.hexes.len(), b.hexes.len());
        assert_eq!(a.starport, b.starport);
        assert_eq!(a.cities.len(), b.cities.len());
        for (ha, hb) in a.hexes.iter().zip(b.hexes.iter()) {
            assert_eq!(ha.coord, hb.coord);
            assert_eq!(ha.terrain, hb.terrain);
        }
    }

    #[test]
    fn fills_grid() {
        let (p, c) = earthlike_planet();
        let m = generate(&p, &c, 1);
        assert_eq!(
            m.hexes.len(),
            (SURFACE_COLS as usize) * (SURFACE_ROWS as usize)
        );
        for h in &m.hexes {
            assert!(h.coord.col < SURFACE_COLS);
            assert!(h.coord.row < SURFACE_ROWS);
            assert!(h.elevation >= 0.0 && h.elevation <= 1.0);
        }
    }

    #[test]
    fn ocean_fraction_tracks_climate() {
        // Synthesise a planet with a known climate water fraction.
        let mut p = system::generate(1).planets.remove(0);
        p.body_type = BodyType::Terrestrial;
        let c = ClimateSummary {
            mean_surface_temp_k: 288.0,
            min_surface_temp_k: 250.0,
            max_surface_temp_k: 305.0,
            greenhouse_k: 33.0,
            liquid_water_fraction: 0.7,
            ice_fraction: 0.10,
            aridity: 0.15,
            habitability: 0.75,
        };
        let m = generate(&p, &c, 1);
        // Loose tolerance — sea level is set from the climate water frac
        // and a three-octave noise has finite resolution at 32×16.
        let frac = m.ocean_fraction;
        let expected = c.liquid_water_fraction;
        assert!(
            (frac - expected).abs() < 0.30,
            "ocean fraction {frac:.2} far from climate {expected:.2}"
        );
    }

    #[test]
    fn cold_world_grows_ice_caps() {
        // Synthesise a cold world directly and assert the polar bands are ice.
        let mut p = system::generate(1).planets.remove(0);
        p.body_type = BodyType::Terrestrial;
        p.temperature_k = 230.0;
        p.mass_earth = 1.0;
        p.radius_earth = 1.0;
        let c = ClimateSummary {
            mean_surface_temp_k: 230.0,
            min_surface_temp_k: 200.0,
            max_surface_temp_k: 250.0,
            greenhouse_k: 20.0,
            liquid_water_fraction: 0.20,
            ice_fraction: 0.55,
            aridity: 0.5,
            habitability: 0.2,
        };
        let m = generate(&p, &c, 7);
        let polar_ice = m
            .hexes
            .iter()
            .filter(|h| h.latitude_deg.abs() > 75.0 && matches!(h.terrain, Terrain::Ice))
            .count();
        let polar_total = m
            .hexes
            .iter()
            .filter(|h| h.latitude_deg.abs() > 75.0)
            .count();
        assert!(
            polar_ice as f32 / polar_total as f32 > 0.5,
            "expected polar bands to be mostly ice"
        );
    }
}
