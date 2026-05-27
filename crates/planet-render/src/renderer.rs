use bytemuck::Zeroable;
use web_sys::HtmlCanvasElement;

use crate::camera::Camera;
use crate::gpu;
use crate::params::PlanetParams;
use crate::scenes::{detail as detail_scene, system as system_scene};
use crate::system::{generate as generate_system, SolarSystem};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ViewMode {
    /// Existing detail render — single planet, cubesphere mesh, atmosphere pass.
    Detail,
    /// New system overview — star at origin, planets on circular orbits.
    System,
}

pub struct Renderer {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,

    planet_pipeline: wgpu::RenderPipeline,
    background_pipeline: wgpu::RenderPipeline,
    atmosphere_pipeline: wgpu::RenderPipeline,
    system_pipeline: wgpu::RenderPipeline,

    detail_mesh: detail_scene::DetailMesh,
    mesh_quality: f32,
    active_mesh_resolution: u32,
    terrain_bind_group_layout: wgpu::BindGroupLayout,
    terrain_atlas: detail_scene::TerrainAtlas,

    uniform_buffer: wgpu::Buffer,
    uniforms_bind_group: wgpu::BindGroup,

    system_uniform_buffer: wgpu::Buffer,
    system_bind_group: wgpu::BindGroup,

    scene_view: wgpu::TextureView,
    scene_sampler: wgpu::Sampler,
    atmosphere_bind_group_layout: wgpu::BindGroupLayout,
    atmosphere_bind_group: wgpu::BindGroup,

    depth_view: wgpu::TextureView,

    camera: Camera,
    params: PlanetParams,
    rotation_t: f32,
    last_time: f32,

    view_mode: ViewMode,
    system: SolarSystem,

    // Detail-uniform cache. The full struct only needs rebuilding when
    // params, camera, or canvas size change; per-frame work then patches
    // the model matrix + time field via `detail_scene::patch_frame_dynamics`.
    detail_uniforms_cache: detail_scene::DetailUniforms,
    detail_uniforms_dirty: bool,
}

impl Renderer {
    #[cfg(not(target_arch = "wasm32"))]
    pub async fn new(canvas: HtmlCanvasElement, mesh_quality: f32) -> Result<Self, String> {
        let _ = (canvas, mesh_quality);
        Err("planet-render only supports browser WebGPU canvas surfaces on wasm32".to_string())
    }

