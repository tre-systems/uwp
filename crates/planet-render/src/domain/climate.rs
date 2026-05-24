use serde::{Deserialize, Serialize};

use super::system::{BodyType, Planet};

const LATITUDE_BANDS: usize = 36;
const ITERATIONS: usize = 8;
const FREEZE_K: f32 = 273.15;
const BOIL_K: f32 = 373.15;
/// Number of orbital-phase samples for the obliquity-modulated insolation
/// average. Four samples (perihelion + the two solstices + apoapsis-ish)
/// is enough to capture the annual energy budget for typical eccentricity
/// values without making the per-planet climate cost visible.
const SEASON_SAMPLES: usize = 4;

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct ClimateSummary {
    /// Global mean surface temperature after greenhouse and ice-albedo feedback.
    pub mean_surface_temp_k: f32,
    pub min_surface_temp_k: f32,
    pub max_surface_temp_k: f32,
    /// Effective greenhouse warming applied by the climate model.
    pub greenhouse_k: f32,
    /// Fraction of surface carrying stable liquid water in the latitude model.
    pub liquid_water_fraction: f32,
    /// Fraction of surface cold enough for permanent ice.
    pub ice_fraction: f32,
    /// 0 = wet, 1 = extremely dry.
    pub aridity: f32,
    /// Overall Rust-computed habitability score in [0, 1].
    pub habitability: f32,
}

impl ClimateSummary {
    pub fn dead() -> Self {
        Self {
            mean_surface_temp_k: 0.0,
            min_surface_temp_k: 0.0,
            max_surface_temp_k: 0.0,
            greenhouse_k: 0.0,
            liquid_water_fraction: 0.0,
            ice_fraction: 1.0,
            aridity: 1.0,
            habitability: 0.0,
        }
    }
}

