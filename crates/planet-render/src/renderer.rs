use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Quat, Vec3};
use web_sys::HtmlCanvasElement;
use wgpu::util::DeviceExt;

use crate::camera::Camera;
use crate::gpu;
use crate::mesh::cubesphere;
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

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniforms {
    view_proj: [[f32; 4]; 4],
    inv_view_proj: [[f32; 4]; 4],
    model: [[f32; 4]; 4],
    camera_pos: [f32; 4],
    sun_dir: [f32; 4],
    ocean_color: [f32; 4],
    land_color: [f32; 4],
    mountain_color: [f32; 4],
    sand_color: [f32; 4],
    snow_color: [f32; 4],
    atmosphere_color: [f32; 4],
    /// xyz = noise seed offset, w = ice_latitude
    seed_block: [f32; 4],
    /// x = sea_level, y = mountain_amp, z = noise_freq, w = noise_octaves
    planet_params: [f32; 4],
    /// x = atmosphere_density, y = time, z = cloud_coverage, w = render_quality
    misc: [f32; 4],
    /// x = width, y = height, z = aspect, w = planet_radius
    resolution: [f32; 4],
    /// x = crater_density, y = population_intensity, z = vegetation_richness, w = atm_banding
    world_features: [f32; 4],
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

    vertex_buffer: wgpu::Buffer,
    index_buffer: wgpu::Buffer,
    num_indices: u32,

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

        // Mesh
        let mesh = cubesphere(detail_scene::mesh_resolution(mesh_quality));
        let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("vertex_buffer"),
            contents: bytemuck::cast_slice(&mesh.vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("index_buffer"),
            contents: bytemuck::cast_slice(&mesh.indices),
            usage: wgpu::BufferUsages::INDEX,
        });
        let num_indices = mesh.indices.len() as u32;

        // Uniforms
        let uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("uniforms"),
            size: std::mem::size_of::<Uniforms>() as u64,
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

        // System overview: one extra uniform block packed with star + planet
        // positions/colours.
        let system_uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("system_uniforms"),
            size: std::mem::size_of::<system_scene::SystemUniforms>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let system_uniform_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("system_uniform_layout"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                }],
            });
        let system_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("system_bind_group"),
            layout: &system_uniform_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: system_uniform_buffer.as_entire_binding(),
            }],
        });
        let pipelines =
            gpu::create_pipelines(&device, format, &uniforms_layout, &system_uniform_layout);

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
            &system_uniform_buffer,
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
            vertex_buffer,
            index_buffer,
            num_indices,
            uniform_buffer,
            uniforms_bind_group,
            system_uniform_buffer,
            system_bind_group,
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
        })
    }

    pub fn set_params(&mut self, params: PlanetParams) {
        self.params = params;
    }

    pub fn set_view_mode(&mut self, mode: ViewMode) {
        if self.view_mode == mode {
            return;
        }
        self.view_mode = mode;
        // Reset camera distance to fit whichever scene we're about to render.
        match mode {
            ViewMode::Detail => {
                self.camera.distance = self.camera.distance.clamp(
                    (self.params.planet_radius * 1.4).max(0.25),
                    self.params.planet_radius * 60.0,
                );
                if self.camera.distance > 6.0 {
                    self.camera.distance = 3.0;
                }
            }
            ViewMode::System => {
                self.camera.distance = self.system_camera_fit_distance();
            }
        }
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

    /// Reroll a single planet's surface seed in place — orbit, body class,
    /// mass etc. stay the same; the procedural surface (and moon list) are
    /// regenerated from the new seed. No-op if `idx` is out of range.
    pub fn reroll_planet(&mut self, idx: u32, new_seed: u32) {
        let i = idx as usize;
        if i >= self.system.planets.len() {
            return;
        }
        self.system.planets[i].seed = new_seed;
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
    }

    pub fn drag(&mut self, dx: f32, dy: f32) {
        self.camera.orbit(dx * 0.005, dy * 0.005);
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
    }

    pub fn render(&mut self, time: f32) -> Result<(), String> {
        let dt = if self.last_time == 0.0 {
            0.0
        } else {
            (time - self.last_time).clamp(0.0, 0.1)
        };
        self.last_time = time;
        self.rotation_t += dt * self.params.auto_rotate;

        let uniforms = self.build_uniforms(time);
        self.queue
            .write_buffer(&self.uniform_buffer, 0, bytemuck::bytes_of(&uniforms));

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
                        vertex_buffer: &self.vertex_buffer,
                        index_buffer: &self.index_buffer,
                        num_indices: self.num_indices,
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

    fn build_uniforms(&self, time: f32) -> Uniforms {
        // Spin around the planet's local Y, then apply a seed-derived tilt so
        // each world has its own axial inclination instead of standing
        // bolt-upright. Quat multiply applies right-to-left: spin first, tilt
        // wraps the result.
        let (tilt_axis, tilt_angle) = seed_to_tilt(self.params.seed);
        let tilt = Quat::from_axis_angle(tilt_axis, tilt_angle);
        let spin = Quat::from_rotation_y(self.rotation_t);
        let model = Mat4::from_quat(tilt * spin);
        let view_proj = self.camera.view_proj();
        let inv_view_proj = view_proj.inverse();
        let cam_pos = self.camera.position();

        let sun_yaw = self.params.sun_angle * std::f32::consts::TAU;
        // The UI's default/randomized angle range is authored around the viewer-facing side.
        let sun_dir = Vec3::new(-sun_yaw.cos() * 0.85, 0.32, -sun_yaw.sin() * 0.85).normalize();

        let seed = seed_offsets(self.params.seed);

        Uniforms {
            view_proj: view_proj.to_cols_array_2d(),
            inv_view_proj: inv_view_proj.to_cols_array_2d(),
            model: model.to_cols_array_2d(),
            camera_pos: [cam_pos.x, cam_pos.y, cam_pos.z, 1.0],
            sun_dir: [sun_dir.x, sun_dir.y, sun_dir.z, 0.0],
            ocean_color: vec3_to_v4(self.params.ocean_color),
            land_color: vec3_to_v4(self.params.land_color),
            mountain_color: vec3_to_v4(self.params.mountain_color),
            sand_color: vec3_to_v4(self.params.sand_color),
            snow_color: vec3_to_v4(self.params.snow_color),
            atmosphere_color: vec3_to_v4(self.params.atmosphere_color),
            seed_block: [seed[0], seed[1], seed[2], self.params.ice_latitude],
            planet_params: [
                self.params.sea_level,
                self.params.mountain_height,
                self.params.noise_frequency,
                self.params.noise_octaves as f32,
            ],
            misc: [
                self.params.atmosphere_density,
                time,
                self.params.cloud_coverage,
                self.params.render_quality.clamp(0.0, 1.0),
            ],
            resolution: [
                self.config.width as f32,
                self.config.height as f32,
                self.camera.aspect,
                self.params.planet_radius,
            ],
            world_features: [
                self.params.crater_density,
                self.params.population_intensity,
                self.params.vegetation_richness,
                self.params.atm_banding,
            ],
        }
    }
}

fn vec3_to_v4(c: [f32; 3]) -> [f32; 4] {
    [c[0], c[1], c[2], 1.0]
}

/// Derive a per-seed axial tilt (axis in the XZ plane + angle 0..~35°) so
/// each world leans in its own direction.
fn seed_to_tilt(seed: u32) -> (Vec3, f32) {
    let mut s = seed.wrapping_mul(2246822519).wrapping_add(0x9E3779B9);
    let mut h = || -> f32 {
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        ((s >> 8) as f32) / 16_777_216.0
    };
    let angle = h() * 35f32.to_radians();
    let dir = h() * std::f32::consts::TAU;
    (Vec3::new(dir.cos(), 0.0, dir.sin()), angle)
}

/// Hash a u32 seed into three independent noise offsets so each seed produces
/// a unique-looking planet.
fn seed_offsets(seed: u32) -> [f32; 3] {
    let mut s = seed.wrapping_mul(2654435761).wrapping_add(1);
    let mut out = [0.0_f32; 3];
    for o in &mut out {
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        *o = (s as f32 / u32::MAX as f32) * 1000.0 - 500.0;
    }
    out
}
