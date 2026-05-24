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

        let camera = Camera::new(width as f32 / height as f32);

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
            params: PlanetParams::default(),
            rotation_t: 0.0,
            last_time: 0.0,
            view_mode: ViewMode::Detail,
            system: initial_system,
            detail_uniforms_cache: detail_scene::DetailUniforms::zeroed(),
            detail_uniforms_dirty: true,
        })
    }

    pub fn set_params(&mut self, params: PlanetParams) {
        self.params = params;
        self.detail_uniforms_dirty = true;
    }

    pub fn set_mesh_quality(&mut self, mesh_quality: f32) {
        self.detail_mesh = detail_scene::create_mesh_buffers(&self.device, mesh_quality);
    }

    pub fn set_view_mode(&mut self, mode: ViewMode) {
        if self.view_mode == mode {
            return;
        }
        self.view_mode = mode;
        // Reset camera distance to fit whichever scene we're about to render.
        match mode {
            ViewMode::Detail => {
                self.camera.distance = detail_scene::camera_fit_distance(
                    self.camera.distance,
                    self.params.planet_radius,
                );
            }
            ViewMode::System => {
                self.camera.distance = self.system_camera_fit_distance();
            }
        }
        self.detail_uniforms_dirty = true;
    }

    pub fn set_system_seed(&mut self, seed: u32) {
        self.system = generate_system(seed);
        // If we're currently in system view, refit the camera to the new outer
        // orbit so swapping systems doesn't leave us looking at empty space.
        if self.view_mode == ViewMode::System {
            self.camera.distance = self.system_camera_fit_distance();
        }
    }

    fn system_camera_fit_distance(&self) -> f32 {
        system_scene::camera_fit_distance(&self.system)
    }

    pub fn system(&self) -> &SolarSystem {
        &self.system
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
        // Surface noise driven by the seed; the rendered planet will look
        // different on the next frame without re-running the whole generator.
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
        self.detail_uniforms_dirty = true;
    }

    pub fn drag(&mut self, dx: f32, dy: f32) {
        self.camera.orbit(dx * 0.005, dy * 0.005);
        self.detail_uniforms_dirty = true;
    }

    pub fn zoom(&mut self, delta: f32) {
        match self.view_mode {
            ViewMode::Detail => self.camera.dolly(delta, self.params.planet_radius),
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

        if self.detail_uniforms_dirty {
            self.detail_uniforms_cache = detail_scene::uniforms_for(
                &self.params,
                &self.camera,
                time,
                self.rotation_t,
                self.config.width,
                self.config.height,
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