/// Run a compact latitude-band climate model for a planet. It is deliberately
/// coarse, but it captures the Rust-owned invariants we care about today:
/// greenhouse warming, ice-albedo feedback, liquid-water coverage and a
/// physically-derived habitability score.
pub fn estimate(planet: &Planet) -> ClimateSummary {
    if !matches!(
        planet.body_type,
        BodyType::Terrestrial
            | BodyType::SuperEarth
            | BodyType::Rocky
            | BodyType::Inferno
            | BodyType::Frozen
    ) {
        return ClimateSummary::dead();
    }

    let base_albedo = base_albedo(planet.body_type);
    let greenhouse_k = greenhouse_warming_k(planet);
    let water_inventory = water_inventory(planet);
    let pressure_score = pressure_score(planet);
    let gravity_score = gravity_score(planet);
    let mut temps = [planet.temperature_k + greenhouse_k; LATITUDE_BANDS];

    // Seed-derived obliquity, 0..40 deg. Same axis the renderer derives
    // from the seed for visual axial tilt, kept here so the temperature
    // model and the rendered planet's tilt agree about which way the
    // poles face.
    let obliquity = obliquity_for_seed(planet.seed);

    for _ in 0..ITERATIONS {
        for (i, temp) in temps.iter_mut().enumerate() {
            let lat = latitude_for_band(i);
            // Average insolation across the orbit. Each sample shifts the
            // subsolar latitude by sin(season_phase) * obliquity and tilts
            // the latitude-vs-sun geometry accordingly. With eccentricity
            // we'd also weight by 1/r^2 here, but the temperature_k input
            // is already the orbit-mean equilibrium so we keep just the
            // geometric tilt term.
            let mut lat_factor = 0.0_f32;
            for s in 0..SEASON_SAMPLES {
                let phase = (s as f32 + 0.5) * std::f32::consts::TAU / SEASON_SAMPLES as f32;
                let subsolar = obliquity * phase.sin();
                lat_factor += latitude_insolation_factor_with_subsolar(lat, subsolar);
            }
            lat_factor /= SEASON_SAMPLES as f32;
            let ice_albedo = if *temp < FREEZE_K { 0.68 } else { base_albedo };
            let albedo_factor = ((1.0 - ice_albedo) / (1.0 - base_albedo)).clamp(0.35, 1.25);
            *temp = planet.temperature_k * lat_factor * albedo_factor.powf(0.25) + greenhouse_k;
        }
    }

    let mut weighted_sum = 0.0;
    let mut weight_total = 0.0;
    let mut min_t = f32::INFINITY;
    let mut max_t = f32::NEG_INFINITY;
    let mut liquid_weight = 0.0;
    let mut ice_weight = 0.0;

    for (i, temp) in temps.iter().copied().enumerate() {
        let lat = latitude_for_band(i);
        let weight = lat.cos().max(0.0);
        weighted_sum += temp * weight;
        weight_total += weight;
        min_t = min_t.min(temp);
        max_t = max_t.max(temp);
        if (FREEZE_K..=BOIL_K).contains(&temp) {
            liquid_weight += weight;
        }
        if temp < FREEZE_K {
            ice_weight += weight;
        }
    }

    let mean_surface_temp_k = weighted_sum / weight_total.max(1e-6);
    let liquid_water_fraction = (liquid_weight / weight_total.max(1e-6)) * water_inventory;
    let ice_fraction = ice_weight / weight_total.max(1e-6);
    let aridity = (1.0 - water_inventory).clamp(0.0, 1.0);
    let thermal_score = gaussian_score(mean_surface_temp_k, 288.0, 45.0);
    let liquid_score = smoothstep(0.03, 0.35, liquid_water_fraction);
    let climate_stability = 1.0 - (ice_fraction - 0.35).clamp(0.0, 0.65) / 0.65;
    let class_score = match planet.body_type {
        BodyType::Terrestrial => 1.0,
        BodyType::SuperEarth => 0.8,
        BodyType::Rocky => 0.45,
        BodyType::Frozen => 0.25,
        BodyType::Inferno => 0.05,
        _ => 0.0,
    };

    ClimateSummary {
        mean_surface_temp_k,
        min_surface_temp_k: min_t,
        max_surface_temp_k: max_t,
        greenhouse_k,
        liquid_water_fraction: liquid_water_fraction.clamp(0.0, 1.0),
        ice_fraction: ice_fraction.clamp(0.0, 1.0),
        aridity,
        habitability: (class_score
            * thermal_score
            * liquid_score
            * pressure_score
            * gravity_score
            * climate_stability)
            .clamp(0.0, 1.0),
    }
}

fn latitude_for_band(index: usize) -> f32 {
    let t = (index as f32 + 0.5) / LATITUDE_BANDS as f32;
    -std::f32::consts::FRAC_PI_2 + t * std::f32::consts::PI
}

/// Insolation factor for a latitude given an instantaneous subsolar
/// latitude (the tilt-modulated latitude at which the sun is overhead
/// for this seasonal sample). Mixes a cos(zenith) geometric term with
/// a meridional heat-transport floor so the dark hemisphere doesn't
/// drop to absolute zero in the coarse per-band model.
fn latitude_insolation_factor_with_subsolar(lat: f32, subsolar: f32) -> f32 {
    let cos_z = (lat - subsolar).cos().max(0.0);
    (0.74 + 0.44 * cos_z).clamp(0.74, 1.18)
}

/// Deterministic obliquity (axial tilt in radians) from the planet seed.
/// Distribution is biased toward modest tilts (most observed exoplanets
/// have Earth-like obliquity); a small tail reaches ~50° to represent
/// the rare Uranus-style outliers without pessimising the median case.
fn obliquity_for_seed(seed: u32) -> f32 {
    let mut s = seed.wrapping_mul(2_246_822_519).wrapping_add(0x9E3779B9);
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    let u = (s >> 8) as f32 / 16_777_216.0;
    // u^2.4 squeezes most of the mass to small tilts; max ~50°.
    (u.powf(2.4) * 50.0).to_radians()
}

