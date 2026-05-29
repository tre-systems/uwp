use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;

use crate::domain::{subsector, surface_map, surface_prebake, system};
use crate::scenes::system as system_scene;
use crate::{params, renderer};

#[wasm_bindgen]
pub struct Planet {
    inner: renderer::Renderer,
}

#[wasm_bindgen]
impl Planet {
    pub async fn create(canvas: HtmlCanvasElement, mesh_quality: f32) -> Result<Planet, JsValue> {
        let inner = renderer::Renderer::new(canvas, mesh_quality)
            .await
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        Ok(Planet { inner })
    }

    #[wasm_bindgen(js_name = setParams)]
    pub fn set_params(&mut self, params: JsValue) -> Result<(), JsValue> {
        let p: params::PlanetParams = serde_wasm_bindgen::from_value(params)?;
        self.inner.set_params(p);
        Ok(())
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.inner.resize(width.max(1), height.max(1));
    }

    #[wasm_bindgen(js_name = setMeshQuality)]
    pub fn set_mesh_quality(&mut self, mesh_quality: f32) {
        self.inner.set_mesh_quality(mesh_quality);
    }

    pub fn drag(&mut self, dx: f32, dy: f32) {
        self.inner.drag(dx, dy);
    }

    pub fn zoom(&mut self, delta: f32) {
        self.inner.zoom(delta);
    }

    pub fn render(&mut self, time_ms: f64) -> Result<(), JsValue> {
        self.inner
            .render((time_ms * 0.001) as f32)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen(js_name = setViewMode)]
    pub fn set_view_mode(&mut self, mode: &str) {
        self.inner.set_view_mode(match mode {
            "system" => renderer::ViewMode::System,
            _ => renderer::ViewMode::Detail,
        });
    }

    #[wasm_bindgen(js_name = setSystemSeed)]
    pub fn set_system_seed(&mut self, seed: u32) {
        self.inner.set_system_seed(seed);
    }

    #[wasm_bindgen(js_name = getSystem)]
    pub fn get_system(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(self.inner.system())
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen(js_name = rerollPlanet)]
    pub fn reroll_planet(&mut self, idx: u32, new_seed: u32) {
        self.inner.reroll_planet(idx, new_seed);
    }

    /// Ray-pick the system overview. `time_ms` keeps the picked planet
    /// aligned with the one currently animating on screen. Returns the
    /// 0-based planet index or `-1` when the ray misses.
    #[wasm_bindgen(js_name = pickSystemPlanet)]
    pub fn pick_system_planet(&self, canvas_x: f32, canvas_y: f32, time_ms: f64) -> i32 {
        match self
            .inner
            .pick_system_planet(canvas_x, canvas_y, (time_ms * 0.001) as f32)
        {
            Some(i) => i as i32,
            None => -1,
        }
    }

