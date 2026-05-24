//! Cepheus Engine subsector generator.
//!
//! A subsector is an 8-column × 10-row hex grid of star systems. Each
//! occupied hex carries its main world's UWP, bases, trade-zone, and
//! presence flags (gas giant, asteroid belt) so the SVG map can render
//! without re-running system generation.
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

use serde::{Deserialize, Serialize};

use super::system::{self, BodyType, SolarSystem};

/// Subsector grid extents. Cepheus convention: 8 columns × 10 rows.
pub const SUBSECTOR_COLS: u8 = 8;
pub const SUBSECTOR_ROWS: u8 = 10;

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
    pub gas_giant: bool,
    pub belts: bool,
    /// Optional textual name for v1 we leave None; future phases can wire a
    /// name generator.
    pub name: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Subsector {
    pub seed: u32,
    /// 0..1 — target fraction of hexes that should host a system.
    pub density: f32,
    /// Single allegiance per subsector for v1.
    pub allegiance: String,
    pub hexes: Vec<SubsectorHex>,
    pub jump_routes: Vec<JumpRoute>,
}

/// A jump-1 or jump-2 connection between two occupied hexes. Edges are
/// undirected; we emit (a, b) with `a < b` for canonical ordering.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct JumpRoute {
    pub from: HexCoord,
    pub to: HexCoord,
    /// 1 = jump-1 link, 2 = jump-2 link.
    pub jump: u8,
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

    let jump_routes = compute_jump_routes(&hexes);

    Subsector {
        seed,
        density,
        allegiance: "Independent".to_string(),
        hexes,
        jump_routes,
    }
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
                routes.push(JumpRoute {
                    from: a.coord,
                    to: b.coord,
                    jump: d as u8,
                });
            }
        }
    }
    routes
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
    let gas_giant = system
        .planets
        .iter()
        .any(|p| matches!(p.body_type, BodyType::GasGiant | BodyType::IceGiant));
    let belts = !system.belts.is_empty();
    let uwp = project_uwp(system, rng);
    let bases = roll_bases(&uwp, rng);
    let travel_zone = roll_travel_zone(&uwp, rng);

    SubsectorHex {
        coord,
        system_seed,
        uwp,
        bases,
        travel_zone,
        gas_giant,
        belts,
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

    let (size, hydro, atm) = if let Some(p) = main {
        let size = clamp_digit((p.radius_earth * 8.0).round() as i32, 0, 10);
        let hydro = clamp_digit(
            (p.climate.liquid_water_fraction * 10.0).round() as i32,
            0,
            10,
        );
        // Atmosphere code: rough heuristic. Habitable + significant water →
        // standard (6); hot + dry → thin (3); cold/airless → 0; large gas-bag
        // worlds get a dense (8) or exotic value.
        let atm = if size == 0 {
            0
        } else if p.climate.habitability > 0.55 {
            6
        } else if p.climate.habitability > 0.25 {
            4
        } else if p.temperature_k > 500.0 {
            10
        } else if p.temperature_k < 180.0 {
            1
        } else {
            2
        };
        (size as u8, hydro as u8, atm as u8)
    } else {
        (0, 0, 0)
    };

    // Population: weighted by main-world habitability with a wide
    // distribution. A handful of empty / barren hexes occur naturally.
    let hab = main.map(|p| p.climate.habitability).unwrap_or(0.0);
    let base_pop = (hab * 9.0) as i32;
    let pop = clamp_digit(base_pop + rng.roll(2) - 7, 0, 12) as u8;

    // Government: Cepheus standard "2D6-7+pop" clamped.
    let gov = clamp_digit(rng.roll(2) - 7 + pop as i32, 0, 15) as u8;
    // Law: "2D6-7+gov" clamped.
    let law = clamp_digit(rng.roll(2) - 7 + gov as i32, 0, 15) as u8;

    // Starport: Cepheus standard 2D6 with population DM.
    let pop_dm = (pop as i32 / 3) - 2;
    let starport = match rng.roll(2) + pop_dm {
        i if i <= 2 => 'X',
        3..=4 => 'E',
        5..=6 => 'D',
        7..=8 => 'C',
        9..=10 => 'B',
        _ => 'A',
    };

    // Tech: Cepheus modifiers folded into a single roll.
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
    if hydro >= 9 {
        tech_dm += 1;
    }
    if pop >= 1 && pop <= 5 {
        tech_dm += 1;
    } else if pop >= 9 {
        tech_dm += pop as i32 - 7;
    }
    let tech = clamp_digit(rng.d6() + tech_dm, 0, 15) as u8;

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
    // Red zones: oppressive law level + extreme government, or a flat 1-in-30
    // "interdicted" roll. Amber zones: high law or contested. Otherwise green.
    let extreme_law = uwp.law >= 9;
    let extreme_gov = uwp.gov >= 13;
    if (extreme_law && extreme_gov) || rng.d6() == 6 && rng.d6() == 6 && rng.d6() >= 5 {
        TravelZone::Red
    } else if uwp.law >= 7 || uwp.gov >= 11 || rng.roll(2) >= 11 {
        TravelZone::Amber
    } else {
        TravelZone::Green
    }
}

fn clamp_digit(value: i32, lo: i32, hi: i32) -> i32 {
    value.max(lo).min(hi)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_for_same_seed() {
        let a = generate(0xC0FFEE, 0.5);
        let b = generate(0xC0FFEE, 0.5);
        assert_eq!(a.hexes.len(), b.hexes.len());
        for (ha, hb) in a.hexes.iter().zip(b.hexes.iter()) {
            assert_eq!(ha.coord, hb.coord);
            assert_eq!(ha.system_seed, hb.system_seed);
            assert_eq!(ha.uwp, hb.uwp);
            assert_eq!(ha.bases, hb.bases);
            assert_eq!(ha.travel_zone, hb.travel_zone);
            assert_eq!(ha.gas_giant, hb.gas_giant);
            assert_eq!(ha.belts, hb.belts);
        }
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
            "mean occupancy {:.3} far from target {:.3}",
            mean,
            target
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
    fn uwp_digits_are_in_range() {
        let sub = generate(7, 0.6);
        for hex in &sub.hexes {
            let u = &hex.uwp;
            assert!(matches!(u.starport, 'A' | 'B' | 'C' | 'D' | 'E' | 'X'));
            assert!(u.size <= 10);
            assert!(u.atm <= 15);
            assert!(u.hydro <= 10);
            assert!(u.pop <= 12);
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
    fn empty_at_zero_density() {
        let sub = generate(1, 0.0);
        assert_eq!(sub.hexes.len(), 0);
    }

    #[test]
    fn full_at_unit_density() {
        let sub = generate(1, 1.0);
        let total = (SUBSECTOR_COLS as usize) * (SUBSECTOR_ROWS as usize);
        assert_eq!(sub.hexes.len(), total);
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
            let d = hex_distance(r.from, r.to);
            assert_eq!(d as u8, r.jump);
        }
    }

    #[test]
    fn label_format() {
        assert_eq!(HexCoord::new(3, 4).label(), "0304");
        assert_eq!(HexCoord::new(8, 10).label(), "0810");
    }
}