    #[cfg(target_arch = "wasm32")]
    pub async fn new(canvas: HtmlCanvasElement, mesh_quality: f32) -> Result<Self, String> {
        let gpu::GpuContext {
            surface,
            device,
            queue,
            config,
        } = gpu::create_context(canvas).await?;
        let width = config.width;
        let height = config.height;
        let format = config.format;

        let detail_mesh = detail_scene::create_mesh_buffers(&device, mesh_quality);
        let active_mesh_resolution = detail_scene::mesh_resolution(mesh_quality);

        // Uniforms
        let uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("uniforms"),
            size: std::mem::size_of::<detail_scene::DetailUniforms>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let uniforms_layout = gpu::create_uniform_layout(&device);

        let uniforms_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("uniforms_bind_group"),
            layout: &uniforms_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            }],
        });

        let system_resources = system_scene::create_resources(&device);
        let pipelines = gpu::create_pipelines(
            &device,
            format,
            &uniforms_layout,
            &system_resources.bind_group_layout,
        );
        let initial_params = PlanetParams::default();
        // Initial atlas paint uses an Earth-default climate — the JS
        // layer updates params + system as soon as it knows the user's
        // selected world, which triggers a rebuild with the real
        // mean_surface_temp_k.
        let terrain_atlas = detail_scene::create_terrain_atlas(
            &device,
            &queue,
            &pipelines.terrain_bind_group_layout,
            &initial_params,
            288.0,
        );

        let depth_view = detail_scene::create_depth_view(&device, width, height);
        let scene_view = detail_scene::create_scene_view(&device, width, height);
        let scene_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("scene_sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Nearest,
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            ..Default::default()
        });
        let atmosphere_bind_group = detail_scene::create_atmosphere_bind_group(
            &device,
            &pipelines.atmosphere_bind_group_layout,
            &scene_view,
            &scene_sampler,
            &depth_view,
        );

        let mut camera = Camera::new(width as f32 / height as f32);
        camera.distance = detail_scene::camera_fit_distance(
            camera.distance,
            PlanetParams::default().planet_radius,
            camera.aspect,
            camera.fov_y,
        );

        // Seed the system with a default G-class+ system (seed 1337) so the
        // System view has something to display before the JS layer hands us a
        // real system. The buffer is also pre-populated so the first render
        // doesn't read uninitialised memory.
        let initial_system = generate_system(1337);
        let initial_system_uniforms = system_scene::uniforms_for(&initial_system, 0.0);
        let queue_for_init = &queue;
        queue_for_init.write_buffer(
            &system_resources.uniform_buffer,
            0,
            bytemuck::bytes_of(&initial_system_uniforms),
        );

        Ok(Self {
            surface,
            device,
            queue,
            config,
            planet_pipeline: pipelines.planet,
            background_pipeline: pipelines.background,
            atmosphere_pipeline: pipelines.atmosphere,
            system_pipeline: pipelines.system,
            detail_mesh,
            mesh_quality,
            active_mesh_resolution,
            terrain_bind_group_layout: pipelines.terrain_bind_group_layout,
            terrain_atlas,
            uniform_buffer,
            uniforms_bind_group,
            system_uniform_buffer: system_resources.uniform_buffer,
            system_bind_group: system_resources.bind_group,
            scene_view,
            scene_sampler,
            atmosphere_bind_group_layout: pipelines.atmosphere_bind_group_layout,
            atmosphere_bind_group,
            depth_view,
            camera,
            params: initial_params,
            rotation_t: 0.0,
            last_time: 0.0,
            view_mode: ViewMode::Detail,
            system: initial_system,
            detail_uniforms_cache: detail_scene::DetailUniforms::zeroed(),
            detail_uniforms_dirty: true,
        })
    }

    pub fn set_params(&mut self, params: PlanetParams) {
        let previous_uses_terrain = self.params.body_visual_mode < 0.5;
        let next_uses_terrain = params.body_visual_mode < 0.5;
        let terrain_changed = next_uses_terrain
            && (!previous_uses_terrain
                || self.params.seed != params.seed
                || (self.params.sea_level - params.sea_level).abs() > f32::EPSILON
                || (self.params.ice_latitude - params.ice_latitude).abs() > f32::EPSILON
                || (self.params.vegetation_richness - params.vegetation_richness).abs()
                    > f32::EPSILON
                || (self.params.surface_temp_k - params.surface_temp_k).abs() > f32::EPSILON
                || (self.params.render_quality - params.render_quality).abs() > f32::EPSILON);
        self.params = params;
        if terrain_changed {
            self.rebuild_terrain_atlas();
        }
        self.detail_uniforms_dirty = true;
    }

    /// Look up the main world's mean surface temperature from the
    /// current system. Falls back to Earth-default if no main world is
    /// resolvable. Used to drive biome classification on the globe so
    /// frozen / hot worlds get the right colour palette.
    fn current_mean_temp_k(&self) -> f32 {
        if self.params.surface_temp_k.is_finite() && self.params.surface_temp_k > 0.0 {
            return crate::domain::surface_map::effective_surface_mean_temp_k(
                self.params.surface_temp_k,
                self.params.atmosphere_density,
            );
        }
        let idx = self.system.main_world;
        if idx < 0 {
            return 288.0;
        }
        let base = self
            .system
            .planets
            .get(idx as usize)
            .map(|p| p.climate.mean_surface_temp_k)
            .unwrap_or(288.0);
        crate::domain::surface_map::effective_surface_mean_temp_k(
            base,
            self.params.atmosphere_density,
        )
    }

    fn rebuild_terrain_atlas(&mut self) {
        self.terrain_atlas = detail_scene::create_terrain_atlas(
            &self.device,
            &self.queue,
            &self.terrain_bind_group_layout,
            &self.params,
            self.current_mean_temp_k(),
        );
    }

    pub fn set_mesh_quality(&mut self, mesh_quality: f32) {
        self.mesh_quality = mesh_quality;
        self.active_mesh_resolution = 0;
        self.ensure_detail_mesh();
    }

    fn ensure_detail_mesh(&mut self) {
        if self.view_mode != ViewMode::Detail || self.params.body_visual_mode >= 0.5 {
            return;
        }
        let resolution = detail_scene::mesh_resolution_for_view(
            self.mesh_quality,
            self.camera.distance,
            self.params.planet_radius,
        );
        if resolution == self.active_mesh_resolution {
            return;
        }
        self.active_mesh_resolution = resolution;
        self.detail_mesh =
            detail_scene::create_mesh_buffers_with_resolution(&self.device, resolution);
    }

    pub fn set_view_mode(&mut self, mode: ViewMode) {
        let mode_changed = self.view_mode != mode;
        self.view_mode = mode;
        // Snap the camera to the target distance when entering Detail.
        // camera_fit_distance preserves zoom-out (it's a minimum), but
        // for cross-world navigation we want to RESET so a small
        // planet doesn't render as a dot just because the previous
        // camera was zoomed out for a big planet.
        match mode {
            ViewMode::Detail => {
                self.camera.distance = detail_scene::camera_target_distance_for_body(
                    self.params.planet_radius,
                    self.params.body_visual_mode,
                    self.camera.aspect,
                    self.camera.fov_y,
                );
                self.ensure_detail_mesh();
            }
            ViewMode::System => {
                if mode_changed {
                    self.camera.distance = self.system_camera_fit_distance();
                }
            }
        }
        if mode_changed {
            self.detail_uniforms_dirty = true;
        }
    }

    pub fn set_system_seed(&mut self, seed: u32) {
        self.system = generate_system(seed);
        // Refit the camera if we're already looking at the system, and
        // rebuild the terrain atlas so the new main world's climate
        // drives biome classification.
        if self.view_mode == ViewMode::System {
            self.camera.distance = self.system_camera_fit_distance();
        }
        self.rebuild_terrain_atlas();
    }

    fn system_camera_fit_distance(&self) -> f32 {
        system_scene::camera_fit_distance(&self.system)
    }

    pub fn system(&self) -> &SolarSystem {
        &self.system
    }

    /// Current authored planet parameters - exposed so the WASM layer can
    /// derive UI-state-dependent surfaces (Surface map water/ice fractions)
    /// from the same source the detail shader uses.
    pub fn params(&self) -> &PlanetParams {
        &self.params
    }

    /// Project a canvas pixel to NDC and pick the system body underneath
    /// it. Returns the planet index or `None`. The view-mode gate lives
    /// in the JS layer; the renderer happily picks even when detail view
    /// is showing because the underlying math is cheap.
    pub fn pick_system_planet(&self, canvas_x: f32, canvas_y: f32, time: f32) -> Option<u32> {
        let w = self.config.width as f32;
        let h = self.config.height as f32;
        if w <= 0.0 || h <= 0.0 {
            return None;
        }
        let ndc_x = (canvas_x / w) * 2.0 - 1.0;
        // Canvas y is top-down; NDC y is bottom-up.
        let ndc_y = 1.0 - (canvas_y / h) * 2.0;
        let view_proj = self.camera.view_proj();
        let cam = self.camera.position();
        system_scene::pick_planet(&self.system, time, view_proj, cam, ndc_x, ndc_y)
            .map(|hit| hit.index as u32)
    }

    pub fn pick_system_body(
        &self,
        canvas_x: f32,
        canvas_y: f32,
        time: f32,
    ) -> Option<system_scene::PickHit> {
        let w = self.config.width as f32;
        let h = self.config.height as f32;
        if w <= 0.0 || h <= 0.0 {
            return None;
        }
        let ndc_x = (canvas_x / w) * 2.0 - 1.0;
        let ndc_y = 1.0 - (canvas_y / h) * 2.0;
        let view_proj = self.camera.view_proj();
        let cam = self.camera.position();
        system_scene::pick_body(&self.system, time, view_proj, cam, ndc_x, ndc_y)
    }

    /// Reroll a single planet's surface seed in place. Orbit, body class,
    /// mass, moons, and other physical properties stay the same; only seeded
    /// procedural surface detail changes. Future physical mutation methods
    /// should also refresh climate through the same helper. No-op if `idx` is
    /// out of range.
    pub fn reroll_planet(&mut self, idx: u32, new_seed: u32) {
        let i = idx as usize;
        if i >= self.system.planets.len() {
            return;
        }
        self.system.planets[i].seed = new_seed;
        crate::system::recompute_planet_climate(&mut self.system.planets[i]);
        // If the main world was rerolled, the biome classification on
        // the globe needs to reflect the new climate. Cheap (LRU
        // catches identical inputs) so refresh unconditionally.
        if self.system.main_world == idx as i32 {
            self.rebuild_terrain_atlas();
        }
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        if width == self.config.width && height == self.config.height {
            return;
        }
        self.config.width = width;
        self.config.height = height;
        self.surface.configure(&self.device, &self.config);
        self.depth_view = detail_scene::create_depth_view(&self.device, width, height);
        self.scene_view = detail_scene::create_scene_view(&self.device, width, height);
        self.atmosphere_bind_group = detail_scene::create_atmosphere_bind_group(
            &self.device,
            &self.atmosphere_bind_group_layout,
            &self.scene_view,
            &self.scene_sampler,
            &self.depth_view,
        );
        self.camera.aspect = width as f32 / height as f32;
        if self.view_mode == ViewMode::Detail {
            self.camera.distance = detail_scene::camera_fit_distance_for_body(
                self.camera.distance,
                self.params.planet_radius,
                self.params.body_visual_mode,
                self.camera.aspect,
                self.camera.fov_y,
            );
            self.ensure_detail_mesh();
        }
        self.detail_uniforms_dirty = true;
    }

    pub fn drag(&mut self, dx: f32, dy: f32) {
        self.camera.orbit(dx * 0.005, dy * 0.005);
        self.detail_uniforms_dirty = true;
    }

    /// Orient the globe so the requested surface (lat, lon) sits at the
    /// centre of the detail-view frame. Pauses the auto-rotation so the
    /// chosen point doesn't drift past, then sets `rotation_t` to the
    /// camera's reported spin offset.
    pub fn point_at_surface(&mut self, lat_deg: f32, lon_deg: f32) {
        let spin = self.camera.point_at(lat_deg, lon_deg);
        self.rotation_t = spin;
        self.params.auto_rotate = 0.0;
        self.detail_uniforms_dirty = true;
    }

    pub fn zoom(&mut self, delta: f32) {
        match self.view_mode {
            ViewMode::Detail => {
                self.camera.dolly(delta, self.params.planet_radius);
                self.ensure_detail_mesh();
            }
            ViewMode::System => {
                // In system view we want a much larger zoom range — the camera
                // must accommodate seeing a single planet up close (~0.1 scene
                // units) AND the full compressed outermost orbit.
                let fit = self.system_camera_fit_distance();
                self.camera.distance = (self.camera.distance * (1.0 + delta * 0.0015))
                    .clamp(0.10, (fit * 3.5).max(20.0));
            }
        }
        self.detail_uniforms_dirty = true;
    }

    pub fn render(&mut self, time: f32) -> Result<(), String> {
        let dt = if self.last_time == 0.0 {
            0.0
        } else {
            (time - self.last_time).clamp(0.0, 0.1)
        };
        self.last_time = time;
        self.rotation_t += dt * self.params.auto_rotate;

        if self.view_mode == ViewMode::Detail {
            self.ensure_detail_mesh();
        }

        if self.detail_uniforms_dirty {
            self.detail_uniforms_cache = detail_scene::uniforms_for(
                &self.params,
                &self.camera,
                time,
                self.rotation_t,
                self.config.width,
                self.config.height,
                self.terrain_atlas.sea_level_threshold,
            );
            self.detail_uniforms_dirty = false;
        } else {
            detail_scene::patch_frame_dynamics(
                &mut self.detail_uniforms_cache,
                &self.params,
                self.rotation_t,
                time,
            );
        }
        self.queue.write_buffer(
            &self.uniform_buffer,
            0,
            bytemuck::bytes_of(&self.detail_uniforms_cache),
        );

        let frame = match self.surface.get_current_texture() {
            Ok(frame) => frame,
            Err(wgpu::SurfaceError::Timeout) => return Ok(()),
            Err(
                wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated | wgpu::SurfaceError::Other,
            ) => {
                self.surface.configure(&self.device, &self.config);
                return Ok(());
            }
            Err(wgpu::SurfaceError::OutOfMemory) => {
                return Err("get_current_texture: out of memory".to_string());
            }
        };
        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("frame_encoder"),
            });

        match self.view_mode {
            ViewMode::Detail => {
                detail_scene::encode_render(
                    &mut encoder,
                    &view,
                    detail_scene::DetailRenderPass {
                        background_pipeline: &self.background_pipeline,
                        planet_pipeline: &self.planet_pipeline,
                        atmosphere_pipeline: &self.atmosphere_pipeline,
                        vertex_buffer: &self.detail_mesh.vertex_buffer,
                        index_buffer: &self.detail_mesh.index_buffer,
                        num_indices: self.detail_mesh.num_indices,
                        uniforms_bind_group: &self.uniforms_bind_group,
                        terrain_bind_group: &self.terrain_atlas.bind_group,
                        atmosphere_bind_group: &self.atmosphere_bind_group,
                        scene_view: &self.scene_view,
                        depth_view: &self.depth_view,
                    },
                );
            }
            ViewMode::System => {
                // Push the latest system layout (planet positions move every
                // frame as orbits advance).
                let sys_u = system_scene::uniforms_for(&self.system, time);
                self.queue
                    .write_buffer(&self.system_uniform_buffer, 0, bytemuck::bytes_of(&sys_u));
                system_scene::encode_render(
                    &mut encoder,
                    &view,
                    &self.system_pipeline,
                    &self.uniforms_bind_group,
                    &self.system_bind_group,
                );
            }
        }

        self.queue.submit(std::iter::once(encoder.finish()));
        frame.present();
        Ok(())
    }
}
