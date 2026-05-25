//! Cepheus Engine subsector generator.
//!
//! A local campaign strip is two adjacent Cepheus subsectors: a 16-column ×
//! 10-row hex grid of star systems. Each occupied hex carries its main world's
//! UWP, bases, trade-zone, and presence flags (gas giant, asteroid belt) so
//! the SVG map can render without re-running system generation.
//!
//! Determinism: a per-hex sub-seed is derived from
//! `hash(subsector_seed, col, row)` so any single hex can be regenerated
//! without disturbing its neighbours.
//!
//! Lazy generation: phase 1 generates the *full* `SolarSystem` per
//! occupied hex once so we can extract main-world climate and presence
//! flags. The hex stores only the projected summary; the user fetches
//! the full system on demand by selecting a hex (Phase 3).
//!
//! Reference: <https://www.orffenspace.com/cepheus-srd/book3/worlds.html>

// Several inherent helpers (Uwp::to_code, HexCoord::label, Subsector::hex_at,
// the `digit` formatter) are exercised only by unit tests and the JS layer
// observing the serde JSON. The wasm build doesn't reach them through Rust,
// so clippy's dead-code lint flags them. They're part of the module's public
// API surface for tests and would otherwise grow back the moment we add a
// JS-facing accessor, so allow rather than delete them.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};

use super::system::{self, BodyType, SolarSystem};

/// Local map grid extents. One classic subsector is 8 columns × 10 rows; the
/// app shows two side by side so the first screen has useful travel context.
pub const SUBSECTOR_COLS: u8 = 16;
pub const SUBSECTOR_ROWS: u8 = 10;
pub const CLASSIC_SUBSECTOR_COLS: u8 = 8;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct HexCoord {
    pub col: u8,
    pub row: u8,
}

impl HexCoord {
    pub fn new(col: u8, row: u8) -> Self {
        Self { col, row }
    }

    /// Cepheus "0101"-style four-digit hex address.
    pub fn label(self) -> String {
        format!("{:02}{:02}", self.col, self.row)
    }
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Bases {
    pub naval: bool,
    pub scout: bool,
    pub research: bool,
    pub Aid: bool,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum TravelZone {
    Green,
    Amber,
    Red,
}

/// Compact UWP digits + starport letter for a main world. Mirrors the
/// TS `UwpDigits` shape so the wire format is uniform.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Uwp {
    pub starport: char,
    pub size: u8,
    pub atm: u8,
    pub hydro: u8,
    pub pop: u8,
    pub gov: u8,
    pub law: u8,
    pub tech: u8,
}

/// Cepheus PBG extension: population multiplier, planetoid-belt count,
/// and gas-giant count. Counts are capped at one decimal digit because
/// the classic survey format gives each slot one character.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Pbg {
    pub population_multiplier: u8,
    pub belts: u8,
    pub gas_giants: u8,
}

impl Uwp {
    /// Render as the canonical "A867974-D" string. Digits 10-15 use the
    /// classic pseudo-hex letters A-F.
    pub fn to_code(self) -> String {
        format!(
            "{}{}{}{}{}{}{}-{}",
            self.starport,
            digit(self.size),
            digit(self.atm),
            digit(self.hydro),
            digit(self.pop),
            digit(self.gov),
            digit(self.law),
            digit(self.tech),
        )
    }
}

