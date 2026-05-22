#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code, unused_imports))]

use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;

mod camera;
mod mesh;
mod params;
mod renderer;

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
    pub async fn create(canvas: HtmlCanvasElement) -> Result<Planet, JsValue> {
        let inner = renderer::Renderer::new(canvas)
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
}
