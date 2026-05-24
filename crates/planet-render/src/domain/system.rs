//! Physics-based solar system generator.
//!
//! Two-layer model. The *structure* — how orbits are slotted around the
//! star, where gas giants land, where asteroid belts form, how many moons
//! a body has — borrows the schematic patterns from legacy 2d6's survey rules
//! "Scouts" world generation rules (Bode-like orbit indexing, gas-giant
//! count by zone, satellite tables) which line up well with real solar
//! systems. The *physics* — stellar parameters, habitable zone, planet
//! mass→radius, equilibrium temperature — uses modern observed astrophysics.
//!
//! References:
//!   * Stellar IMF: Chabrier 2003 (PASP). We deliberately *bias* sampling
//!     away from pure IMF (which is ~75 % M-dwarfs) and toward F/G/K so
//!     each randomly-generated system reads as visually interesting and
//!     has at least some prospect of a habitable world.
//!   * Mass-luminosity / mass-radius main-sequence: Demircan & Kahraman 1991.
//!   * Habitable zone: Kopparapu et al. 2013 (ApJ 765:131), runaway-greenhouse
//!     inner and maximum-greenhouse outer flux limits.
//!   * Snow line: Hayashi 1981 / Lecar 2006 — T_eq < 170 K, scales with √L⊙.
//!   * Planet mass-radius: Chen & Kipping 2017 (Forecaster, ApJ 834:17).
//!   * Bode-like orbit positions: Blagg 1913, MacDonald 1996, Lynch 2003 —
//!     real planetary systems show consistent ~1.4–1.7 period ratios.
//!   * Moon count by body class: observed solar-system statistics
//!     (gas giants 60+, ice giants 14-27, terrestrials 0-2).

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
    Rocky,
    Terrestrial,
    SuperEarth,
    MiniNeptune,
    IceGiant,
    GasGiant,
    Inferno,
    Frozen,
}