fn base_albedo(body: BodyType) -> f32 {
    match body {
        BodyType::Frozen => 0.55,
        BodyType::Inferno => 0.18,
        BodyType::Rocky => 0.16,
        BodyType::SuperEarth => 0.27,
        BodyType::Terrestrial => 0.30,
        _ => 0.35,
    }
}

fn greenhouse_warming_k(planet: &Planet) -> f32 {
    let mass_factor = (planet.mass_earth / planet.radius_earth.max(0.1).powi(2)).clamp(0.2, 3.0);
    match planet.body_type {
        BodyType::Inferno => 85.0 * mass_factor.sqrt(),
        BodyType::Terrestrial => 33.0 * mass_factor.sqrt(),
        BodyType::SuperEarth => 34.0 * mass_factor.sqrt(),
        BodyType::Rocky => 5.0 * mass_factor.sqrt(),
        BodyType::Frozen => 8.0 * mass_factor.sqrt(),
        _ => 0.0,
    }
}

fn water_inventory(planet: &Planet) -> f32 {
    let thermal = smoothstep(180.0, 265.0, planet.temperature_k)
        * (1.0 - smoothstep(330.0, 430.0, planet.temperature_k));
    let class = match planet.body_type {
        BodyType::Terrestrial => 0.78,
        BodyType::SuperEarth => 0.62,
        BodyType::Rocky => 0.18,
        BodyType::Frozen => 0.45,
        BodyType::Inferno => 0.04,
        _ => 0.0,
    };
    (class * thermal).clamp(0.0, 1.0)
}

fn pressure_score(planet: &Planet) -> f32 {
    match planet.body_type {
        BodyType::Terrestrial | BodyType::SuperEarth => {
            smoothstep(0.35, 0.8, planet.mass_earth)
                * (1.0 - smoothstep(9.0, 14.0, planet.mass_earth))
        }
        BodyType::Rocky | BodyType::Frozen => smoothstep(0.45, 1.2, planet.mass_earth) * 0.55,
        BodyType::Inferno => 0.1,
        _ => 0.0,
    }
}

fn gravity_score(planet: &Planet) -> f32 {
    let gravity = planet.mass_earth / planet.radius_earth.max(0.1).powi(2);
    smoothstep(0.25, 0.7, gravity) * (1.0 - smoothstep(1.8, 3.0, gravity))
}

fn gaussian_score(value: f32, centre: f32, sigma: f32) -> f32 {
    let z = (value - centre) / sigma;
    (-0.5 * z * z).exp()
}

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::system::Planet;

    #[test]
    fn earthlike_planet_gets_nonzero_liquid_water_and_habitability() {
        let climate = estimate(&planet(BodyType::Terrestrial, 1.0, 1.0, 255.0));

        assert!(climate.mean_surface_temp_k > 275.0);
        assert!(climate.liquid_water_fraction > 0.2);
        assert!(climate.habitability > 0.35);
    }

    #[test]
    fn gas_giant_and_inferno_do_not_score_as_main_world_candidates() {
        assert_eq!(
            estimate(&planet(BodyType::GasGiant, 300.0, 11.0, 120.0)).habitability,
            0.0
        );
        assert!(estimate(&planet(BodyType::Inferno, 1.0, 1.0, 520.0)).habitability < 0.01);
    }

    fn planet(
        body_type: BodyType,
        mass_earth: f32,
        radius_earth: f32,
        temperature_k: f32,
    ) -> Planet {
        Planet {
            orbit_au: 1.0,
            eccentricity: 0.0,
            inclination_deg: 0.0,
            mass_earth,
            radius_earth,
            body_type,
            temperature_k,
            phase_rad: 0.0,
            day_seconds: 86_400.0,
            seed: 1,
            in_habitable_zone: true,
            moons: vec![],
            climate: ClimateSummary::dead(),
        }
    }
}
