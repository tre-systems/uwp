//! Rust-owned surface atlas for the legacy 2d6-style icosahedral world map.
//!
//! The older `SurfaceMap` JSON still carries a coarse 32 x 16 compatibility
//! grid, but the visible map now reads these stable cells. Each id is tied to
//! an icosahedron face and a subdivision triangle, so the map, inspector,
//! settlement markers, and region drill-downs can all refer to the same
//! physical location without re-bucketing latitude/longitude in TypeScript.

use serde::{Deserialize, Serialize};

use super::surface_map::Terrain;
use super::surface_prebake::{BiomeId, PreBake};
use super::system::{BodyType, Planet};

pub const SURFACE_ATLAS_SUBDIVISIONS: u8 = 12;
pub const TRI_SIDE: f32 = 200.0;
pub const TRI_HEIGHT: f32 = TRI_SIDE * 0.866_025_4;
pub const NET_WIDTH: f32 = 5.5 * TRI_SIDE;
pub const NET_HEIGHT: f32 = 3.0 * TRI_HEIGHT;

const NORTH_LAT: f32 = 0.463_647_6; // atan(0.5), matching the TS net.

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SurfaceCellId {
    pub face: u8,
    pub i: u8,
    pub j: u8,
    pub up: bool,
    pub resolution: u8,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SurfaceAtlasCell {
    pub id: SurfaceCellId,
    /// Compatibility coordinate in the legacy 32 x 16 surface-map grid.
    pub coord: super::surface_map::SurfaceHexCoord,
    /// Flat-net centre in the same coordinate system as `src/domain/icosahedron.ts`.
    pub x: f32,
    pub y: f32,
    pub latitude_deg: f32,
    pub longitude_deg: f32,
    /// Normalised elevation 0..1 for UI inspectors.
    pub elevation: f32,
    /// Signed atlas elevation in [-1, 1], before waterline quantile.
    pub elevation_signed: f32,
    pub water_depth: f32,
    pub slope: f32,
    pub moisture: f32,
    pub temperature_k: f32,
    pub biome_id: u8,
    pub terrain: Terrain,
    /// Pointy-top SVG hex boundary around the centre. It is clipped by the
    /// triangular face in the map renderer, so cells at face edges stay tidy.
    pub flat_boundary: [[f32; 2]; 6],
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SurfaceAtlas {
    pub resolution: u8,
    pub hex_radius: f32,
    pub net_width: f32,
    pub net_height: f32,
    /// Signed height threshold that matches the renderer's waterline.
    /// Region/detail views use this to keep local shorelines aligned with
    /// the globe and unfolded world map.
    pub sea_level_threshold: f32,
    pub cells: Vec<SurfaceAtlasCell>,
}

#[derive(Clone, Copy)]
struct Vec2 {
    x: f32,
    y: f32,
}

#[derive(Clone, Copy)]
struct Vec3 {
    x: f32,
    y: f32,
    z: f32,
}

#[derive(Clone, Copy)]
struct Face {
    v: [usize; 3],
    col: u8,
    row: u8,
}

#[derive(Clone, Copy)]
struct Bary {
    u: f32,
    v: f32,
    w: f32,
}

pub fn generate(
    prebake: &PreBake,
    planet: &Planet,
    water_fraction: f32,
    resolution: u8,
) -> SurfaceAtlas {
    let n = resolution.clamp(2, 32);
    let hex_radius = TRI_SIDE / (n as f32 * 3.0_f32.sqrt());
    let mut cells = Vec::with_capacity(20 * n as usize * n as usize);
    let faces = faces();
    let verts = vertices_3d();

    for (face_idx, face) in faces.iter().enumerate() {
        let flat = face_flat_vertices(*face);
        let sph = [verts[face.v[0]], verts[face.v[1]], verts[face.v[2]]];
        for row in 0..n {
            for col in 0..(n - row) {
                let up_bary = Bary {
                    u: 1.0
                        - (col as f32 + 1.0 / 3.0) / n as f32
                        - (row as f32 + 1.0 / 3.0) / n as f32,
                    v: (col as f32 + 1.0 / 3.0) / n as f32,
                    w: (row as f32 + 1.0 / 3.0) / n as f32,
                };
                cells.push(build_cell(
                    prebake,
                    planet,
                    water_fraction,
                    face_idx as u8,
                    col,
                    row,
                    true,
                    n,
                    up_bary,
                    flat,
                    sph,
                    hex_radius,
                ));

                if col + row + 1 < n {
                    let down_bary = Bary {
                        u: 1.0
                            - (col as f32 + 2.0 / 3.0) / n as f32
                            - (row as f32 + 2.0 / 3.0) / n as f32,
                        v: (col as f32 + 2.0 / 3.0) / n as f32,
                        w: (row as f32 + 2.0 / 3.0) / n as f32,
                    };
                    cells.push(build_cell(
                        prebake,
                        planet,
                        water_fraction,
                        face_idx as u8,
                        col,
                        row,
                        false,
                        n,
                        down_bary,
                        flat,
                        sph,
                        hex_radius,
                    ));
                }
            }
        }
    }

    SurfaceAtlas {
        resolution: n,
        hex_radius,
        net_width: NET_WIDTH,
        net_height: NET_HEIGHT,
        sea_level_threshold: prebake.sea_level,
        cells,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_cell(
    prebake: &PreBake,
    planet: &Planet,
    water_fraction: f32,
    face: u8,
    i: u8,
    j: u8,
    up: bool,
    resolution: u8,
    bary: Bary,
    flat: [Vec2; 3],
    sph: [Vec3; 3],
    hex_radius: f32,
) -> SurfaceAtlasCell {
    let center_3d = normalise(mix3(bary, sph));
    let flat_center = mix2(bary, flat);
    let lat_rad = center_3d.y.clamp(-1.0, 1.0).asin();
    let lon_rad = center_3d.z.atan2(center_3d.x);
    let lat_norm = lat_rad / std::f32::consts::PI + 0.5;
    let lon_norm = lon_rad / std::f32::consts::TAU + 0.5;
    let elevation_signed = prebake.sample(lat_norm, lon_norm);
    let elevation = (elevation_signed * 0.5 + 0.5).clamp(0.0, 1.0);
    let water_depth = (prebake.sea_level - elevation_signed).max(0.0);
    let biome = prebake.sample_biome(lat_norm, lon_norm);
    let terrain = project_biome_to_terrain(biome, planet.body_type, water_fraction);
    let moisture = prebake.sample_moisture(lat_norm, lon_norm);
    let temperature_k = prebake.sample_temperature(lat_norm, lon_norm);
    let slope = sample_slope(prebake, lat_norm, lon_norm);

    SurfaceAtlasCell {
        id: SurfaceCellId {
            face,
            i,
            j,
            up,
            resolution,
        },
        coord: coord_from_lat_lon(lat_rad.to_degrees(), lon_rad.to_degrees()),
        x: flat_center.x,
        y: flat_center.y,
        latitude_deg: lat_rad.to_degrees(),
        longitude_deg: lon_rad.to_degrees(),
        elevation,
        elevation_signed,
        water_depth,
        slope,
        moisture,
        temperature_k,
        biome_id: biome as u8,
        terrain,
        flat_boundary: hex_boundary(flat_center, hex_radius),
    }
}

pub fn coord_from_lat_lon(lat_deg: f32, lon_deg: f32) -> super::surface_map::SurfaceHexCoord {
    let col = (((lon_deg + 180.0) / 360.0) * super::surface_map::SURFACE_COLS as f32)
        .floor()
        .clamp(0.0, (super::surface_map::SURFACE_COLS - 1) as f32) as u8;
    let row = (((lat_deg + 90.0) / 180.0) * super::surface_map::SURFACE_ROWS as f32)
        .floor()
        .clamp(0.0, (super::surface_map::SURFACE_ROWS - 1) as f32) as u8;
    super::surface_map::SurfaceHexCoord { col, row }
}

#[cfg(test)]
fn find_cell<'a>(
    cells: &'a [SurfaceAtlasCell],
    id: &SurfaceCellId,
) -> Option<&'a SurfaceAtlasCell> {
    cells.iter().find(|cell| cell.id == *id)
}

pub fn project_biome_to_terrain(biome: BiomeId, body: BodyType, water: f32) -> Terrain {
    if matches!(body, BodyType::Inferno) {
        return match biome {
            BiomeId::DeepOcean | BiomeId::ShallowOcean => Terrain::Volcanic,
            BiomeId::Mountain | BiomeId::AlpineRock => Terrain::Mountain,
            _ => Terrain::Volcanic,
        };
    }
    match biome {
        BiomeId::DeepOcean | BiomeId::ShallowOcean => Terrain::Ocean,
        BiomeId::Shore => {
            if water < 0.05 {
                Terrain::Plain
            } else {
                Terrain::Shoreline
            }
        }
        BiomeId::Plain | BiomeId::Grassland | BiomeId::Savanna => Terrain::Plain,
        BiomeId::Forest => Terrain::Forest,
        BiomeId::Hills => Terrain::Hill,
        BiomeId::Mountain | BiomeId::AlpineRock => Terrain::Mountain,
        BiomeId::Desert | BiomeId::Barren => Terrain::Desert,
        BiomeId::Tundra => Terrain::Tundra,
        BiomeId::Snow | BiomeId::Ice => Terrain::Ice,
        BiomeId::Volcanic => Terrain::Volcanic,
    }
}

fn sample_slope(prebake: &PreBake, lat_norm: f32, lon_norm: f32) -> f32 {
    let d_lat = 1.0 / prebake.lat_cells.max(1) as f32;
    let d_lon = 1.0 / prebake.lon_cells.max(1) as f32;
    let h_l = prebake.sample(lat_norm, lon_norm - d_lon);
    let h_r = prebake.sample(lat_norm, lon_norm + d_lon);
    let h_d = prebake.sample((lat_norm - d_lat).clamp(0.0, 1.0), lon_norm);
    let h_u = prebake.sample((lat_norm + d_lat).clamp(0.0, 1.0), lon_norm);
    (((h_r - h_l) * 0.5).powi(2) + ((h_u - h_d) * 0.5).powi(2)).sqrt()
}

fn vertices_3d() -> [Vec3; 12] {
    let mut out = [Vec3 {
        x: 0.0,
        y: 0.0,
        z: 0.0,
    }; 12];
    // Match `src/domain/icosahedron.ts` exactly. The historical comments call
    // these "north/south poles", but the app's globe convention derives
    // latitude from the Y axis, so the cap vertices live on +/-Z.
    out[0] = Vec3 {
        x: 0.0,
        y: 0.0,
        z: 1.0,
    };
    out[1] = Vec3 {
        x: 0.0,
        y: 0.0,
        z: -1.0,
    };
    for i in 0..5 {
        out[2 + i] = spherical_to_cart(NORTH_LAT, (i as f32 * 72.0).to_radians());
        out[7 + i] = spherical_to_cart(-NORTH_LAT, (i as f32 * 72.0 + 36.0).to_radians());
    }
    out
}

fn spherical_to_cart(lat: f32, lon: f32) -> Vec3 {
    let cos = lat.cos();
    Vec3 {
        x: cos * lon.cos(),
        y: lat.sin(),
        z: cos * lon.sin(),
    }
}

fn faces() -> [Face; 20] {
    let mut out = [Face {
        v: [0, 0, 0],
        col: 0,
        row: 0,
    }; 20];
    for col in 0..5 {
        let c = col as u8;
        out[col] = Face {
            v: [0, n_idx(c), n_idx(c + 1)],
            col: c,
            row: 0,
        };
        out[5 + col] = Face {
            v: [n_idx(c), n_idx(c + 1), s_idx(c)],
            col: c,
            row: 1,
        };
        out[10 + col] = Face {
            v: [n_idx(c + 1), s_idx(c), s_idx(c + 1)],
            col: c,
            row: 2,
        };
        out[15 + col] = Face {
            v: [s_idx(c), s_idx(c + 1), 1],
            col: c,
            row: 3,
        };
    }
    out
}

fn n_idx(col: u8) -> usize {
    2 + (col as usize % 5)
}

fn s_idx(col: u8) -> usize {
    7 + (col as usize % 5)
}

fn face_flat_vertices(face: Face) -> [Vec2; 3] {
    let c = face.col as f32;
    match face.row {
        0 => [
            Vec2 {
                x: (c + 0.5) * TRI_SIDE,
                y: 0.0,
            },
            Vec2 {
                x: c * TRI_SIDE,
                y: TRI_HEIGHT,
            },
            Vec2 {
                x: (c + 1.0) * TRI_SIDE,
                y: TRI_HEIGHT,
            },
        ],
        1 => [
            Vec2 {
                x: c * TRI_SIDE,
                y: TRI_HEIGHT,
            },
            Vec2 {
                x: (c + 1.0) * TRI_SIDE,
                y: TRI_HEIGHT,
            },
            Vec2 {
                x: (c + 0.5) * TRI_SIDE,
                y: 2.0 * TRI_HEIGHT,
            },
        ],
        2 => [
            Vec2 {
                x: (c + 1.0) * TRI_SIDE,
                y: TRI_HEIGHT,
            },
            Vec2 {
                x: (c + 0.5) * TRI_SIDE,
                y: 2.0 * TRI_HEIGHT,
            },
            Vec2 {
                x: (c + 1.5) * TRI_SIDE,
                y: 2.0 * TRI_HEIGHT,
            },
        ],
        _ => [
            Vec2 {
                x: (c + 0.5) * TRI_SIDE,
                y: 2.0 * TRI_HEIGHT,
            },
            Vec2 {
                x: (c + 1.5) * TRI_SIDE,
                y: 2.0 * TRI_HEIGHT,
            },
            Vec2 {
                x: (c + 1.0) * TRI_SIDE,
                y: 3.0 * TRI_HEIGHT,
            },
        ],
    }
}

fn mix2(b: Bary, v: [Vec2; 3]) -> Vec2 {
    Vec2 {
        x: v[0].x * b.u + v[1].x * b.v + v[2].x * b.w,
        y: v[0].y * b.u + v[1].y * b.v + v[2].y * b.w,
    }
}

fn mix3(b: Bary, v: [Vec3; 3]) -> Vec3 {
    Vec3 {
        x: v[0].x * b.u + v[1].x * b.v + v[2].x * b.w,
        y: v[0].y * b.u + v[1].y * b.v + v[2].y * b.w,
        z: v[0].z * b.u + v[1].z * b.v + v[2].z * b.w,
    }
}

fn normalise(v: Vec3) -> Vec3 {
    let len = (v.x * v.x + v.y * v.y + v.z * v.z).sqrt().max(1e-6);
    Vec3 {
        x: v.x / len,
        y: v.y / len,
        z: v.z / len,
    }
}

fn hex_boundary(center: Vec2, radius: f32) -> [[f32; 2]; 6] {
    let mut out = [[0.0_f32; 2]; 6];
    for (i, pt) in out.iter_mut().enumerate() {
        let a = (-90.0 + 60.0 * i as f32).to_radians();
        *pt = [center.x + radius * a.cos(), center.y + radius * a.sin()];
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::climate::ClimateSummary;
    use crate::domain::surface_prebake::{self, BakeInput};
    use crate::domain::system;

    fn test_planet() -> Planet {
        let mut planet = system::generate(7).planets.remove(0);
        planet.body_type = BodyType::Terrestrial;
        planet
    }

    fn test_bake() -> PreBake {
        surface_prebake::generate_with(BakeInput {
            seed: 12,
            water_fraction: 0.6,
            ice_latitude: 0.82,
            mean_temp_k: 288.0,
            vegetation_richness: 0.7,
            lon_cells: 128,
            lat_cells: 64,
        })
    }

    #[test]
    fn atlas_has_stable_cell_count_and_ids() {
        let planet = test_planet();
        let bake = test_bake();
        let atlas = generate(&bake, &planet, 0.6, 8);
        assert_eq!(atlas.cells.len(), 20 * 8 * 8);
        assert_eq!(atlas.resolution, 8);
        assert!(atlas.hex_radius > 0.0);
        assert_eq!(atlas.sea_level_threshold, bake.sea_level);
        assert!(atlas.cells.iter().all(|c| c.id.resolution == 8));
        assert!(atlas.cells.iter().all(|c| (0..20).contains(&c.id.face)));
    }

    #[test]
    fn atlas_cells_are_finite_and_inside_net() {
        let planet = test_planet();
        let bake = test_bake();
        let atlas = generate(&bake, &planet, 0.6, 6);
        for cell in &atlas.cells {
            assert!(cell.x.is_finite() && cell.y.is_finite());
            assert!((0.0..=NET_WIDTH).contains(&cell.x), "x {}", cell.x);
            assert!((0.0..=NET_HEIGHT).contains(&cell.y), "y {}", cell.y);
            assert!((-90.0..=90.0).contains(&cell.latitude_deg));
            assert!((-180.0..=180.0).contains(&cell.longitude_deg));
            assert!((0.0..=1.0).contains(&cell.elevation));
            assert!(cell.temperature_k.is_finite());
            assert!((0.0..=1.0).contains(&cell.moisture));
        }
    }

    #[test]
    fn id_lookup_returns_the_exact_cell() {
        let planet = test_planet();
        let bake = test_bake();
        let atlas = generate(&bake, &planet, 0.6, 5);
        let picked = atlas.cells[37].id;
        let found = find_cell(&atlas.cells, &picked).expect("cell id should exist");
        assert_eq!(found.id, picked);
    }

    #[test]
    fn atlas_terrain_tracks_biome_projection() {
        let planet = test_planet();
        let bake = test_bake();
        let atlas = generate(&bake, &planet, 0.6, 4);
        for cell in atlas.cells.iter().take(20) {
            let terrain =
                project_biome_to_terrain(BiomeId::from_u8(cell.biome_id), planet.body_type, 0.6);
            assert_eq!(cell.terrain, terrain);
        }
    }

    #[test]
    fn climate_summary_copy_guard() {
        // Keeps this module linked to the real climate shape used by callers.
        let c = ClimateSummary {
            mean_surface_temp_k: 288.0,
            min_surface_temp_k: 250.0,
            max_surface_temp_k: 305.0,
            greenhouse_k: 33.0,
            liquid_water_fraction: 0.7,
            ice_fraction: 0.1,
            aridity: 0.15,
            habitability: 0.75,
            thermal_inertia: 0.4,
            mean_rainfall_mm: 900.0,
        };
        assert!(c.mean_surface_temp_k > 0.0);
    }
}
