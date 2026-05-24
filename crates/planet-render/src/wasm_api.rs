use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;

use crate::domain::{subsector, surface_map, surface_prebake};
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

    /// Orient the detail view's globe so the requested surface coordinates
    /// (lat/lon in degrees) sit at the centre of the frame. Stops the
    /// auto-rotation so the hex doesn't drift past while the user looks.
    #[wasm_bindgen(js_name = pointAtSurface)]
    pub fn point_at_surface(&mut self, lat_deg: f32, lon_deg: f32) {
        self.inner.point_at_surface(lat_deg, lon_deg);
    }

    /// Generate a Cepheus-style hex world map for the main world of the
    /// current system. Returns the serialised SurfaceMap or null if the
    /// system has no qualifying main world.
    #[wasm_bindgen(js_name = getSurfaceMap)]
    pub fn get_surface_map(&self) -> Result<JsValue, JsValue> {
        let system = self.inner.system();
        if system.main_world < 0 {
            return Ok(JsValue::NULL);
        }
        let planet = &system.planets[system.main_world as usize];
        let map = surface_map::generate(planet, &planet.climate, planet.seed);
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

/// Generate the per-seed surface pre-bake (heightmap + plate ids).
/// Future shader integration can sample this for the globe surface so
/// the rendered planet and the surface hex map agree on continents.
/// Today it is consumed by `surface_map::generate` (Rust-side).
#[wasm_bindgen(js_name = generateSurfacePrebake)]
pub fn generate_surface_prebake(seed: u32, water_fraction: f32) -> Result<JsValue, JsValue> {
    let bake = surface_prebake::generate(seed, water_fraction);
    serde_wasm_bindgen::to_value(&bake).map_err(|e| JsValue::from_str(&e.to_string()))
}