    /// Ray-pick the full system overview and return a small typed target:
    /// `{kind:"planet"|"star"|"belt", index:n}`. Returns null on miss.
    #[wasm_bindgen(js_name = pickSystemBody)]
    pub fn pick_system_body(
        &self,
        canvas_x: f32,
        canvas_y: f32,
        time_ms: f64,
    ) -> Result<JsValue, JsValue> {
        let Some(hit) = self
            .inner
            .pick_system_body(canvas_x, canvas_y, (time_ms * 0.001) as f32)
        else {
            return Ok(JsValue::NULL);
        };
        #[derive(serde::Serialize)]
        struct PickTarget {
            kind: &'static str,
            index: usize,
        }
        let kind = match hit.kind {
            system_scene::PickKind::Planet => "planet",
            system_scene::PickKind::PrimaryStar | system_scene::PickKind::CompanionStar => "star",
            system_scene::PickKind::AsteroidBelt => "belt",
        };
        serde_wasm_bindgen::to_value(&PickTarget {
            kind,
            index: hit.index,
        })
        .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Orient the detail view's globe so the requested surface coordinates
    /// (lat/lon in degrees) sit at the centre of the frame. Stops the
    /// auto-rotation so the hex doesn't drift past while the user looks.
    #[wasm_bindgen(js_name = pointAtSurface)]
    pub fn point_at_surface(&mut self, lat_deg: f32, lon_deg: f32) {
        self.inner.point_at_surface(lat_deg, lon_deg);
    }

    /// Generate a Cepheus-style hex world map for the main world of the
    /// current system. Kept as a compatibility wrapper; product UI should
    /// call `getSurfaceMapForPlanet` so Surface mode follows the selected
    /// body instead of always snapping back to the main world.
    #[wasm_bindgen(js_name = getSurfaceMap)]
    pub fn get_surface_map(&self) -> Result<JsValue, JsValue> {
        let system = self.inner.system();
        if system.planets.is_empty() {
            return Ok(JsValue::NULL);
        }
        let main_idx = if system.main_world >= 0 {
            system.main_world as usize
        } else {
            0
        };
        self.surface_map_for_planet(main_idx)
    }

    /// Generate a Cepheus-style hex world map for a specific planet in
    /// the current system. The surface composition follows the user's
    /// authored planet parameters (`sea_level`, `ice_latitude`, …) so the
    /// hex grid always matches the selected globe, not an unrelated
    /// Rust-side main-world candidate. Returns null for stars, belts, or
    /// an out-of-range planet index.
    #[wasm_bindgen(js_name = getSurfaceMapForPlanet)]
    pub fn get_surface_map_for_planet(&self, planet_index: u32) -> Result<JsValue, JsValue> {
        self.surface_map_for_planet(planet_index as usize)
    }

    fn surface_map_for_planet(&self, planet_index: usize) -> Result<JsValue, JsValue> {
        let system = self.inner.system();
        let Some(planet) = system.planets.get(planet_index) else {
            return Ok(JsValue::NULL);
        };
        let params = self.inner.params();

        // Build a climate snapshot that overrides the water / ice fractions
        // with the user-authored sea level + ice-latitude sliders. Detail
        // renderer reads the same fields, so the two views stay in sync.
        let mut climate = planet.climate;
        let water = params.sea_level.clamp(0.0, 1.0);
        climate.liquid_water_fraction = water;
        climate.ice_fraction = (1.0 - params.ice_latitude).clamp(0.0, 1.0);
        climate.aridity = (1.0 - water).clamp(0.0, 1.0);
        // Mix the climate mean toward the UWP's implied temperature so the
        // surface bands track when the user pulls the planet hot or cold.
        // Modest weight - the model is still mostly stellar-flux driven.
        climate.mean_surface_temp_k = surface_map::effective_surface_mean_temp_k(
            climate.mean_surface_temp_k,
            params.atmosphere_density,
        );
        // Surface-map settlement count keys off habitability; ensure a
        // populated UWP shows cities even when the climate fallback gave
        // a zero score. population_intensity comes from the UWP pop digit
        // via the visual mapping, so this stays correct when the user
        // edits Pop in the panel.
        if params.population_intensity > 0.0 {
            climate.habitability = climate
                .habitability
                .max((params.population_intensity * 0.85).clamp(0.0, 1.0));
        }
        let map = surface_map::generate_with_bake_input(
            planet,
            &climate,
            params.seed,
            surface_prebake::BakeInput {
                seed: params.seed,
                water_fraction: water,
                ice_latitude: params.ice_latitude,
                mean_temp_k: climate.mean_surface_temp_k,
                vegetation_richness: params.vegetation_richness,
                lon_cells: surface_prebake::PREBAKE_LON as u32,
                lat_cells: surface_prebake::PREBAKE_LAT as u32,
            },
        );
        serde_wasm_bindgen::to_value(&map).map_err(|e| JsValue::from_str(&e.to_string()))
    }
}

/// Subsector data is independent of the GPU renderer; expose it as
/// free-standing wasm-bindgen functions so the JS layer can request a
/// fresh grid without going through the renderer instance.

#[wasm_bindgen(js_name = generateSubsector)]
pub fn generate_subsector(seed: u32, density: f32) -> Result<JsValue, JsValue> {
    let sub = subsector::generate(seed, density);
    serde_wasm_bindgen::to_value(&sub).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Generate a full 32×40 sector (16 subsectors A–P) in one call.
#[wasm_bindgen(js_name = generateSector)]
pub fn generate_sector(seed: u32, density: f32) -> Result<JsValue, JsValue> {
    let sec = subsector::generate_sector(seed, density);
    serde_wasm_bindgen::to_value(&sec).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub struct SubsectorBuilder {
    inner: subsector::SubsectorBuilder,
}

#[wasm_bindgen(js_name = createSubsectorBuilder)]
pub fn create_subsector_builder(seed: u32, density: f32) -> SubsectorBuilder {
    SubsectorBuilder {
        inner: subsector::SubsectorBuilder::new(seed, density),
    }
}

/// Incremental builder for a full 32×40 sector (shares step/finish with the
/// subsector builder).
#[wasm_bindgen(js_name = createSectorBuilder)]
pub fn create_sector_builder(seed: u32, density: f32) -> SubsectorBuilder {
    SubsectorBuilder {
        inner: subsector::SubsectorBuilder::new_sector(seed, density),
    }
}

#[wasm_bindgen(js_name = stepSubsectorBuilder)]
pub fn step_subsector_builder(builder: &mut SubsectorBuilder, max_cells: u32) -> bool {
    builder.inner.step(max_cells.max(1) as usize)
}

#[wasm_bindgen(js_name = finishSubsectorBuilder)]
pub fn finish_subsector_builder(builder: SubsectorBuilder) -> Result<JsValue, JsValue> {
    let sub = builder.inner.finish();
    serde_wasm_bindgen::to_value(&sub).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Surface map generation for a single planet without a live renderer.
/// Used by the compute worker so heavy pre-bake work stays off the UI thread.
#[wasm_bindgen(js_name = generateSurfaceMapFromPlanet)]
pub fn generate_surface_map_from_planet(
    planet: JsValue,
    seed: u32,
    sea_level: f32,
    ice_latitude: f32,
    vegetation_richness: f32,
    population_intensity: f32,
) -> Result<JsValue, JsValue> {
    let planet: system::Planet = serde_wasm_bindgen::from_value(planet)?;
    let mut climate = planet.climate;
    let water = sea_level.clamp(0.0, 1.0);
    climate.liquid_water_fraction = water;
    climate.ice_fraction = (1.0 - ice_latitude).clamp(0.0, 1.0);
    climate.aridity = (1.0 - water).clamp(0.0, 1.0);
    climate.mean_surface_temp_k =
        surface_map::effective_surface_mean_temp_k(climate.mean_surface_temp_k, 1.0);
    if population_intensity > 0.0 {
        climate.habitability = climate
            .habitability
            .max((population_intensity * 0.85).clamp(0.0, 1.0));
    }
    let map = surface_map::generate_with_bake_input(
        &planet,
        &climate,
        seed,
        surface_prebake::BakeInput {
            seed,
            water_fraction: water,
            ice_latitude,
            mean_temp_k: climate.mean_surface_temp_k,
            vegetation_richness,
            lon_cells: surface_prebake::PREBAKE_LON as u32,
            lat_cells: surface_prebake::PREBAKE_LAT as u32,
        },
    );
    serde_wasm_bindgen::to_value(&map).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Generate the per-seed surface pre-bake (heightmap + plate ids +
/// biome / moisture / temperature channels). Use this when only the
/// seed + water fraction are known; biome classification falls back to
/// Earth-default climate scalars and may not match a cold / hot world.
/// Prefer `generateSurfacePrebakeFull` when climate is available.
#[wasm_bindgen(js_name = generateSurfacePrebake)]
pub fn generate_surface_prebake(seed: u32, water_fraction: f32) -> Result<JsValue, JsValue> {
    let bake = surface_prebake::generate(seed, water_fraction);
    serde_wasm_bindgen::to_value(&bake).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Generate the per-seed surface pre-bake with full climate context so
/// biome classification matches what the renderer's terrain atlas
/// produces. Used by the JS surface-map background so its painted
/// biomes line up with the globe shader, even on frozen / hot worlds.
#[wasm_bindgen(js_name = generateSurfacePrebakeFull)]
pub fn generate_surface_prebake_full(
    seed: u32,
    water_fraction: f32,
    ice_latitude: f32,
    mean_temp_k: f32,
    vegetation_richness: f32,
) -> Result<JsValue, JsValue> {
    let bake = surface_prebake::generate_with(surface_prebake::BakeInput {
        seed,
        water_fraction,
        ice_latitude,
        mean_temp_k,
        vegetation_richness,
        lon_cells: surface_prebake::PREBAKE_LON as u32,
        lat_cells: surface_prebake::PREBAKE_LAT as u32,
    });
    serde_wasm_bindgen::to_value(&bake).map_err(|e| JsValue::from_str(&e.to_string()))
}
