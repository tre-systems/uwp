use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct PlanetParams {
    pub seed: u32,
    pub sea_level: f32,
    pub mountain_height: f32,
    pub noise_frequency: f32,
    pub noise_octaves: u32,
    pub atmosphere_density: f32,
    pub atmosphere_color: [f32; 3],
    pub ocean_color: [f32; 3],
    pub land_color: [f32; 3],
    pub mountain_color: [f32; 3],
    pub sand_color: [f32; 3],
    pub snow_color: [f32; 3],
    pub ice_latitude: f32,
    pub sun_angle: f32,
    pub auto_rotate: f32,
    pub cloud_coverage: f32,
}

impl Default for PlanetParams {
    fn default() -> Self {
        Self {
            seed: 1337,
            sea_level: 0.52,
            mountain_height: 0.05,
            noise_frequency: 1.5,
            noise_octaves: 7,
            atmosphere_density: 0.45,
            atmosphere_color: [0.46, 0.68, 1.0],
            ocean_color: [0.03, 0.15, 0.42],
            land_color: [0.18, 0.55, 0.20],
            mountain_color: [0.40, 0.32, 0.24],
            sand_color: [0.86, 0.76, 0.52],
            snow_color: [0.97, 0.98, 1.0],
            ice_latitude: 0.82,
            sun_angle: 0.55,
            auto_rotate: 0.05,
            cloud_coverage: 0.22,
        }
    }
}
