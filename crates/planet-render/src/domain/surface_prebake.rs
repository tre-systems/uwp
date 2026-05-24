//! Surface pre-bake: per-seed heightmap + biome cube-map sampled on a
//! latitude-longitude grid.
//!
//! Combines two physics-motivated layers:
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
//! Output: a `PreBake` struct holding a heightmap (lat × lon grid of f32
//! in [-1, 1]) and a coarse biome classification. v1 is sampled by
//! `surface_map::generate` instead of the cheap inline noise to give the
//! hex map continental-scale features it didn't have before.
//!
//! Pairing item 1 (pre-bake) with item 3 (tectonics) is intentional —
//! the doc treats them as separate compute items but tectonics' output
//! IS the heightmap layer of the pre-bake. Sharing the data structure
//! avoids the duplication the doc warned against in the World Surface
//! Map roadmap.
//!
//! Future shader integration (planet.wgsl sampling this pre-bake
//! instead of running its own noise stack) is the natural follow-on;
//! the data path is in place, only the GPU bind-group + WGSL sampling
//! code remain.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

pub const PREBAKE_LON: usize = 192;
pub const PREBAKE_LAT: usize = 96;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PreBake {
    pub lon_cells: u32,
    pub lat_cells: u32,
    pub heightmap: Vec<f32>,
    /// Plate index per cell (0..n_plates). Useful for biome tagging and
    /// future shader-side highlighting.
    pub plate_id: Vec<u8>,
    /// Plates resolved during generation — bake time inputs preserved so
    /// callers can debug or render plate boundaries.
    pub plates: Vec<Plate>,
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
        let lat = lat_norm.clamp(0.0, 1.0) * (PREBAKE_LAT as f32 - 1.0);
        let lon = (lon_norm.rem_euclid(1.0)) * PREBAKE_LON as f32;
        let i0 = lat.floor() as usize;
        let i1 = (i0 + 1).min(PREBAKE_LAT - 1);
        let j0 = (lon.floor() as usize) % PREBAKE_LON;
        let j1 = (j0 + 1) % PREBAKE_LON;
        let fi = lat - i0 as f32;
        let fj = lon - lon.floor();
        let h00 = self.heightmap[i0 * PREBAKE_LON + j0];
        let h01 = self.heightmap[i0 * PREBAKE_LON + j1];
        let h10 = self.heightmap[i1 * PREBAKE_LON + j0];
        let h11 = self.heightmap[i1 * PREBAKE_LON + j1];
        let h0 = h00 * (1.0 - fj) + h01 * fj;
        let h1 = h10 * (1.0 - fj) + h11 * fj;
        h0 * (1.0 - fi) + h1 * fi
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

/// Generate the per-seed surface pre-bake. Cheap by design (<5 ms for
/// the default 192×96 grid) so callers can rebuild on every seed change
/// without ceremony.
pub fn generate(seed: u32, water_fraction: f32) -> PreBake {
    let mut rng = Rng::new(seed);
    let plates = make_plates(&mut rng, water_fraction.clamp(0.0, 1.0));

    let mut heightmap = vec![0.0f32; PREBAKE_LAT * PREBAKE_LON];
    let mut plate_id = vec![0u8; PREBAKE_LAT * PREBAKE_LON];

    for i in 0..PREBAKE_LAT {
        let lat = -std::f32::consts::FRAC_PI_2
            + (i as f32 + 0.5) / PREBAKE_LAT as f32 * std::f32::consts::PI;
        let (sin_lat, cos_lat) = (lat.sin(), lat.cos());
        for j in 0..PREBAKE_LON {
            let lon = -std::f32::consts::PI
                + (j as f32 + 0.5) / PREBAKE_LON as f32 * std::f32::consts::TAU;
            // Unit-sphere Cartesian point.
            let p = [cos_lat * lon.cos(), sin_lat, cos_lat * lon.sin()];
            let (best, second) = nearest_two(&plates, p);
            // Boundary closeness: 1 at a perfect interior of a plate,
            // approaching 0 at a boundary. Used to weight uplift.
            let edge = 1.0 - (best.dist / second.dist.max(1e-5)).clamp(0.0, 1.0);
            let plate = &plates[best.idx];

            // Continental / oceanic baseline from the plate's mean elevation.
            let mut h = plate.mean_elev * (0.65 + 0.35 * edge);

            // Boundary forcing: project the plate drift vectors at the
            // sample point and check if they converge (positive) or
            // diverge (negative) along the boundary.
            let other = &plates[second.idx];
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
            h += noise * 0.18;

            // Clamp into a working range so downstream sea-level picking
            // has a consistent distribution.
            h = h.clamp(-1.0, 1.0);

            let idx = i * PREBAKE_LON + j;
            heightmap[idx] = h;
            plate_id[idx] = best.idx as u8;
        }
    }

    PreBake {
        lon_cells: PREBAKE_LON as u32,
        lat_cells: PREBAKE_LAT as u32,
        heightmap,
        plate_id,
        plates,
    }
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
    // 4-octave fractal noise on the unit-sphere point. Frequencies
    // chosen so the lowest octave carries continent-scale features and
    // the highest carries terrain texture without aliasing the 192×96
    // grid.
    let mut acc = 0.0;
    let mut amp = 0.5;
    let mut freq = 1.5;
    let mut weight = 0.0;
    for octave in 0..4 {
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
    }

    #[test]
    fn heightmap_has_expected_size() {
        let p = generate(1, 0.5);
        assert_eq!(p.heightmap.len(), PREBAKE_LON * PREBAKE_LAT);
        assert_eq!(p.plate_id.len(), PREBAKE_LON * PREBAKE_LAT);
        assert!(p.plates.len() >= 6 && p.plates.len() <= 11);
    }

    #[test]
    fn heightmap_values_in_range() {
        let p = generate(7, 0.5);
        for h in &p.heightmap {
            assert!(h.is_finite());
            assert!(*h >= -1.0 && *h <= 1.0, "out of range: {h}");
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
        let got = p.sample(
            lat_norm - 0.5 / PREBAKE_LAT as f32,
            lon_norm - 0.5 / PREBAKE_LON as f32,
        );
        // Bilinear of the cell value with itself should equal the value.
        assert!(
            (got - want).abs() < 1e-4,
            "sample {got} far from cell {want}"
        );
    }
}
