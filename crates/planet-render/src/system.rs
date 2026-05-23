//! Physics-based solar system generator.
//!
//! Single source of truth for: what stars exist, what planets they host, where
//! those planets sit, and what they're made of. Used by the system-overview
//! render path to paint orbits + bodies; an individual planet's per-fragment
//! params for the detail render are derived from its `Planet` here too.
//!
//! References (no game tables, all observed-astrophysics):
//!   * Stellar IMF: Chabrier 2003 (PASP), Salpeter 1955.
//!   * Mass-luminosity / mass-radius main-sequence: Demircan & Kahraman 1991.
//!   * Blackbody → sRGB: Mitchell Charity tabulation, polynomial fit.
//!   * Habitable zone: Kopparapu et al. 2013 (ApJ 765:131), runaway-greenhouse
//!     inner and maximum-greenhouse outer flux limits.
//!   * Mass-radius for planets: Chen & Kipping 2017 (Forecaster, ApJ 834:17).
//!   * Period-ratio spacing: Pu & Wu 2015, Kepler dichotomy population; median
//!     ratio of adjacent-planet periods ≈ 1.5–2.
//!   * Planet equilibrium temperature: standard radiative balance, Bond
//!     albedo scaled by body class.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum SpectralClass {
    O,
    B,
    A,
    F,
    G,
    K,
    M,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Star {
    pub spectral: SpectralClass,
    pub mass_solar: f32,
    pub radius_solar: f32,
    pub luminosity_solar: f32,
    pub temperature_k: f32,
    pub color: [f32; 3],
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum BodyType {
    /// Mercury / inner-Mars class. Mostly rock, thin atmosphere or none.
    Rocky,
    /// Earth / Venus class. Substantial atmosphere, possible oceans.
    Terrestrial,
    /// 1.5-4 R⊕, mass-radius slope still rocky. Probably no thick H/He envelope.
    SuperEarth,
    /// 2-4 R⊕, hosts a thick H/He atmosphere. Often hot puffy planets.
    MiniNeptune,
    /// Neptune/Uranus class — ice giant with thick atmosphere.
    IceGiant,
    /// Jupiter/Saturn class — gas giant, H/He dominated.
    GasGiant,
    /// Tidally-locked / runaway-greenhouse rocky world inside the habitable zone.
    Inferno,
    /// Frozen rocky world beyond the outer habitable edge.
    Frozen,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Planet {
    pub orbit_au: f32,
    pub eccentricity: f32,
    pub inclination_deg: f32,
    pub mass_earth: f32,
    pub radius_earth: f32,
    pub body_type: BodyType,
    /// Equilibrium temperature for Bond albedo ≈ 0.3 (Earth-like).
    pub temperature_k: f32,
    /// Mean anomaly at t=0, radians.
    pub phase_rad: f32,
    /// Rotation period in seconds (mostly informational; render code defaults
    /// to its own auto-rotate).
    pub day_seconds: f32,
    /// Seed for the detail-render procedural surface.
    pub seed: u32,
    pub in_habitable_zone: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SolarSystem {
    pub seed: u32,
    pub star: Star,
    pub planets: Vec<Planet>,
    pub hz_inner_au: f32,
    pub hz_outer_au: f32,
    pub age_gyr: f32,
}

/// Tiny seeded LCG. Deterministic per `seed`; not a great RNG but fine for
/// procedural generation where we want byte-stable output across builds.
struct Rng {
    state: u64,
}

impl Rng {
    fn new(seed: u32) -> Self {
        let mut s = (seed as u64) ^ 0x9E3779B97F4A7C15;
        if s == 0 {
            s = 0xDEADBEEFCAFEBABE;
        }
        Self { state: s }
    }

    fn next_u32(&mut self) -> u32 {
        // SplitMix64 step — fast, good mixing, deterministic.
        self.state = self.state.wrapping_add(0x9E3779B97F4A7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
        ((z ^ (z >> 31)) >> 32) as u32
    }

    fn f01(&mut self) -> f32 {
        (self.next_u32() as f64 / u32::MAX as f64) as f32
    }

    fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + self.f01() * (hi - lo)
    }

    /// Normal-distribution sample via Box-Muller.
    fn normal(&mut self) -> f32 {
        let u1 = self.f01().max(1e-6);
        let u2 = self.f01();
        (-2.0_f32 * u1.ln()).sqrt() * (std::f32::consts::TAU * u2).cos()
    }
}

/// Sample a stellar mass from the Chabrier 2003 IMF approximated as: most
/// stars are M-dwarfs (~75 %), then K, G, F, A, B, O in decreasing fractions.
/// We pick a class by CDF and then perturb mass within the class.
pub fn sample_star(rng: &mut Rng) -> Star {
    let r = rng.f01();
    let (spectral, m_lo, m_hi) = if r < 0.0001 {
        (SpectralClass::O, 16.0, 90.0)
    } else if r < 0.0013 {
        (SpectralClass::B, 2.1, 16.0)
    } else if r < 0.0063 {
        (SpectralClass::A, 1.4, 2.1)
    } else if r < 0.0363 {
        (SpectralClass::F, 1.04, 1.4)
    } else if r < 0.1063 {
        (SpectralClass::G, 0.80, 1.04)
    } else if r < 0.2263 {
        (SpectralClass::K, 0.45, 0.80)
    } else {
        (SpectralClass::M, 0.08, 0.45)
    };
    let u = rng.f01();
    let mass = m_lo + u * (m_hi - m_lo);
    // Mass-luminosity for main sequence — segmented power law approximating
    // the L ∝ M^α relation across the HR diagram.
    let lum = if mass < 0.43 {
        0.23 * mass.powf(2.3)
    } else if mass < 2.0 {
        mass.powf(4.0)
    } else if mass < 20.0 {
        1.4 * mass.powf(3.5)
    } else {
        32000.0 * mass.powf(1.0)
    };
    // Demircan & Kahraman mass-radius (main sequence).
    let radius = if mass < 1.66 {
        1.06 * mass.powf(0.945)
    } else {
        1.33 * mass.powf(0.555)
    };
    // Stefan-Boltzmann: L = 4πR²σT⁴ → T = T⊙·(L/R²)^(1/4)
    let temp = 5778.0 * (lum / (radius * radius)).powf(0.25);
    let color = blackbody_color(temp);
    Star {
        spectral,
        mass_solar: mass,
        radius_solar: radius,
        luminosity_solar: lum,
        temperature_k: temp,
        color,
    }
}

/// Mitchell Charity tabulated blackbody → sRGB via a fast cubic fit. Returns
/// values mostly in [0, 1] but can exceed 1 for very bright blue stars.
fn blackbody_color(temp_k: f32) -> [f32; 3] {
    let t = (temp_k / 100.0).clamp(10.0, 400.0);
    // Approximation following Tanner Helland — segmented polynomial.
    let r = if t <= 66.0 {
        1.0
    } else {
        (329.698727446 * (t - 60.0).powf(-0.1332047592) / 255.0).clamp(0.0, 1.2)
    };
    let g = if t <= 66.0 {
        (99.4708025861 * t.ln() - 161.1195681661) / 255.0
    } else {
        288.1221695283 * (t - 60.0).powf(-0.0755148492) / 255.0
    }
    .clamp(0.0, 1.1);
    let b = if t >= 66.0 {
        1.0
    } else if t < 19.0 {
        0.0
    } else {
        (138.5177312231 * (t - 10.0).ln() - 305.0447927307) / 255.0
    }
    .clamp(0.0, 1.0);
    [r, g, b]
}

/// Kopparapu et al. 2013 conservative habitable-zone limits — runaway-greenhouse
/// inner edge and maximum-greenhouse outer edge — scaled by sqrt(L/L⊙).
pub fn habitable_zone(star: &Star) -> (f32, f32) {
    let l = star.luminosity_solar;
    let inner = (l / 1.107).sqrt();
    let outer = (l / 0.356).sqrt();
    (inner, outer)
}

/// Chen & Kipping 2017 piecewise mass-radius relation, simplified.
/// Mass in Earth masses → radius in Earth radii.
fn mass_to_radius_earth(mass_earth: f32) -> f32 {
    if mass_earth < 2.04 {
        // Terran world: R ∝ M^0.279
        1.008 * mass_earth.powf(0.279)
    } else if mass_earth < 132.0 {
        // Neptunian: R ∝ M^0.589
        0.808 * mass_earth.powf(0.589)
    } else if mass_earth < 26600.0 {
        // Jovian: R approximately constant, M^-0.044
        17.7 * mass_earth.powf(-0.044)
    } else {
        // Stellar object: R ∝ M^0.881
        0.00321 * mass_earth.powf(0.881)
    }
}

/// Planet equilibrium temperature for incident-flux radiative balance.
/// Bond albedo 0.3 for terrestrial worlds, scaled by body type.
fn equilibrium_temp_k(star: &Star, a_au: f32, albedo: f32) -> f32 {
    // T_eq = T⊙ · sqrt(R_star_solar / (2 a_au * AU_PER_R_SUN)) · (1 - A)^0.25
    // Simplified using L_star_solar: T_eq ≈ 278.5 K · L_solar^0.25 / sqrt(a_au) · (1-A)^0.25
    278.5 * star.luminosity_solar.powf(0.25) / a_au.sqrt() * (1.0 - albedo).powf(0.25)
}

/// Classify a planet by mass + orbital position + stellar context.
fn classify(mass_earth: f32, a_au: f32, hz: (f32, f32), star: &Star) -> BodyType {
    let inner_hot = a_au < hz.0 * 0.7;
    let outer_cold = a_au > hz.1 * 1.3;
    if mass_earth > 50.0 {
        BodyType::GasGiant
    } else if mass_earth > 10.0 {
        if outer_cold {
            BodyType::IceGiant
        } else {
            BodyType::MiniNeptune
        }
    } else if mass_earth > 2.0 {
        BodyType::SuperEarth
    } else if mass_earth > 0.4 {
        if inner_hot {
            BodyType::Inferno
        } else if outer_cold {
            BodyType::Frozen
        } else {
            // Inside HZ a 1 M⊕ world might be Earth-class; outside but close,
            // still terrestrial.
            let _ = star;
            BodyType::Terrestrial
        }
    } else if mass_earth > 0.02 {
        if outer_cold {
            BodyType::Frozen
        } else {
            BodyType::Rocky
        }
    } else {
        // Asteroid-mass body — bin as Rocky for now.
        BodyType::Rocky
    }
}

/// Generate a system. The number of planets, their orbital spacing and mass
/// distribution follow observed exoplanet statistics rather than game tables.
pub fn generate(seed: u32) -> SolarSystem {
    let mut rng = Rng::new(seed);
    let star = sample_star(&mut rng);
    let hz = habitable_zone(&star);

    // Number of planets — observed Kepler statistics show median ~3 detected,
    // but ~5–8 actual after completeness correction. Bias slightly higher
    // here so each system feels populated.
    let n_planets = 4 + (rng.f01() * 5.0).floor() as usize;

    // Inner edge of planetary system. Real systems have inner planets at
    // 0.02–0.1 AU (hot rocky / hot Jupiter regimes); some start further out.
    let mut a = 0.04 + rng.f01().powi(2) * 0.30;

    let mut planets = Vec::with_capacity(n_planets);
    for _ in 0..n_planets {
        // Period ratio (P_{i+1} / P_i) drawn from observed distribution:
        // mean ≈ 1.9, σ ≈ 0.5 (Pu & Wu 2015), clamped to dynamical stability.
        let period_ratio = (1.6 + rng.normal() * 0.45).clamp(1.30, 4.0);
        // Kepler 3rd: a ∝ P^(2/3).
        let a_ratio = period_ratio.powf(2.0 / 3.0);

        // Mass distribution from observed exoplanet population: log-uniform
        // over rocky (0.05–10 M⊕) and giant (10–3000 M⊕) regimes, biased
        // toward smaller planets (Kepler dichotomy).
        let log_mass = if rng.f01() < 0.78 {
            // Rocky / sub-Neptune dominated regime.
            rng.range(-1.7, 1.4)
        } else {
            // Gas-giant tail.
            rng.range(1.4, 3.4)
        };
        let mut mass_earth = 10.0_f32.powf(log_mass);

        // Suppress hot Jupiters (a < 0.1 AU + giant mass) to be rarer than
        // the bare distribution — observed rate ~1 % of stars.
        if a < 0.1 && mass_earth > 50.0 && rng.f01() > 0.05 {
            mass_earth = rng.range(0.5, 8.0);
        }

        let radius_earth = mass_to_radius_earth(mass_earth);
        let body_type = classify(mass_earth, a, hz, &star);
        // Body-class-specific Bond albedo (rough averages).
        let albedo = match body_type {
            BodyType::Frozen => 0.55,
            BodyType::IceGiant => 0.30,
            BodyType::GasGiant => 0.34,
            BodyType::MiniNeptune => 0.30,
            BodyType::Terrestrial => 0.30,
            BodyType::SuperEarth => 0.25,
            BodyType::Inferno => 0.10,
            BodyType::Rocky => 0.12,
        };
        let temp = equilibrium_temp_k(&star, a, albedo);
        let in_hz = a >= hz.0 && a <= hz.1;

        planets.push(Planet {
            orbit_au: a,
            eccentricity: rng.f01().powi(3) * 0.25,
            inclination_deg: rng.normal() * 2.5,
            mass_earth,
            radius_earth,
            body_type,
            temperature_k: temp,
            phase_rad: rng.f01() * std::f32::consts::TAU,
            day_seconds: 8.0 * 3600.0 + rng.f01() * 60.0 * 3600.0,
            seed: rng.next_u32(),
            in_habitable_zone: in_hz,
        });

        a *= a_ratio;
        // Stop placing planets beyond ~80 AU — outer system would just be
        // KBOs / dwarf planets, not visually interesting at the system scale.
        if a > 80.0 {
            break;
        }
    }

    SolarSystem {
        seed,
        star,
        planets,
        hz_inner_au: hz.0,
        hz_outer_au: hz.1,
        age_gyr: rng.range(0.5, 10.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solar_analog_lands_close_to_sol() {
        // Stuff the RNG until we get a G-class star — verify the resulting
        // physics are self-consistent.
        for seed in 0u32..1000 {
            let sys = generate(seed);
            if matches!(sys.star.spectral, SpectralClass::G) {
                assert!(sys.star.mass_solar > 0.5 && sys.star.mass_solar < 1.5);
                assert!(sys.star.luminosity_solar > 0.1 && sys.star.luminosity_solar < 5.0);
                // Earth-like HZ should sit around 1 AU for G stars.
                assert!(sys.hz_inner_au > 0.5 && sys.hz_inner_au < 1.5);
                assert!(sys.hz_outer_au > 1.0 && sys.hz_outer_au < 3.5);
                return;
            }
        }
        panic!("no G-class star in 1000 seeds");
    }

    #[test]
    fn period_spacing_is_dynamically_stable() {
        // Adjacent planet period ratios should never fall below ~1.3
        // (Hill-stability rule of thumb).
        for seed in 0u32..50 {
            let sys = generate(seed);
            for w in sys.planets.windows(2) {
                let p_ratio = (w[1].orbit_au / w[0].orbit_au).powf(1.5);
                assert!(
                    p_ratio >= 1.29,
                    "seed {seed}: period ratio {p_ratio} between {} and {} AU",
                    w[0].orbit_au,
                    w[1].orbit_au
                );
            }
        }
    }
}
