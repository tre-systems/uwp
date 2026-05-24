#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code, unused_imports))]

use wasm_bindgen::prelude::*;

mod camera;
mod domain;
mod gpu;
mod mesh;
mod params;
mod renderer;
mod scenes;
mod shader;
pub(crate) use domain::system;
mod wasm_api;
pub use wasm_api::Planet;

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
    let _ = console_log::init_with_level(log::Level::Info);
}