fn digit(value: u8) -> char {
    match value {
        0..=9 => (b'0' + value) as char,
        10..=35 => (b'A' + value - 10) as char,
        _ => 'F',
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SubsectorHex {
    pub coord: HexCoord,
    /// Per-hex deterministic seed used to regenerate the full system on demand.
    pub system_seed: u32,
    pub uwp: Uwp,
    pub bases: Bases,
    pub travel_zone: TravelZone,
    /// Four-character allegiance/polity code for this occupied hex.
    pub allegiance: String,
    pub gas_giant: bool,
    pub belts: bool,
    /// Actual population estimate used to derive the UWP population
    /// exponent and the PBG population multiplier.
    pub population: u64,
    pub pbg: Pbg,
    /// Optional textual name for v1 we leave None; future phases can wire a
    /// name generator.
    pub name: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Subsector {
    pub seed: u32,
    /// 0..1 — target fraction of hexes that should host a system.
    pub density: f32,
    /// Serialized map dimensions so JS presentation does not assume a single
    /// classic 8-column subsector.
    pub columns: u8,
    pub rows: u8,
    /// Dominant/default allegiance summary for legacy consumers.
    pub allegiance: String,
    /// Polities present in this local region, including the neutral
    /// border zone when it appears.
    pub allegiances: Vec<Allegiance>,
    pub hexes: Vec<SubsectorHex>,
    pub jump_routes: Vec<JumpRoute>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Allegiance {
    pub code: String,
    pub name: String,
    pub capital: HexCoord,
    pub color_index: u8,
}

/// A jump-1 or jump-2 connection between two occupied hexes. Edges are
/// undirected; we emit (a, b) with `a < b` for canonical ordering.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct JumpRoute {
    pub from: HexCoord,
    pub to: HexCoord,
    /// 1 = jump-1 link, 2 = jump-2 link.
    pub jump: u8,
    /// Selective message/government courier line from Chapter 12.
    pub communication: bool,
    /// Commercial tie between complementary trade-code worlds.
    pub trade: bool,
    /// 0..9 rough commercial importance for map/export presentation.
    pub trade_score: u8,
}

impl Subsector {
    pub fn hex_at(&self, coord: HexCoord) -> Option<&SubsectorHex> {
        self.hexes.iter().find(|h| h.coord == coord)
    }
}

/// Splitmix64-style hash combining a parent seed with (col, row).
fn hash_hex_seed(parent: u32, col: u8, row: u8) -> u32 {
    let mut z = (parent as u64)
        .wrapping_mul(0x9E3779B97F4A7C15)
        .wrapping_add(((col as u64) << 16) | row as u64);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
    z ^= z >> 31;
    z as u32
}

struct Rng {
    state: u64,
}

impl Rng {
    fn new(seed: u32) -> Self {
        let mut s = (seed as u64) ^ 0x243F_6A88_85A3_08D3;
        if s == 0 {
            s = 0xCAFEBABEDEADBEEF;
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

    fn d6(&mut self) -> i32 {
        1 + (self.f01() * 6.0).floor() as i32
    }

    fn roll(&mut self, n: usize) -> i32 {
        (0..n).map(|_| self.d6()).sum()
    }
}

/// Generate a subsector at the requested seed and density. Density is the
/// presence probability per hex; 0.5 matches the classic 1d6 ≥ 4 rule.
pub fn generate(seed: u32, density: f32) -> Subsector {
    let density = density.clamp(0.0, 1.0);
    let mut hexes = Vec::new();

    for col in 1..=SUBSECTOR_COLS {
        for row in 1..=SUBSECTOR_ROWS {
            let mut rng = Rng::new(hash_hex_seed(seed, col, row));
            if rng.f01() > density {
                continue;
            }
            let coord = HexCoord::new(col, row);
            let system_seed = rng.next_u32();
            let system = system::generate(system_seed);
            let hex = build_hex(coord, system_seed, &system, &mut rng);
            hexes.push(hex);
        }
    }

    let allegiances = generate_allegiances(seed);
    assign_hex_allegiances(&mut hexes, &allegiances);
    let allegiance = dominant_allegiance(&hexes, &allegiances);
    let jump_routes = compute_jump_routes(&hexes);

    Subsector {
        seed,
        density,
        columns: SUBSECTOR_COLS,
        rows: SUBSECTOR_ROWS,
        allegiance,
        allegiances,
        hexes,
        jump_routes,
    }
}

fn generate_allegiances(seed: u32) -> Vec<Allegiance> {
    let names = [
        ("ImDi", "Imperial Diocese"),
        ("NaVa", "Navis Verge"),
        ("CsLe", "Client League"),
        ("FrSt", "Free Stars"),
        ("UnCo", "Union Compact"),
        ("ScZo", "Scout Zone"),
    ];
    let a = (hash_hex_seed(seed ^ 0xA11E_0001, 1, 1) as usize) % names.len();
    let mut b = (hash_hex_seed(seed ^ 0xA11E_0002, 2, 1) as usize) % names.len();
    if b == a {
        b = (b + 1) % names.len();
    }
    vec![
        Allegiance {
            code: names[a].0.to_string(),
            name: names[a].1.to_string(),
            capital: HexCoord::new(3 + (seed as u8 % 3), 3 + ((seed >> 8) as u8 % 5)),
            color_index: 0,
        },
        Allegiance {
            code: names[b].0.to_string(),
            name: names[b].1.to_string(),
            capital: HexCoord::new(12 + ((seed >> 16) as u8 % 3), 3 + ((seed >> 24) as u8 % 5)),
            color_index: 1,
        },
        Allegiance {
            code: "Na".to_string(),
            name: "Neutral Border".to_string(),
            capital: HexCoord::new(CLASSIC_SUBSECTOR_COLS, 5),
            color_index: 2,
        },
    ]
}

fn assign_hex_allegiances(hexes: &mut [SubsectorHex], allegiances: &[Allegiance]) {
    let [left, right, neutral, ..] = allegiances else {
        return;
    };
    for hex in hexes {
        let left_distance = hex_distance(hex.coord, left.capital);
        let right_distance = hex_distance(hex.coord, right.capital);
        hex.allegiance = if (left_distance - right_distance).abs() <= 1 {
            neutral.code.clone()
        } else if left_distance < right_distance {
            left.code.clone()
        } else {
            right.code.clone()
        };
    }
}

fn dominant_allegiance(hexes: &[SubsectorHex], allegiances: &[Allegiance]) -> String {
    let mut best_code = allegiances.first().map(|a| a.code.as_str()).unwrap_or("Na");
    let mut best_count = 0usize;
    for allegiance in allegiances {
        let count = hexes
            .iter()
            .filter(|hex| hex.allegiance == allegiance.code)
            .count();
        if count > best_count {
            best_count = count;
            best_code = &allegiance.code;
        }
    }
    best_code.to_string()
}

/// Compute jump-1 and jump-2 connectivity between occupied hexes.
/// A route exists if both endpoints host a starport of class C or better
/// (Cepheus convention - lower-class ports lack refined fuel).
fn compute_jump_routes(hexes: &[SubsectorHex]) -> Vec<JumpRoute> {
    let mut routes = Vec::new();
    let qualifies = |port: char| matches!(port, 'A' | 'B' | 'C');
    let occupied: Vec<&SubsectorHex> = hexes.iter().filter(|h| qualifies(h.uwp.starport)).collect();
    for (i, a) in occupied.iter().enumerate() {
        for b in occupied.iter().skip(i + 1) {
            let d = hex_distance(a.coord, b.coord);
            if d == 1 || d == 2 {
                let trade_score = trade_route_score(a, b, d);
                routes.push(JumpRoute {
                    from: a.coord,
                    to: b.coord,
                    jump: d as u8,
                    communication: is_communication_route(a, b, d, trade_score),
                    trade: trade_score > 0,
                    trade_score,
                });
            }
        }
    }
    routes
}

fn is_communication_route(
    a: &SubsectorHex,
    b: &SubsectorHex,
    distance: i32,
    trade_score: u8,
) -> bool {
    // Chapter 12 says communications routes should connect only some
    // worlds so backwaters remain. This keeps high-service ports, bases,
    // and populous worlds connected while leaving many C-port neighbours
    // off the official courier net.
    if matches!(a.travel_zone, TravelZone::Red) || matches!(b.travel_zone, TravelZone::Red) {
        return false;
    }
    let score = communication_endpoint_score(a)
        + communication_endpoint_score(b)
        + if distance == 1 { 0 } else { -2 };
    score >= 6 || trade_score >= 7
}

fn communication_endpoint_score(hex: &SubsectorHex) -> i32 {
    let port = match hex.uwp.starport {
        'A' => 4,
        'B' => 3,
        'C' => 2,
        _ => 0,
    };
    let population = if hex.uwp.pop >= 9 {
        2
    } else if hex.uwp.pop >= 7 {
        1
    } else {
        0
    };
    let bases = i32::from(hex.bases.naval)
        + i32::from(hex.bases.scout)
        + i32::from(hex.bases.research)
        + i32::from(hex.bases.Aid);
    let zone = match hex.travel_zone {
        TravelZone::Green => 0,
        TravelZone::Amber => -1,
        TravelZone::Red => -4,
    };
    port + population + bases + zone
}

fn trade_route_score(a: &SubsectorHex, b: &SubsectorHex, distance: i32) -> u8 {
    if matches!(a.travel_zone, TravelZone::Red) || matches!(b.travel_zone, TravelZone::Red) {
        return 0;
    }
    if !is_trade_pair(a, b) {
        return 0;
    }
    let score =
        4 + trade_endpoint_score(a) + trade_endpoint_score(b) + if distance == 1 { 1 } else { 0 };
    score.clamp(1, 9) as u8
}

fn trade_endpoint_score(hex: &SubsectorHex) -> i32 {
    let port = match hex.uwp.starport {
        'A' => 2,
        'B' => 1,
        'C' => 0,
        _ => -3,
    };
    let pop = if hex.uwp.pop >= 9 {
        2
    } else if hex.uwp.pop >= 7 {
        1
    } else {
        0
    };
    let tl = if hex.uwp.tech >= 12 { 1 } else { 0 };
    port + pop + tl
}

fn is_trade_pair(a: &SubsectorHex, b: &SubsectorHex) -> bool {
    (is_industrial_or_high_tech(a) && is_resource_or_backwater(b))
        || (is_industrial_or_high_tech(b) && is_resource_or_backwater(a))
        || (is_high_pop_or_rich(a) && is_food_or_water_world(b))
        || (is_high_pop_or_rich(b) && is_food_or_water_world(a))
}

fn is_industrial_or_high_tech(hex: &SubsectorHex) -> bool {
    let u = hex.uwp;
    let industrial = matches!(u.atm, 0..=2 | 4 | 7 | 9) && u.pop >= 9;
    industrial || u.tech >= 12
}

fn is_resource_or_backwater(hex: &SubsectorHex) -> bool {
    let u = hex.uwp;
    let asteroid = u.size == 0 && u.atm == 0 && u.hydro == 0;
    let desert = u.atm >= 2 && u.hydro == 0;
    let ice_capped = u.atm <= 1 && u.hydro >= 1;
    let non_industrial = (4..=6).contains(&u.pop);
    asteroid || desert || ice_capped || non_industrial
}

fn is_high_pop_or_rich(hex: &SubsectorHex) -> bool {
    let u = hex.uwp;
    let rich = matches!(u.atm, 6 | 8) && (6..=8).contains(&u.pop) && (4..=9).contains(&u.gov);
    u.pop >= 9 || rich
}

fn is_food_or_water_world(hex: &SubsectorHex) -> bool {
    let u = hex.uwp;
    let agricultural =
        (4..=9).contains(&u.size) && (4..=8).contains(&u.atm) && (5..=7).contains(&u.hydro);
    let garden =
        matches!(u.atm, 5 | 6 | 8) && (4..=9).contains(&u.size) && (4..=8).contains(&u.hydro);
    let water = u.hydro == 10;
    agricultural || garden || water
}

/// Hex-grid distance using the "doubled-coordinate" trick for a
/// pointy-top hex layout where odd columns shift down by half a row.
/// This matches the on-screen geometry, which is what users will
/// reason about when they look at the SVG.
fn hex_distance(a: HexCoord, b: HexCoord) -> i32 {
    let (ax, ay) = axial_from_offset(a);
    let (bx, by) = axial_from_offset(b);
    let dx = ax - bx;
    let dy = ay - by;
    let dz = -dx - dy;
    (dx.abs() + dy.abs() + dz.abs()) / 2
}

fn axial_from_offset(coord: HexCoord) -> (i32, i32) {
    // odd-q offset → axial: q = col, r = row - (col - (col&1)) / 2
    let col = coord.col as i32;
    let row = coord.row as i32;
    let q = col;
    let r = row - (col - (col & 1)) / 2;
    (q, r)
}

fn build_hex(
    coord: HexCoord,
    system_seed: u32,
    system: &SolarSystem,
    rng: &mut Rng,
) -> SubsectorHex {
    let gas_giant_count = system
        .planets
        .iter()
        .filter(|p| matches!(p.body_type, BodyType::GasGiant | BodyType::IceGiant))
        .count();
    let belt_count = system.belts.len();
    let gas_giant = gas_giant_count > 0;
    let belts = belt_count > 0;
    let uwp = project_uwp(system, rng);
    let bases = roll_bases(&uwp, rng);
    let travel_zone = roll_travel_zone(&uwp, rng);
    let population = roll_actual_population(uwp.pop, rng);
    let pbg = pbg_from_parts(population, uwp.pop, belt_count, gas_giant_count);

    SubsectorHex {
        coord,
        system_seed,
        uwp,
        bases,
        travel_zone,
        allegiance: "Na".to_string(),
        gas_giant,
        belts,
        population,
        pbg,
        name: None,
    }
}

/// Project main-world physical state into Cepheus UWP digits. This stays in
/// Rust so the subsector wire format is self-contained — TS-side trade-code
/// derivation reads the `uwp` field and applies the existing rules.
fn project_uwp(system: &SolarSystem, rng: &mut Rng) -> Uwp {
    // Pick the main world; fall back to the largest rocky/terrestrial body
    // when no body scored as habitable.
    let main = if system.main_world >= 0 {
        Some(&system.planets[system.main_world as usize])
    } else {
        system
            .planets
            .iter()
            .filter(|p| {
                matches!(
                    p.body_type,
                    BodyType::Rocky | BodyType::Terrestrial | BodyType::SuperEarth
                )
            })
            .max_by(|a, b| {
                a.radius_earth
                    .partial_cmp(&b.radius_earth)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    };

    let (size, hydro, atm) = main_world_physical_codes(main);

    // Population: weighted by main-world habitability with a wide
    // distribution. A handful of empty / barren hexes occur naturally.
    let hab = main.map(|p| p.climate.habitability).unwrap_or(0.0);
    let base_pop = (hab * 9.0) as i32;
    let pop = clamp_digit(base_pop + rng.roll(2) - 7, 0, 10) as u8;

    let gov = government_for_roll(rng.roll(2), pop);
    let law = law_for_roll(rng.roll(2), gov);

    let starport = starport_for_roll(rng.roll(2), pop);
    let tech = tech_level_for_roll(rng.d6(), starport, size, atm, hydro, pop, gov);

    Uwp {
        starport,
        size,
        atm,
        hydro,
        pop,
        gov,
        law,
        tech,
    }
}

fn main_world_physical_codes(main: Option<&system::Planet>) -> (u8, u8, u8) {
    let Some(p) = main else {
        return (0, 0, 0);
    };

    let size = clamp_digit((p.radius_earth * 8.0).round() as i32, 0, 10) as u8;
    // Cepheus size 0 is asteroid-scale. Size 0 has no atmosphere or water;
    // size 1 may retain a trace/thin atmosphere in this science-first model
    // but Chapter 12 still forces hydrographics to 0 for size 0 or 1.
    if size == 0 {
        return (0, 0, 0);
    }

    let hydro = hydrographics_code(p.climate.liquid_water_fraction);
    if size == 1 {
        return (size, 0, atmosphere_code(size, p));
    }

    (size, hydro, atmosphere_code(size, p))
}

fn atmosphere_code(size: u8, planet: &system::Planet) -> u8 {
    if size == 0 {
        0
    } else if planet.climate.habitability > 0.55 {
        6
    } else if planet.climate.habitability > 0.25 {
        4
    } else if planet.temperature_k > 500.0 {
        10
    } else if planet.temperature_k < 180.0 {
        1
    } else {
        2
    }
}

fn hydrographics_code(water_fraction: f32) -> u8 {
    let pct = (water_fraction.clamp(0.0, 1.0) * 100.0).round() as i32;
    if pct <= 5 {
        0
    } else {
        clamp_digit((pct + 4) / 10, 0, 10) as u8
    }
}

fn government_for_roll(roll_2d6: i32, pop: u8) -> u8 {
    if pop == 0 {
        return 0;
    }
    clamp_digit(roll_2d6 - 7 + pop as i32, 0, 15) as u8
}

fn law_for_roll(roll_2d6: i32, gov: u8) -> u8 {
    if gov == 0 {
        return 0;
    }
    clamp_digit(roll_2d6 - 7 + gov as i32, 0, 15) as u8
}

fn starport_for_roll(roll_2d6: i32, pop: u8) -> char {
    // Cepheus primary starport: adjusted roll = 2D6 - 7 + Population.
    match roll_2d6 - 7 + pop as i32 {
        i if i <= 2 => 'X',
        3..=4 => 'E',
        5..=6 => 'D',
        7..=8 => 'C',
        9..=10 => 'B',
        _ => 'A',
    }
}

fn tech_level_for_roll(
    roll_d6: i32,
    starport: char,
    size: u8,
    atm: u8,
    hydro: u8,
    pop: u8,
    gov: u8,
) -> u8 {
    if pop == 0 {
        return 0;
    }
    let mut tech_dm = 0i32;
    tech_dm += match starport {
        'A' => 6,
        'B' => 4,
        'C' => 2,
        'X' => -4,
        _ => 0,
    };
    if size <= 1 {
        tech_dm += 2;
    } else if size <= 4 {
        tech_dm += 1;
    }
    if atm <= 3 || atm >= 10 {
        tech_dm += 1;
    }
    if hydro == 0 || hydro == 9 {
        tech_dm += 1;
    } else if hydro >= 10 {
        tech_dm += 2;
    }
    if (1..=5).contains(&pop) {
        tech_dm += 1;
    } else if pop >= 9 {
        tech_dm += if pop >= 10 { 4 } else { 2 };
    }
    tech_dm += match gov {
        0 | 5 => 1,
        7 => 2,
        13 | 14 => -2,
        _ => 0,
    };
    let mut tech = clamp_digit(roll_d6 + tech_dm, 0, 15) as u8;
    tech = tech.max(minimum_tech_level(atm, hydro, pop));
    tech.min(15)
}

fn minimum_tech_level(atm: u8, hydro: u8, pop: u8) -> u8 {
    if pop == 0 {
        return 0;
    }
    let mut min_tl = 0;
    if (hydro == 0 || hydro == 10) && pop >= 6 {
        min_tl = min_tl.max(4);
    }
    if matches!(atm, 4 | 7 | 9) {
        min_tl = min_tl.max(5);
    }
    if atm <= 3 || (10..=12).contains(&atm) {
        min_tl = min_tl.max(7);
    }
    if matches!(atm, 13 | 14) && hydro == 10 {
        min_tl = min_tl.max(7);
    }
    min_tl
}

fn roll_bases(uwp: &Uwp, rng: &mut Rng) -> Bases {
    // Cepheus base-presence rules (simplified): high-class starports host
    // Naval / Scout / Research / Aid bases on a 2D6 ≥ N check, with N
    // sliding by starport class. Lower-class ports keep most bases off.
    let port_dm = match uwp.starport {
        'A' => 2,
        'B' => 1,
        'C' => 0,
        _ => -2,
    };
    let pop_dm = if uwp.pop >= 8 { 1 } else { 0 };
    let check = |target: i32, rng: &mut Rng| rng.roll(2) + port_dm + pop_dm >= target;
    Bases {
        naval: matches!(uwp.starport, 'A' | 'B') && check(8, rng),
        scout: matches!(uwp.starport, 'A' | 'B' | 'C' | 'D') && check(7, rng),
        research: matches!(uwp.starport, 'A' | 'B') && check(10, rng),
        Aid: matches!(uwp.starport, 'A' | 'B') && check(8, rng),
    }
}

fn roll_travel_zone(uwp: &Uwp, rng: &mut Rng) -> TravelZone {
    // Match legacy 2d6 Map density: most worlds are unmarked (green), a
    // small minority flag as Amber (high-law / contested) and a rare
    // few as Red (interdicted). Roughly 10-15 % amber, 2-3 % red.
    let extreme_law = uwp.law >= 12;
    let extreme_gov = uwp.gov >= 13;
    if extreme_law && extreme_gov && rng.d6() >= 4 {
        return TravelZone::Red;
    }
    if rng.d6() == 6 && rng.d6() == 6 && rng.d6() == 6 {
        return TravelZone::Red;
    }
    if uwp.law >= 9 && rng.roll(2) >= 10 {
        return TravelZone::Amber;
    }
    if uwp.gov >= 12 && rng.d6() >= 5 {
        return TravelZone::Amber;
    }
    if rng.roll(2) >= 12 {
        return TravelZone::Amber;
    }
    TravelZone::Green
}

fn roll_actual_population(pop_exponent: u8, rng: &mut Rng) -> u64 {
    if pop_exponent == 0 {
        return 0;
    }
    let multiplier = 1 + (rng.f01() * 9.0).floor() as u64;
    multiplier.min(9) * 10_u64.pow(pop_exponent as u32)
}

fn pbg_from_parts(
    population: u64,
    pop_exponent: u8,
    belt_count: usize,
    gas_giant_count: usize,
) -> Pbg {
    Pbg {
        population_multiplier: population_multiplier(population, pop_exponent),
        belts: belt_count.min(9) as u8,
        gas_giants: gas_giant_count.min(9) as u8,
    }
}

fn population_multiplier(population: u64, pop_exponent: u8) -> u8 {
    if population == 0 || pop_exponent == 0 {
        return 0;
    }
    let order = 10_u64.pow(pop_exponent as u32);
    ((population / order).clamp(1, 9)) as u8
}

fn clamp_digit(value: i32, lo: i32, hi: i32) -> i32 {
    value.max(lo).min(hi)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::climate::ClimateSummary;

    #[test]
    fn deterministic_for_same_seed() {
        let a = generate(0xC0FFEE, 0.5);
        let b = generate(0xC0FFEE, 0.5);
        assert_eq!(a.columns, b.columns);
        assert_eq!(a.rows, b.rows);
        assert_eq!(a.allegiance, b.allegiance);
        assert_eq!(a.allegiances, b.allegiances);
        assert_eq!(a.hexes.len(), b.hexes.len());
        for (ha, hb) in a.hexes.iter().zip(b.hexes.iter()) {
            assert_eq!(ha.coord, hb.coord);
            assert_eq!(ha.system_seed, hb.system_seed);
            assert_eq!(ha.uwp, hb.uwp);
            assert_eq!(ha.bases, hb.bases);
            assert_eq!(ha.travel_zone, hb.travel_zone);
            assert_eq!(ha.allegiance, hb.allegiance);
            assert_eq!(ha.gas_giant, hb.gas_giant);
            assert_eq!(ha.belts, hb.belts);
            assert_eq!(ha.population, hb.population);
            assert_eq!(ha.pbg, hb.pbg);
        }
        assert_eq!(a.jump_routes, b.jump_routes);
    }

    #[test]
    fn occupancy_matches_density() {
        // Average occupancy across 32 seeds should land near the configured
        // density. Tolerance loose so the test stays stable.
        let total_cells = (SUBSECTOR_COLS as usize) * (SUBSECTOR_ROWS as usize);
        let target = 0.5;
        let trials = 32;
        let mut total_occupied = 0usize;
        for seed in 0..trials {
            total_occupied += generate(seed as u32 * 17 + 1, target).hexes.len();
        }
        let mean = total_occupied as f32 / (trials as f32 * total_cells as f32);
        assert!(
            (mean - target).abs() < 0.08,
            "mean occupancy {mean:.3} far from target {target:.3}"
        );
    }

    #[test]
    fn hexes_within_grid() {
        let sub = generate(42, 0.7);
        for hex in &sub.hexes {
            assert!(hex.coord.col >= 1 && hex.coord.col <= SUBSECTOR_COLS);
            assert!(hex.coord.row >= 1 && hex.coord.row <= SUBSECTOR_ROWS);
        }
    }

    #[test]
    fn allegiances_are_assigned_across_the_two_subsector_strip() {
        let sub = generate(1, 1.0);

        assert_eq!(sub.allegiances.len(), 3);
        let codes: Vec<&str> = sub.allegiances.iter().map(|a| a.code.as_str()).collect();
        assert!(codes.contains(&sub.allegiance.as_str()));
        for hex in &sub.hexes {
            assert!(codes.contains(&hex.allegiance.as_str()));
        }
        let left = sub.hex_at(HexCoord::new(1, 1)).expect("left hex");
        let right = sub.hex_at(HexCoord::new(16, 10)).expect("right hex");
        assert_ne!(left.allegiance, right.allegiance);
    }

    #[test]
    fn uwp_digits_are_in_range() {
        let sub = generate(7, 0.6);
        for hex in &sub.hexes {
            let u = &hex.uwp;
            assert!(matches!(u.starport, 'A' | 'B' | 'C' | 'D' | 'E' | 'X'));
            assert!(u.size <= 10);
            assert!(u.atm <= 15);
            assert!(u.hydro <= 10);
            assert!(u.pop <= 10);
            assert!(u.gov <= 15);
            assert!(u.law <= 15);
            assert!(u.tech <= 15);
        }
    }

    #[test]
    fn uwp_to_code_round_trip() {
        let u = Uwp {
            starport: 'A',
            size: 8,
            atm: 6,
            hydro: 7,
            pop: 9,
            gov: 7,
            law: 4,
            tech: 13,
        };
        assert_eq!(u.to_code(), "A867974-D");
    }

    #[test]
    fn physical_codes_round_from_main_world_and_suppress_size_zero_water() {
        assert_eq!(main_world_physical_codes(None), (0, 0, 0));

        let tiny_wet = test_planet(0.04, 288.0, 0.8, 0.9);
        assert_eq!(main_world_physical_codes(Some(&tiny_wet)), (0, 0, 0));

        let small_wet = test_planet(0.18, 288.0, 0.8, 0.9);
        assert_eq!(main_world_physical_codes(Some(&small_wet)), (1, 0, 6));

        let dry_edge = test_planet(0.99, 288.0, 0.05, 0.9);
        assert_eq!(main_world_physical_codes(Some(&dry_edge)), (8, 0, 6));

        let wet_edge = test_planet(0.99, 288.0, 0.06, 0.9);
        assert_eq!(main_world_physical_codes(Some(&wet_edge)), (8, 1, 6));

        let earthlike = test_planet(1.06, 288.0, 0.74, 0.9);
        assert_eq!(main_world_physical_codes(Some(&earthlike)), (8, 7, 6));

        let ocean_super_earth = test_planet(1.8, 288.0, 1.2, 0.4);
        assert_eq!(
            main_world_physical_codes(Some(&ocean_super_earth)),
            (10, 10, 4)
        );
    }

    #[test]
    fn atmosphere_code_tracks_habitability_and_temperature_extremes() {
        let habitable = test_planet(1.0, 288.0, 0.7, 0.8);
        let marginal = test_planet(1.0, 250.0, 0.3, 0.3);
        let inferno = test_planet(1.0, 650.0, 0.0, 0.0);
        let frozen = test_planet(1.0, 120.0, 0.0, 0.0);
        let barren = test_planet(1.0, 260.0, 0.0, 0.0);

        assert_eq!(atmosphere_code(8, &habitable), 6);
        assert_eq!(atmosphere_code(8, &marginal), 4);
        assert_eq!(atmosphere_code(8, &inferno), 10);
        assert_eq!(atmosphere_code(8, &frozen), 1);
        assert_eq!(atmosphere_code(8, &barren), 2);
    }

    #[test]
    fn hydrographics_code_uses_cepheus_percentage_buckets() {
        assert_eq!(hydrographics_code(0.00), 0);
        assert_eq!(hydrographics_code(0.05), 0);
        assert_eq!(hydrographics_code(0.06), 1);
        assert_eq!(hydrographics_code(0.15), 1);
        assert_eq!(hydrographics_code(0.16), 2);
        assert_eq!(hydrographics_code(0.95), 9);
        assert_eq!(hydrographics_code(0.96), 10);
        assert_eq!(hydrographics_code(1.00), 10);
    }

    #[test]
    fn government_law_and_starport_table_shapes_are_clamped() {
        assert_eq!(government_for_roll(2, 0), 0);
        assert_eq!(government_for_roll(2, 1), 0);
        assert_eq!(government_for_roll(7, 7), 7);
        assert_eq!(government_for_roll(12, 12), 15);

        assert_eq!(law_for_roll(2, 0), 0);
        assert_eq!(law_for_roll(12, 0), 0);
        assert_eq!(law_for_roll(2, 1), 0);
        assert_eq!(law_for_roll(7, 9), 9);
        assert_eq!(law_for_roll(12, 15), 15);
    }

    #[test]
    fn starport_table_boundaries_follow_adjusted_roll() {
        // adjusted = 2D6 - 7 + Population
        assert_eq!(starport_for_roll(2, 0), 'X');
        assert_eq!(starport_for_roll(3, 6), 'X');
        assert_eq!(starport_for_roll(4, 6), 'E');
        assert_eq!(starport_for_roll(5, 6), 'E');
        assert_eq!(starport_for_roll(6, 6), 'D');
        assert_eq!(starport_for_roll(7, 6), 'D');
        assert_eq!(starport_for_roll(8, 6), 'C');
        assert_eq!(starport_for_roll(9, 6), 'C');
        assert_eq!(starport_for_roll(10, 6), 'B');
        assert_eq!(starport_for_roll(11, 6), 'B');
        assert_eq!(starport_for_roll(12, 6), 'A');
        assert_eq!(starport_for_roll(12, 0), 'D');
        assert_eq!(starport_for_roll(12, 12), 'A');
    }

    #[test]
    fn tech_level_applies_world_dms_and_clamps() {
        assert_eq!(tech_level_for_roll(1, 'A', 8, 6, 7, 6, 7), 9);
        assert_eq!(tech_level_for_roll(6, 'A', 8, 6, 7, 0, 0), 0);
        assert_eq!(tech_level_for_roll(1, 'X', 8, 6, 7, 6, 7), 0);
        assert_eq!(tech_level_for_roll(1, 'D', 5, 6, 5, 5, 7), 4);
        assert_eq!(tech_level_for_roll(6, 'A', 1, 10, 9, 10, 7), 15);
        assert_eq!(tech_level_for_roll(1, 'D', 8, 3, 5, 6, 7), 7);
        assert_eq!(tech_level_for_roll(1, 'D', 8, 7, 5, 6, 7), 5);
        assert_eq!(tech_level_for_roll(1, 'D', 8, 6, 0, 6, 7), 4);
        assert_eq!(tech_level_for_roll(1, 'D', 8, 13, 10, 6, 7), 7);
        assert_eq!(tech_level_for_roll(1, 'D', 8, 6, 7, 6, 5), 2);
        assert_eq!(tech_level_for_roll(6, 'D', 8, 6, 7, 6, 13), 4);
    }

    #[test]
    fn pbg_is_derived_from_population_and_system_counts() {
        let pbg = pbg_from_parts(7_000_000, 6, 12, 4);

        assert_eq!(
            pbg,
            Pbg {
                population_multiplier: 7,
                belts: 9,
                gas_giants: 4,
            }
        );
    }

    #[test]
    fn generated_pbg_matches_population_and_presence_flags() {
        let sub = generate(20260525, 1.0);
        for hex in &sub.hexes {
            assert_eq!(hex.belts, hex.pbg.belts > 0);
            assert_eq!(hex.gas_giant, hex.pbg.gas_giants > 0);
            if hex.uwp.pop == 0 {
                assert_eq!(hex.population, 0);
                assert_eq!(hex.pbg.population_multiplier, 0);
            } else {
                let order = 10_u64.pow(hex.uwp.pop as u32);
                assert_eq!(hex.population / order, hex.pbg.population_multiplier as u64);
                assert!((1..=9).contains(&hex.pbg.population_multiplier));
            }
        }
    }

    #[test]
    fn empty_at_zero_density() {
        let sub = generate(1, 0.0);
        assert_eq!(sub.hexes.len(), 0);
    }

    #[test]
    fn full_at_unit_density() {
        let sub = generate(1, 1.0);
        let total = (SUBSECTOR_COLS as usize) * (SUBSECTOR_ROWS as usize);
        assert_eq!(sub.hexes.len(), total);
        assert_eq!(total, 160);
        assert!(sub.hex_at(HexCoord::new(16, 10)).is_some());
    }

    #[test]
    fn hex_distance_neighbours() {
        // Adjacent in same column.
        assert_eq!(hex_distance(HexCoord::new(3, 5), HexCoord::new(3, 6)), 1);
        // Adjacent across a column (odd-q layout neighbour set).
        assert_eq!(hex_distance(HexCoord::new(3, 5), HexCoord::new(4, 5)), 1);
        assert_eq!(hex_distance(HexCoord::new(4, 5), HexCoord::new(5, 5)), 1);
        // Two hexes apart in same column.
        assert_eq!(hex_distance(HexCoord::new(3, 5), HexCoord::new(3, 7)), 2);
    }

    #[test]
    fn jump_routes_link_only_qualifying_ports() {
        // Force a dense grid so we definitely have neighbours.
        let sub = generate(99, 1.0);
        for r in &sub.jump_routes {
            let a = sub.hex_at(r.from).expect("from coord present");
            let b = sub.hex_at(r.to).expect("to coord present");
            assert!(matches!(a.uwp.starport, 'A' | 'B' | 'C'));
            assert!(matches!(b.uwp.starport, 'A' | 'B' | 'C'));
            assert!(r.jump == 1 || r.jump == 2);
            assert_eq!(r.trade, r.trade_score > 0);
            let d = hex_distance(r.from, r.to);
            assert_eq!(d as u8, r.jump);
        }
    }

    #[test]
    fn jump_routes_cross_two_subsector_boundary_and_mark_comms() {
        let a = route_test_hex_with_uwp(
            8,
            5,
            Uwp {
                starport: 'A',
                pop: 8,
                ..default_route_uwp()
            },
        );
        let b = route_test_hex_with_uwp(
            9,
            5,
            Uwp {
                starport: 'B',
                pop: 8,
                ..default_route_uwp()
            },
        );
        let c = route_test_hex(10, 5, 'D');
        let routes = compute_jump_routes(&[a, b, c]);

        let seam = routes
            .iter()
            .find(|r| r.from == HexCoord::new(8, 5) && r.to == HexCoord::new(9, 5))
            .expect("A/B seam route");
        assert_eq!(seam.jump, 1);
        assert!(seam.communication);
        assert!(!routes
            .iter()
            .any(|r| { r.from == HexCoord::new(9, 5) && r.to == HexCoord::new(10, 5) }));
    }

    #[test]
    fn communication_routes_are_selective() {
        let c_port = route_test_hex(1, 1, 'C');
        let other_c_port = route_test_hex(1, 2, 'C');
        let routes = compute_jump_routes(&[c_port, other_c_port]);

        assert_eq!(routes.len(), 1);
        assert!(!routes[0].communication);

        let hub = route_test_hex_with_uwp(
            1,
            1,
            Uwp {
                starport: 'A',
                pop: 9,
                ..default_route_uwp()
            },
        );
        let partner = route_test_hex_with_uwp(
            1,
            2,
            Uwp {
                starport: 'B',
                pop: 8,
                ..default_route_uwp()
            },
        );
        let routes = compute_jump_routes(&[hub, partner]);
        assert!(routes[0].communication);
    }

    #[test]
    fn trade_routes_follow_chapter_12_pairings() {
        let industrial = route_test_hex_with_uwp(
            1,
            1,
            Uwp {
                starport: 'A',
                atm: 4,
                pop: 9,
                tech: 12,
                ..default_route_uwp()
            },
        );
        let non_industrial = route_test_hex_with_uwp(
            1,
            2,
            Uwp {
                starport: 'C',
                pop: 5,
                tech: 7,
                ..default_route_uwp()
            },
        );
        let unmatched = route_test_hex_with_uwp(
            1,
            3,
            Uwp {
                starport: 'C',
                atm: 3,
                hydro: 2,
                pop: 7,
                tech: 8,
                ..default_route_uwp()
            },
        );
        let routes = compute_jump_routes(&[industrial, non_industrial, unmatched]);

        let trade = routes
            .iter()
            .find(|r| r.from == HexCoord::new(1, 1) && r.to == HexCoord::new(1, 2))
            .expect("industrial/non-industrial route");
        assert!(trade.trade);
        assert!(trade.trade_score >= 7);

        let ordinary = routes
            .iter()
            .find(|r| r.from == HexCoord::new(1, 2) && r.to == HexCoord::new(1, 3))
            .expect("ordinary jump route");
        assert!(!ordinary.trade);
        assert_eq!(ordinary.trade_score, 0);
    }

    #[test]
    fn label_format() {
        assert_eq!(HexCoord::new(3, 4).label(), "0304");
        assert_eq!(HexCoord::new(8, 10).label(), "0810");
        assert_eq!(HexCoord::new(16, 10).label(), "1610");
    }

    fn route_test_hex(col: u8, row: u8, starport: char) -> SubsectorHex {
        route_test_hex_with_uwp(
            col,
            row,
            Uwp {
                starport,
                ..default_route_uwp()
            },
        )
    }

    fn route_test_hex_with_uwp(col: u8, row: u8, uwp: Uwp) -> SubsectorHex {
        SubsectorHex {
            coord: HexCoord::new(col, row),
            system_seed: 1,
            uwp,
            bases: Bases::default(),
            travel_zone: TravelZone::Green,
            allegiance: "Na".to_string(),
            gas_giant: false,
            belts: false,
            population: 6_000_000,
            pbg: Pbg {
                population_multiplier: 6,
                belts: 0,
                gas_giants: 0,
            },
            name: None,
        }
    }

    fn default_route_uwp() -> Uwp {
        Uwp {
            starport: 'C',
            size: 8,
            atm: 6,
            hydro: 7,
            pop: 6,
            gov: 7,
            law: 4,
            tech: 9,
        }
    }

    fn test_planet(
        radius_earth: f32,
        temperature_k: f32,
        liquid_water_fraction: f32,
        habitability: f32,
    ) -> system::Planet {
        system::Planet {
            orbit_au: 1.0,
            eccentricity: 0.0,
            inclination_deg: 0.0,
            mass_earth: radius_earth.max(0.01),
            radius_earth,
            body_type: BodyType::Terrestrial,
            temperature_k,
            phase_rad: 0.0,
            day_seconds: 86_400.0,
            seed: 1,
            in_habitable_zone: true,
            moons: vec![],
            climate: ClimateSummary {
                mean_surface_temp_k: temperature_k,
                min_surface_temp_k: temperature_k - 20.0,
                max_surface_temp_k: temperature_k + 20.0,
                greenhouse_k: 0.0,
                liquid_water_fraction,
                ice_fraction: 0.0,
                aridity: 1.0 - liquid_water_fraction.clamp(0.0, 1.0),
                habitability,
                thermal_inertia: liquid_water_fraction.clamp(0.0, 1.0),
                mean_rainfall_mm: 0.0,
            },
        }
    }
}
