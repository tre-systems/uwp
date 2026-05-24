#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code, unused_imports))]

use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;

mod camera;
mod mesh;
mod params;
mod renderer;
mod scenes;
mod shader;
mod system;

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
    let _ = console_log::init_with_level(log::Level::Info);
}

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

    pub fn drag(&mut self, dx: f32, dy: f32) {
        self.inner.drag(dx, dy);
    }

    pub fn zoom(&mut self, delta: f32) {
        self.inner.zoom(delta);
    }

    pub fn render(&mut self, time_ms: f64) -> Result<(), JsValue> {
        // requestAnimationFrame hands us milliseconds; the renderer works in
        // seconds (so dt fits the .min(0.1) tab-switch clamp and cloud drift
        // multipliers like 0.015 read as per-second, not per-millisecond).
        self.inner
            .render((time_ms * 0.001) as f32)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Switch between the detail planet view and the system overview view.
    /// `mode` is "detail" or "system" — any other value resets to detail.
    #[wasm_bindgen(js_name = setViewMode)]
    pub fn set_view_mode(&mut self, mode: &str) {
        let m = match mode {
            "system" => renderer::ViewMode::System,
            _ => renderer::ViewMode::Detail,
        };
        self.inner.set_view_mode(m);
    }

    /// Generate a new solar system from the given seed (replaces current one).
    /// Auto-refits the system-view camera to the new outermost orbit.
    #[wasm_bindgen(js_name = setSystemSeed)]
    pub fn set_system_seed(&mut self, seed: u32) {
        self.inner.set_system_seed(seed);
    }

    /// Returns the current solar system as a JS object — used by the UI to
    /// render the planet list / starport classifications etc.
    #[wasm_bindgen(js_name = getSystem)]
    pub fn get_system(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(self.inner.system())
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Reroll one planet's surface seed in place. Orbit, body class, mass
    /// etc. stay the same; the procedural surface (and moon list when the
    /// system snapshot is re-read) regenerate from the new seed.
    #[wasm_bindgen(js_name = rerollPlanet)]
    pub fn reroll_planet(&mut self, idx: u32, new_seed: u32) {
        self.inner.reroll_planet(idx, new_seed);
    }
}