impl BodyType {
    /// Numeric ID passed to the system shader; order must match the
    /// BT_* constants in `shaders/system.wgsl`.
    pub fn as_shader_id(self) -> f32 {
        match self {
            BodyType::Rocky => 0.0,
            BodyType::Terrestrial => 1.0,
            BodyType::SuperEarth => 2.0,
            BodyType::MiniNeptune => 3.0,
            BodyType::IceGiant => 4.0,
            BodyType::GasGiant => 5.0,
            BodyType::Inferno => 6.0,
            BodyType::Frozen => 7.0,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Moon {
    /// Orbit radius in planet radii. Larger gas giants have moons out to 100+ R.
    pub orbit_radii: f32,
    /// Radius in Earth-radii units (typically 0.1 – 0.4).
    pub radius_earth: f32,
    pub phase_rad: f32,
    /// True = icy/bright surface; false = rocky/dark.
    pub icy: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Planet {
    pub orbit_au: f32,
    pub eccentricity: f32,
    pub inclination_deg: f32,
    pub mass_earth: f32,
    pub radius_earth: f32,
    pub body_type: BodyType,
    pub temperature_k: f32,
    pub phase_rad: f32,
    pub day_seconds: f32,
    pub seed: u32,
    pub in_habitable_zone: bool,
    pub moons: Vec<Moon>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AsteroidBelt {
    pub inner_au: f32,
    pub outer_au: f32,
    /// Visual density modulation [0, 1].
    pub density: f32,
}

/// Companion star in a binary/multi system. Real observed binary fraction is
/// ~50 % for solar-type stars; we generate one ~40 % of the time so single
/// systems remain common.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Companion {
    pub star: Star,
    /// Mean separation from the primary in AU.
    pub separation_au: f32,
    /// Initial orbital phase (radians) — the companion sweeps around the
    /// common centre of mass at Kepler-3rd rate.
    pub phase_rad: f32,
    /// Inclination of the binary orbital plane from the planetary plane
    /// (degrees). Most observed binaries are roughly co-planar, so we keep
    /// this small.
    pub inclination_deg: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SolarSystem {
    pub seed: u32,
    pub star: Star,
    pub companion: Option<Companion>,
    pub planets: Vec<Planet>,
    pub belts: Vec<AsteroidBelt>,
    pub hz_inner_au: f32,
    pub hz_outer_au: f32,
    pub snow_line_au: f32,
    /// Index into `planets` of the most habitable body, or -1 if none qualify.
    pub main_world: i32,
    pub age_gyr: f32,
}

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

    fn roll_d6(&mut self, n: usize) -> i32 {
        let mut s = 0;
        for _ in 0..n {
            s += 1 + (self.f01() * 6.0).floor() as i32;
        }
        s
    }

    fn normal(&mut self) -> f32 {
        let u1 = self.f01().max(1e-6);
        let u2 = self.f01();
        (-2.0_f32 * u1.ln()).sqrt() * (std::f32::consts::TAU * u2).cos()
    }
}

/// Star sampling. Pure IMF would give ~75 % M-dwarfs and ~0.04 % G-stars,
/// which makes most randomly-generated systems visually identical small
/// red ones. Bias toward G/K/F so each system feels distinct.
fn sample_star(rng: &mut Rng) -> Star {
    let r = rng.f01();
    let (spectral, m_lo, m_hi) = if r < 0.005 {
        (SpectralClass::O, 16.0, 60.0)
    } else if r < 0.04 {
        (SpectralClass::B, 2.1, 16.0)
    } else if r < 0.13 {
        (SpectralClass::A, 1.4, 2.1)
    } else if r < 0.30 {
        (SpectralClass::F, 1.04, 1.4)
    } else if r < 0.55 {
        (SpectralClass::G, 0.80, 1.04)
    } else if r < 0.85 {
        (SpectralClass::K, 0.45, 0.80)
    } else {
        (SpectralClass::M, 0.10, 0.45)
    };
    let u = rng.f01();
    let mass = m_lo + u * (m_hi - m_lo);
    let lum = if mass < 0.43 {
        0.23 * mass.powf(2.3)
    } else if mass < 2.0 {
        mass.powf(4.0)
    } else if mass < 20.0 {
        1.4 * mass.powf(3.5)
    } else {
        32000.0 * mass.powf(1.0)
    };
    let radius = if mass < 1.66 {
        1.06 * mass.powf(0.945)
    } else {
        1.33 * mass.powf(0.555)
    };
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

fn blackbody_color(temp_k: f32) -> [f32; 3] {
    let t = (temp_k / 100.0).clamp(10.0, 400.0);
    let r = if t <= 66.0 {
        1.0
    } else {
        (329.698_73 * (t - 60.0).powf(-0.133_204_76) / 255.0).clamp(0.0, 1.2)
    };
    let g = if t <= 66.0 {
        (99.470_8 * t.ln() - 161.119_57) / 255.0
    } else {
        288.122_16 * (t - 60.0).powf(-0.075_514_846) / 255.0
    }
    .clamp(0.0, 1.1);
    let b = if t >= 66.0 {
        1.0
    } else if t < 19.0 {
        0.0
    } else {
        (138.517_73 * (t - 10.0).ln() - 305.044_8) / 255.0
    }
    .clamp(0.0, 1.0);
    [r, g, b]
}

pub fn habitable_zone(star: &Star) -> (f32, f32) {
    let l = star.luminosity_solar;
    let inner = (l / 1.107).sqrt();
    let outer = (l / 0.356).sqrt();
    (inner, outer)
}

/// Snow line — orbital distance at which water ice can condense in the
/// proto-planetary disc, T_eq < ~170 K. Gas giants form here and outward
/// because their cores accrete from ice + rock rather than rock alone.
pub fn snow_line(star: &Star) -> f32 {
    // T_eq ∝ L^¼ / √a, so T_eq = 170 K at a = (T_sun/170)² × √(L⊙) ≈ 2.7 √L⊙.
    2.7 * star.luminosity_solar.sqrt()
}

fn mass_to_radius_earth(mass_earth: f32) -> f32 {
    if mass_earth < 2.04 {
        1.008 * mass_earth.powf(0.279)
    } else if mass_earth < 132.0 {
        0.808 * mass_earth.powf(0.589)
    } else if mass_earth < 26600.0 {
        17.7 * mass_earth.powf(-0.044)
    } else {
        0.00321 * mass_earth.powf(0.881)
    }
}

fn equilibrium_temp_k(star: &Star, a_au: f32, albedo: f32) -> f32 {
    278.5 * star.luminosity_solar.powf(0.25) / a_au.sqrt() * (1.0 - albedo).powf(0.25)
}

/// Bond albedo for each body class. Used for T_eq calculation.
fn body_albedo(body: BodyType) -> f32 {
    match body {
        BodyType::Frozen => 0.55,
        BodyType::IceGiant => 0.30,
        BodyType::GasGiant => 0.34,
        BodyType::MiniNeptune => 0.30,
        BodyType::Terrestrial => 0.30,
        BodyType::SuperEarth => 0.25,
        BodyType::Inferno => 0.10,
        BodyType::Rocky => 0.12,
    }
}

/// Classify a body candidate from mass + orbital context.
fn classify(mass_earth: f32, a_au: f32, hz: (f32, f32), snow: f32) -> BodyType {
    let inner_hot = a_au < hz.0 * 0.7;
    let outer_cold = a_au > snow * 1.4;
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
            BodyType::Terrestrial
        }
    } else if outer_cold {
        BodyType::Frozen
    } else {
        BodyType::Rocky
    }
}

/// Score each placed planet for "habitability" — used to pick the main world.
/// In-HZ Earth-scale terrestrials win; gas giants and frozen worlds lose.
fn habitability_score(p: &Planet) -> f32 {
    if !p.in_habitable_zone {
        return 0.0;
    }
    let class_score = match p.body_type {
        BodyType::Terrestrial => 1.0,
        BodyType::SuperEarth => 0.7,
        BodyType::Rocky => 0.4,
        _ => 0.0,
    };
    // Earth-mass peak.
    let mass_score = 1.0 - ((p.mass_earth - 1.0).abs() / 5.0).min(1.0);
    class_score * (0.5 + 0.5 * mass_score)
}

/// Per-body-class moon count, sampled to vaguely match Solar System values
/// (Saturn 146, Jupiter 95, Uranus 28, Neptune 16, Earth 1, Mars 2, Venus 0).
/// Capped well below true counts because system view can only fit so many.
fn moon_count_for(rng: &mut Rng, body: BodyType) -> usize {
    match body {
        BodyType::GasGiant => (rng.roll_d6(2) - 1).clamp(0, 11) as usize,
        BodyType::IceGiant => (rng.roll_d6(2) - 3).clamp(0, 9) as usize,
        BodyType::MiniNeptune => (rng.roll_d6(1) - 2).clamp(0, 4) as usize,
        BodyType::SuperEarth => (rng.roll_d6(1) - 4).clamp(0, 2) as usize,
        BodyType::Terrestrial => (rng.roll_d6(1) - 4).clamp(0, 2) as usize,
        BodyType::Frozen => (rng.roll_d6(1) - 5).clamp(0, 1) as usize,
        BodyType::Rocky => (rng.roll_d6(1) - 5).clamp(0, 1) as usize,
        BodyType::Inferno => 0,
    }
}

fn generate_moons(rng: &mut Rng, planet: &Planet) -> Vec<Moon> {
    let n = moon_count_for(rng, planet.body_type);
    let mut moons = Vec::with_capacity(n);
    // Innermost stable orbit ~2.5 planet radii (Roche limit-ish), outermost
    // ~150 R for gas giants, less for smaller bodies.
    let (r_min, r_max) = match planet.body_type {
        BodyType::GasGiant => (2.5_f32, 180.0_f32),
        BodyType::IceGiant => (2.5, 120.0),
        BodyType::MiniNeptune => (2.0, 50.0),
        _ => (2.0, 30.0),
    };
    // Cold outer planets in the system get icy moons by default; warm planets
    // get rocky. (Realistic for water-ice condensation distance.)
    let icy_dominant = planet.temperature_k < 200.0;
    for _ in 0..n {
        // Log-spaced placement so we get both close inner moons and far outer
        // ones without piling up at the inner edge.
        let t = rng.f01();
        let r = r_min * (r_max / r_min).powf(t);
        let radius = match planet.body_type {
            BodyType::GasGiant | BodyType::IceGiant => rng.range(0.10, 0.40),
            _ => rng.range(0.05, 0.25),
        };
        let icy = if icy_dominant {
            rng.f01() > 0.15
        } else {
            rng.f01() > 0.55
        };
        moons.push(Moon {
            orbit_radii: r,
            radius_earth: radius,
            phase_rad: rng.f01() * std::f32::consts::TAU,
            icy,
        });
    }
    // Sort by orbit so they stay visually ordered.
    moons.sort_by(|a, b| a.orbit_radii.partial_cmp(&b.orbit_radii).unwrap());
    moons
}

/// Build a Bode-like sequence of candidate orbit positions. We start near
/// the inner edge (hot terrestrials live at ~0.1–0.4 AU) and step out
/// geometrically with a period-ratio that varies slightly per slot.
fn bode_orbits(rng: &mut Rng, star: &Star) -> Vec<f32> {
    let mut out = Vec::with_capacity(14);
    let mut a = (0.04 + rng.f01().powi(2) * 0.20) * star.mass_solar.powf(0.5);
    while a < 80.0 {
        out.push(a);
        // Period ratio mean 1.85, σ 0.35 — Pu & Wu, clamped to Hill stability.
        let pr = (1.85 + rng.normal() * 0.35).clamp(1.35, 3.5);
        let ar = pr.powf(2.0 / 3.0);
        a *= ar;
    }
    out
}

/// Roll for what goes in each Bode orbit slot. Outputs `OrbitContent` per
/// slot — Empty, Planet (with target mass), GasGiant, MiniNeptune (in-HZ
/// sub-Neptune), or Belt.
#[derive(Clone, Copy, Debug)]
enum OrbitContent {
    Empty,
    Planet(f32), // log10 mass in Earth masses
    GasGiant,
    MiniNeptune,
    Belt,
}

/// Architecture-aware orbit content roll. Probabilities tuned to observed
/// exoplanet population statistics rather than first-pass intuition.
///
/// Key real-world numbers we hit:
///   * Hot Jupiters (gas giant at a < 0.1 AU) — only ~1 % of stars; previous
///     pass had 12 % which was wildly wrong.
///   * Cold giants (Jupiter-class at >1 AU) — ~10–15 % of FGK stars.
///   * Most stars host 1+ planet; the *median* completeness-corrected count
///     is around 5–8 per star.
///   * Inner systems (a < ~2 AU on G-stars) are heavily rocky-dominated;
///     gas giants almost exclusively form at or beyond the snow line.
///   * M-dwarf systems are typically packed with terrestrials in tight
///     orbits (TRAPPIST-1 style), no gas giants.
///   * Asteroid belts tend to land just *interior* to a gas giant — the
///     Kirkwood-gap analog where the giant's mean-motion resonances clear
///     out planet formation.
///
/// `prev_was_giant` lets us bias the belt placement toward the orbit
/// immediately interior to a recently-placed gas giant.
fn roll_orbit_content(
    rng: &mut Rng,
    a_au: f32,
    hz: (f32, f32),
    snow: f32,
    star: &Star,
    prev_was_giant: bool,
) -> OrbitContent {
    let inner_hot = a_au < hz.0 * 0.5;
    let in_hz = a_au >= hz.0 && a_au <= hz.1;
    let pre_snow = a_au > hz.1 && a_au < snow * 0.8;
    let near_snow = a_au >= snow * 0.8 && a_au <= snow * 2.2;
    let far_outer = a_au > snow * 2.2;

    let m_dwarf = matches!(star.spectral, SpectralClass::M);

    let r = rng.f01();

    if inner_hot {
        // Inner-hot orbits. Most systems have 1–3 inner planets, not 5 — so
        // ~35 % empty here (some short-period slots never accreted), ~1 %
        // hot Jupiter, rest rocky/inferno.
        if r < 0.35 {
            return OrbitContent::Empty;
        }
        if r < 0.36 {
            return OrbitContent::GasGiant;
        }
        return OrbitContent::Planet(rng.range(-1.7, 0.5));
    }

    if in_hz {
        // HZ — terrestrial-heavy. For habitable systems we *want* a planet here.
        if r < 0.05 {
            return OrbitContent::Empty;
        }
        if r < 0.08 && !m_dwarf {
            return OrbitContent::Belt;
        }
        // Slight gas-giant chance only on F/G stars where snow line might dip
        // close (e.g. fainter G); never on M-dwarfs in HZ.
        if r < 0.10 && matches!(star.spectral, SpectralClass::F | SpectralClass::G) {
            return OrbitContent::MiniNeptune;
        }
        // Otherwise: terrestrial-mass distribution centred near Earth.
        return OrbitContent::Planet(rng.range(-0.7, 0.9));
    }

    if pre_snow {
        // The "Mars / asteroid-belt" gap. Strong belt preference if the next
        // outer feature is a gas giant — this is the Kirkwood-gap analog
        // where mean-motion resonance with the giant clears the orbit.
        if r < 0.40 {
            return OrbitContent::Belt;
        }
        if r < 0.55 {
            return OrbitContent::Empty;
        }
        return OrbitContent::Planet(rng.range(-1.0, 1.0));
    }

    if near_snow {
        // Snow line — gas giant formation peak. M-dwarfs almost never have
        // giants (low disc mass + UV stripping); F/G/K get them ~15 % of the
        // time per orbit slot in this zone.
        if m_dwarf {
            if r < 0.30 {
                return OrbitContent::Empty;
            }
            if r < 0.40 {
                return OrbitContent::Belt;
            }
            return OrbitContent::Planet(rng.range(-0.8, 0.8));
        }
        if r < 0.18 {
            return OrbitContent::GasGiant;
        }
        if r < 0.30 && prev_was_giant {
            return OrbitContent::Belt;
        }
        if r < 0.45 {
            return OrbitContent::Empty;
        }
        return OrbitContent::Planet(rng.range(-0.3, 1.5));
    }

    if far_outer {
        // Outer — sparse. Most far orbits are empty (Sol's beyond-Jupiter
        // region is Saturn, Uranus, Neptune and that's it, despite many
        // possible Bode slots out there).
        if m_dwarf {
            if r < 0.92 {
                return OrbitContent::Empty;
            }
            return OrbitContent::Planet(rng.range(-1.5, 0.2));
        }
        if r < 0.08 {
            return OrbitContent::GasGiant;
        }
        if r < 0.75 {
            return OrbitContent::Empty;
        }
        return OrbitContent::Planet(rng.range(-1.5, 1.0));
    }

    OrbitContent::Empty
}

/// Roll for a binary companion. Real observed binary fraction:
///   O-class      ~70 %
///   G-class      ~44 %
///   M-class      ~25 %
/// We use roughly these rates so binaries feel correctly rare on red-dwarfs
/// and common on bright stars.
fn sample_companion(rng: &mut Rng, primary: &Star) -> Option<Companion> {
    let p_binary = match primary.spectral {
        SpectralClass::O | SpectralClass::B => 0.65,
        SpectralClass::A | SpectralClass::F => 0.50,
        SpectralClass::G => 0.42,
        SpectralClass::K => 0.36,
        SpectralClass::M => 0.25,
    };
    if rng.f01() > p_binary {
        return None;
    }
    // Companion mass distributed as a fraction of the primary (mass-ratio
    // distribution observed roughly flat between 0.2 and 1.0 for solar-types).
    let q = rng.range(0.2, 1.0);
    let comp_mass = primary.mass_solar * q;
    // Derive companion stellar parameters from this mass.
    let lum = if comp_mass < 0.43 {
        0.23 * comp_mass.powf(2.3)
    } else if comp_mass < 2.0 {
        comp_mass.powf(4.0)
    } else if comp_mass < 20.0 {
        1.4 * comp_mass.powf(3.5)
    } else {
        32000.0 * comp_mass.powf(1.0)
    };
    let radius = if comp_mass < 1.66 {
        1.06 * comp_mass.powf(0.945)
    } else {
        1.33 * comp_mass.powf(0.555)
    };
    let temp = 5778.0 * (lum / (radius * radius)).powf(0.25);
    let comp_spectral = if comp_mass > 16.0 {
        SpectralClass::O
    } else if comp_mass > 2.1 {
        SpectralClass::B
    } else if comp_mass > 1.4 {
        SpectralClass::A
    } else if comp_mass > 1.04 {
        SpectralClass::F
    } else if comp_mass > 0.80 {
        SpectralClass::G
    } else if comp_mass > 0.45 {
        SpectralClass::K
    } else {
        SpectralClass::M
    };
    let comp_star = Star {
        spectral: comp_spectral,
        mass_solar: comp_mass,
        radius_solar: radius,
        luminosity_solar: lum,
        temperature_k: temp,
        color: blackbody_color(temp),
    };
    // Separation distribution: log-uniform from 5 to 100 AU (typical wide
    // binaries; close binaries <1 AU make planet hosting unstable).
    let separation_au = 10.0_f32.powf(rng.range(0.7, 2.0));
    Some(Companion {
        star: comp_star,
        separation_au,
        phase_rad: rng.f01() * std::f32::consts::TAU,
        inclination_deg: rng.normal() * 8.0,
    })
}

pub fn generate(seed: u32) -> SolarSystem {
    let mut rng = Rng::new(seed);
    let star = sample_star(&mut rng);
    let companion = sample_companion(&mut rng, &star);
    let hz = habitable_zone(&star);
    let snow = snow_line(&star);

    let orbits = bode_orbits(&mut rng, &star);
    let mut planets = Vec::new();
    let mut belts = Vec::new();

    let mut prev_was_giant = false;
    // Cap total planets at 9 — typical solar-system scale, matches the count
    // most exoplanet papers analyse (Sol has 8, Kepler-90 has 8, no confirmed
    // system has >10). Beyond ~9 the system view also gets visually crowded.
    const MAX_PLANETS_PER_SYSTEM: usize = 9;

    for &a in &orbits {
        if planets.len() >= MAX_PLANETS_PER_SYSTEM {
            break;
        }
        match roll_orbit_content(&mut rng, a, hz, snow, &star, prev_was_giant) {
            OrbitContent::Empty => {
                prev_was_giant = false;
            }
            OrbitContent::Belt => {
                let half_width = rng.range(0.05, 0.15) * a;
                belts.push(AsteroidBelt {
                    inner_au: (a - half_width).max(0.01),
                    outer_au: a + half_width,
                    density: rng.range(0.5, 1.0),
                });
                prev_was_giant = false;
            }
            OrbitContent::GasGiant => {
                // Gas giant masses range Saturn (95 M⊕) → super-Jupiter (~10 M_jup).
                let mass = 10.0_f32.powf(rng.range(1.7, 3.4));
                let radius = mass_to_radius_earth(mass);
                let body = if a > snow * 1.5 && mass < 300.0 {
                    BodyType::IceGiant
                } else {
                    BodyType::GasGiant
                };
                let temp = equilibrium_temp_k(&star, a, body_albedo(body));
                let mut planet = Planet {
                    orbit_au: a,
                    eccentricity: rng.f01().powi(3) * 0.20,
                    inclination_deg: rng.normal() * 1.5,
                    mass_earth: mass,
                    radius_earth: radius,
                    body_type: body,
                    temperature_k: temp,
                    phase_rad: rng.f01() * std::f32::consts::TAU,
                    day_seconds: rng.range(8.0, 30.0) * 3600.0,
                    seed: rng.next_u32(),
                    in_habitable_zone: a >= hz.0 && a <= hz.1,
                    moons: Vec::new(),
                };
                planet.moons = generate_moons(&mut rng, &planet);
                planets.push(planet);
                prev_was_giant = true;
            }
            OrbitContent::MiniNeptune => {
                let mass = 10.0_f32.powf(rng.range(0.8, 1.4));
                let radius = mass_to_radius_earth(mass);
                let body = BodyType::MiniNeptune;
                let temp = equilibrium_temp_k(&star, a, body_albedo(body));
                let mut planet = Planet {
                    orbit_au: a,
                    eccentricity: rng.f01().powi(3) * 0.20,
                    inclination_deg: rng.normal() * 2.0,
                    mass_earth: mass,
                    radius_earth: radius,
                    body_type: body,
                    temperature_k: temp,
                    phase_rad: rng.f01() * std::f32::consts::TAU,
                    day_seconds: rng.range(8.0, 60.0) * 3600.0,
                    seed: rng.next_u32(),
                    in_habitable_zone: a >= hz.0 && a <= hz.1,
                    moons: Vec::new(),
                };
                planet.moons = generate_moons(&mut rng, &planet);
                planets.push(planet);
                prev_was_giant = false;
            }
            OrbitContent::Planet(log_mass) => {
                let mass = 10.0_f32.powf(log_mass);
                let radius = mass_to_radius_earth(mass);
                let body = classify(mass, a, hz, snow);
                let temp = equilibrium_temp_k(&star, a, body_albedo(body));
                let mut planet = Planet {
                    orbit_au: a,
                    eccentricity: rng.f01().powi(3) * 0.25,
                    inclination_deg: rng.normal() * 2.5,
                    mass_earth: mass,
                    radius_earth: radius,
                    body_type: body,
                    temperature_k: temp,
                    phase_rad: rng.f01() * std::f32::consts::TAU,
                    day_seconds: rng.range(8.0, 60.0) * 3600.0,
                    seed: rng.next_u32(),
                    in_habitable_zone: a >= hz.0 && a <= hz.1,
                    moons: Vec::new(),
                };
                planet.moons = generate_moons(&mut rng, &planet);
                planets.push(planet);
                prev_was_giant = false;
            }
        }
    }

    // Identify the main world: highest habitability score, or -1 if none in HZ.
    let main_world = planets
        .iter()
        .enumerate()
        .map(|(i, p)| (i, habitability_score(p)))
        .filter(|(_, s)| *s > 0.0)
        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap())
        .map(|(i, _)| i as i32)
        .unwrap_or(-1);

    SolarSystem {
        seed,
        star,
        companion,
        planets,
        belts,
        hz_inner_au: hz.0,
        hz_outer_au: hz.1,
        snow_line_au: snow,
        main_world,
        age_gyr: rng.range(0.5, 10.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solar_analog_lands_close_to_sol() {
        for seed in 0u32..1000 {
            let sys = generate(seed);
            if matches!(sys.star.spectral, SpectralClass::G) {
                assert!(sys.star.mass_solar > 0.5 && sys.star.mass_solar < 1.5);
                assert!(sys.star.luminosity_solar > 0.1 && sys.star.luminosity_solar < 5.0);
                assert!(sys.hz_inner_au > 0.5 && sys.hz_inner_au < 1.5);
                assert!(sys.hz_outer_au > 1.0 && sys.hz_outer_au < 3.5);
                return;
            }
        }
        panic!("no G-class star in 1000 seeds");
    }

    #[test]
    fn period_spacing_is_dynamically_stable() {
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

    #[test]
    fn gas_giants_form_near_or_beyond_snow_line() {
        // Across many systems, gas giants should overwhelmingly be at or
        // beyond the snow line (where ice can condense in the disc).
        let mut close = 0;
        let mut far = 0;
        for seed in 0u32..200 {
            let sys = generate(seed);
            for p in &sys.planets {
                if matches!(p.body_type, BodyType::GasGiant | BodyType::IceGiant) {
                    if p.orbit_au < sys.snow_line_au * 0.7 {
                        close += 1;
                    } else {
                        far += 1;
                    }
                }
            }
        }
        // Hot Jupiters should be a tiny minority (<10 %).
        assert!(far > close * 9, "close={close} far={far}");
    }

    #[test]
    fn planet_count_within_observed_range() {
        // Observed exoplanet systems have 1–8 detected planets; we cap at 9
        // and bias toward 4–7 to match completeness-corrected statistics.
        let mut counts = vec![];
        for seed in 0u32..200 {
            let sys = generate(seed);
            counts.push(sys.planets.len());
        }
        let mean: f32 = counts.iter().map(|&c| c as f32).sum::<f32>() / counts.len() as f32;
        assert!(
            (2.0..=8.0).contains(&mean),
            "mean planet count {mean} outside observed range"
        );
        for c in &counts {
            assert!(*c <= 9, "planet count {c} exceeds cap");
        }
    }

    #[test]
    fn gas_giants_get_more_moons_than_terrestrials() {
        let mut gg_moons = 0;
        let mut gg_count = 0;
        let mut tr_moons = 0;
        let mut tr_count = 0;
        for seed in 0u32..200 {
            let sys = generate(seed);
            for p in &sys.planets {
                if matches!(p.body_type, BodyType::GasGiant | BodyType::IceGiant) {
                    gg_moons += p.moons.len();
                    gg_count += 1;
                } else if matches!(p.body_type, BodyType::Terrestrial | BodyType::SuperEarth) {
                    tr_moons += p.moons.len();
                    tr_count += 1;
                }
            }
        }
        if gg_count > 0 && tr_count > 0 {
            let gg_avg = gg_moons as f32 / gg_count as f32;
            let tr_avg = tr_moons as f32 / tr_count as f32;
            assert!(gg_avg > tr_avg * 2.0, "gg_avg={gg_avg} tr_avg={tr_avg}");
        }
    }
}
