use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Quat, Vec3};
use web_sys::HtmlCanvasElement;
use wgpu::util::DeviceExt;

use crate::camera::Camera;
use crate::mesh::{cubesphere, Vertex};
use crate::params::PlanetParams;
use crate::shader::shader_with_common;
use crate::system::{generate as generate_system, BodyType, SolarSystem};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ViewMode {
    /// Existing detail render — single planet, cubesphere mesh, atmosphere pass.
    Detail,
    /// New system overview — star at origin, planets on circular orbits.
    System,
}

const MAX_SYSTEM_PLANETS: usize = 16;
const MAX_SYSTEM_MOONS: usize = 32;
const MAX_SYSTEM_BELTS: usize = 4;
const SCENE_UNITS_PER_AU: f32 = 1.0;

const PLANET_RES: u32 = 200;

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

const SCENE_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;

/// Packed system data for the system shader. Tightly packed for transfer
/// efficiency — the shader unpacks back into its own struct view.
///
///   planets[2i  ]: xyz = world position, w = display radius
///   planets[2i+1]: xyz = base colour,    w = orbital radius (scene units)
///   moons[i]     : xyz = world position, w = display radius
///   belts[i]     : x = inner_au, y = outer_au, z = density [0..1], w = unused
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, Default)]
struct SystemUniforms {
    /// x = planet count, y = star display radius, z = star colour intensity,
    /// w = moon count.
    info: [f32; 4],
    /// xyz = star colour, w = belt count.
    star_color: [f32; 4],
    planets: [[f32; 4]; MAX_SYSTEM_PLANETS * 2],
    moons: [[f32; 4]; MAX_SYSTEM_MOONS],
    belts: [[f32; 4]; MAX_SYSTEM_BELTS],
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
        let width = canvas.width().max(1);
        let height = canvas.height().max(1);

        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::BROWSER_WEBGPU,
            ..Default::default()
        });

        let surface = instance
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
            .map_err(|e| format!("create_surface: {e}"))?;

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                force_fallback_adapter: false,
                compatible_surface: Some(&surface),
            })
            .await
            .ok_or_else(|| {
                "No suitable GPU adapter found. This browser may not support WebGPU.".to_string()
            })?;

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("planet-render-device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::default(),
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await
            .map_err(|e| format!("request_device: {e}"))?;

        let caps = surface.get_capabilities(&adapter);
        let format = caps
            .formats
            .iter()
            .copied()
            .find(wgpu::TextureFormat::is_srgb)
            .unwrap_or(caps.formats[0]);
        let alpha_mode = caps.alpha_modes[0];

        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width,
            height,
            present_mode: wgpu::PresentMode::AutoVsync,
            alpha_mode,
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);

        // Mesh
        let mesh = cubesphere(mesh_resolution(mesh_quality));
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

        let uniforms_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("uniforms_layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });

        let uniforms_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("uniforms_bind_group"),
            layout: &uniforms_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            }],
        });

        let scene_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("scene_layout"),
            bind_group_layouts: &[&uniforms_layout],
            push_constant_ranges: &[],
        });

        // Bind group used by the atmosphere pass to sample the scene HDR target.
        let atmosphere_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("atmosphere_layout"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: true },
                            view_dimension: wgpu::TextureViewDimension::D2,
                            multisampled: false,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 2,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Depth,
                            view_dimension: wgpu::TextureViewDimension::D2,
                            multisampled: false,
                        },
                        count: None,
                    },
                ],
            });

        let atmosphere_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("atmosphere_pipeline_layout"),
            bind_group_layouts: &[&uniforms_layout, &atmosphere_bind_group_layout],
            push_constant_ranges: &[],
        });

        // System overview: one extra uniform block packed with star + planet
        // positions/colours.
        let system_uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("system_uniforms"),
            size: std::mem::size_of::<SystemUniforms>() as u64,
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
        let system_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("system_pipeline_layout"),
            bind_group_layouts: &[&uniforms_layout, &system_uniform_layout],
            push_constant_ranges: &[],
        });

        // Shaders
        let planet_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("planet.wgsl"),
            source: shader_with_common(include_str!("shaders/planet.wgsl")),
        });
        let background_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("background.wgsl"),
            source: shader_with_common(include_str!("shaders/background.wgsl")),
        });
        let atmosphere_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("atmosphere.wgsl"),
            source: shader_with_common(include_str!("shaders/atmosphere.wgsl")),
        });
        let system_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("system.wgsl"),
            source: shader_with_common(include_str!("shaders/system.wgsl")),
        });

        let vertex_layout = wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Vertex>() as u64,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &[wgpu::VertexAttribute {
                offset: 0,
                shader_location: 0,
                format: wgpu::VertexFormat::Float32x3,
            }],
        };

        let planet_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("planet_pipeline"),
            layout: Some(&scene_layout),
            vertex: wgpu::VertexState {
                module: &planet_shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[vertex_layout],
            },
            fragment: Some(wgpu::FragmentState {
                module: &planet_shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: SCENE_FORMAT,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: Some(wgpu::Face::Back),
                polygon_mode: wgpu::PolygonMode::Fill,
                unclipped_depth: false,
                conservative: false,
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: true,
                depth_compare: wgpu::CompareFunction::Less,
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        let background_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("background_pipeline"),
            layout: Some(&scene_layout),
            vertex: wgpu::VertexState {
                module: &background_shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &background_shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: SCENE_FORMAT,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                polygon_mode: wgpu::PolygonMode::Fill,
                unclipped_depth: false,
                conservative: false,
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth32Float,
                // Background now writes per-pixel depth for raymarched
                // moons / rings / satellites so the planet mesh occludes them
                // correctly (and they occlude each other).
                depth_write_enabled: true,
                depth_compare: wgpu::CompareFunction::Always,
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        // System pipeline: fullscreen triangle, writes directly to swapchain
        // (does its own tonemap). No depth attachment — the shader composites
        // background + star + planets internally via ray-sphere tests.
        let system_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("system_pipeline"),
            layout: Some(&system_layout),
            vertex: wgpu::VertexState {
                module: &system_shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &system_shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                polygon_mode: wgpu::PolygonMode::Fill,
                unclipped_depth: false,
                conservative: false,
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        // Atmosphere pipeline: fullscreen triangle, samples the HDR scene target.
        let atmosphere_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("atmosphere_pipeline"),
            layout: Some(&atmosphere_layout),
            vertex: wgpu::VertexState {
                module: &atmosphere_shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &atmosphere_shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                polygon_mode: wgpu::PolygonMode::Fill,
                unclipped_depth: false,
                conservative: false,
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        let depth_view = create_depth_view(&device, width, height);
        let scene_view = create_scene_view(&device, width, height);
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
        let atmosphere_bind_group = create_atmosphere_bind_group(
            &device,
            &atmosphere_bind_group_layout,
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
        let initial_system_uniforms = system_uniforms_for(&initial_system, 0.0);
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
            planet_pipeline,
            background_pipeline,
            atmosphere_pipeline,
            system_pipeline,
            vertex_buffer,
            index_buffer,
            num_indices,
            uniform_buffer,
            uniforms_bind_group,
            system_uniform_buffer,
            system_bind_group,
            scene_view,
            scene_sampler,
            atmosphere_bind_group_layout,
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
                // Fit the outermost orbit comfortably in frame.
                let outer = self
                    .system
                    .planets
                    .last()
                    .map(|p| p.orbit_au * SCENE_UNITS_PER_AU)
                    .unwrap_or(5.0);
                self.camera.distance = (outer * 1.6).max(3.0);
            }
        }
    }

    pub fn view_mode(&self) -> ViewMode {
        self.view_mode
    }

    pub fn set_system_seed(&mut self, seed: u32) {
        self.system = generate_system(seed);
        // If we're currently in system view, refit the camera to the new outer
        // orbit so swapping systems doesn't leave us looking at empty space.
        if self.view_mode == ViewMode::System {
            let outer = self
                .system
                .planets
                .last()
                .map(|p| p.orbit_au * SCENE_UNITS_PER_AU)
                .unwrap_or(5.0);
            self.camera.distance = (outer * 1.6).max(3.0);
        }
    }

    pub fn system(&self) -> &SolarSystem {
        &self.system
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        if width == self.config.width && height == self.config.height {
            return;
        }
        self.config.width = width;
        self.config.height = height;
        self.surface.configure(&self.device, &self.config);
        self.depth_view = create_depth_view(&self.device, width, height);
        self.scene_view = create_scene_view(&self.device, width, height);
        self.atmosphere_bind_group = create_atmosphere_bind_group(
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
                // units) AND the full outermost orbit (potentially 80+ AU).
                let outer = self
                    .system
                    .planets
                    .last()
                    .map(|p| p.orbit_au * SCENE_UNITS_PER_AU)
                    .unwrap_or(5.0);
                self.camera.distance = (self.camera.distance * (1.0 + delta * 0.0015))
                    .clamp(0.10, (outer * 4.0).max(20.0));
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
                self.encode_detail_render(&mut encoder, &view);
            }
            ViewMode::System => {
                // Push the latest system layout (planet positions move every
                // frame as orbits advance).
                let sys_u = system_uniforms_for(&self.system, time);
                self.queue.write_buffer(
                    &self.system_uniform_buffer,
                    0,
                    bytemuck::bytes_of(&sys_u),
                );
                self.encode_system_render(&mut encoder, &view);
            }
        }

        self.queue.submit(std::iter::once(encoder.finish()));
        frame.present();
        Ok(())
    }

    fn encode_detail_render(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        view: &wgpu::TextureView,
    ) {
        // Pass 1: render planet + background into the HDR scene texture.
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("scene_pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.scene_view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            pass.set_pipeline(&self.background_pipeline);
            pass.set_bind_group(0, &self.uniforms_bind_group, &[]);
            pass.draw(0..3, 0..1);

            pass.set_pipeline(&self.planet_pipeline);
            pass.set_bind_group(0, &self.uniforms_bind_group, &[]);
            pass.set_vertex_buffer(0, self.vertex_buffer.slice(..));
            pass.set_index_buffer(self.index_buffer.slice(..), wgpu::IndexFormat::Uint32);
            pass.draw_indexed(0..self.num_indices, 0, 0..1);
        }

        // Pass 2: raymarched atmosphere + tonemap, samples scene_view and writes the swapchain.
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("atmosphere_pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            pass.set_pipeline(&self.atmosphere_pipeline);
            pass.set_bind_group(0, &self.uniforms_bind_group, &[]);
            pass.set_bind_group(1, &self.atmosphere_bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
    }

    fn encode_system_render(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        view: &wgpu::TextureView,
    ) {
        // Single fullscreen pass directly to swapchain. The system shader
        // does its own raymarched composite + tonemap.
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("system_pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
        });
        pass.set_pipeline(&self.system_pipeline);
        pass.set_bind_group(0, &self.uniforms_bind_group, &[]);
        pass.set_bind_group(1, &self.system_bind_group, &[]);
        pass.draw(0..3, 0..1);
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

fn create_depth_view(device: &wgpu::Device, width: u32, height: u32) -> wgpu::TextureView {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("depth"),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Depth32Float,
        // TEXTURE_BINDING so the atmosphere pass can sample depth and cap
        // its scattering integration at the nearest opaque scene object
        // (otherwise scattering bleeds onto moons in front of the atmosphere).
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });
    texture.create_view(&wgpu::TextureViewDescriptor::default())
}

fn create_scene_view(device: &wgpu::Device, width: u32, height: u32) -> wgpu::TextureView {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("scene_hdr"),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: SCENE_FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });
    texture.create_view(&wgpu::TextureViewDescriptor::default())
}

fn create_atmosphere_bind_group(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    view: &wgpu::TextureView,
    sampler: &wgpu::Sampler,
    depth_view: &wgpu::TextureView,
) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("atmosphere_bind_group"),
        layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(view),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::Sampler(sampler),
            },
            wgpu::BindGroupEntry {
                binding: 2,
                resource: wgpu::BindingResource::TextureView(depth_view),
            },
        ],
    })
}

fn vec3_to_v4(c: [f32; 3]) -> [f32; 4] {
    [c[0], c[1], c[2], 1.0]
}

/// Visual radius for a planet rendered in system view. Real planets at AU
/// scale would be sub-pixel against the star; we exaggerate them — but
/// always keep them visibly smaller than the star itself (so a gas giant
/// can't transit and eclipse the whole star in the overview).
///
/// `system_scale` is a per-system unit length (typically the outermost
/// orbit radius in scene units) — we size bodies as a fraction of that
/// so compact M-dwarf systems and big G-star systems both stay readable.
fn display_radius_for(body: BodyType, real_radius_earth: f32, system_scale: f32) -> f32 {
    // Base: a small fraction of the system's overall scale, with a sublinear
    // dependence on real radius so a 14 R⊕ gas giant only reads ~3× bigger
    // than a 1 R⊕ terrestrial (rather than 14× — which would dwarf the star).
    let real_factor = real_radius_earth.max(0.3).powf(0.30);
    let mult = match body {
        BodyType::GasGiant => 1.8,
        BodyType::IceGiant => 1.4,
        BodyType::MiniNeptune => 1.2,
        BodyType::SuperEarth => 1.0,
        BodyType::Terrestrial => 0.9,
        BodyType::Inferno => 0.8,
        BodyType::Frozen => 0.8,
        BodyType::Rocky => 0.7,
    };
    let scale_unit = system_scale.max(0.5);
    (scale_unit * 0.012 * real_factor * mult).max(0.008)
}

/// Schematic colour for a body in system view. The detail-render planet
/// shader produces the textured surface — at system scale we just want a
/// solid tint that conveys body class.
fn schematic_color_for(body: BodyType, in_hz: bool) -> [f32; 3] {
    match body {
        BodyType::GasGiant => [0.86, 0.74, 0.55],   // pale gold (Jupiter)
        BodyType::IceGiant => [0.47, 0.63, 0.85],   // pale cyan (Neptune)
        BodyType::MiniNeptune => [0.55, 0.70, 0.88],
        BodyType::SuperEarth => {
            if in_hz {
                [0.40, 0.65, 0.50]
            } else {
                [0.55, 0.48, 0.40]
            }
        }
        BodyType::Terrestrial => {
            if in_hz {
                [0.30, 0.60, 0.85]
            } else {
                [0.55, 0.50, 0.42]
            }
        }
        BodyType::Inferno => [0.78, 0.42, 0.22],
        BodyType::Frozen => [0.78, 0.84, 0.92],
        BodyType::Rocky => [0.55, 0.50, 0.46],
    }
}

/// Build the system-view uniform buffer contents for the current system at a
/// given time. Planet positions advance along circular orbits (Kepler 3rd
/// law); moons advance around their planet at correspondingly faster rates.
fn system_uniforms_for(sys: &SolarSystem, time: f32) -> SystemUniforms {
    let mut out = SystemUniforms::default();
    let n_p = sys.planets.len().min(MAX_SYSTEM_PLANETS);

    // System scale = outermost feature (orbit or belt) reach.
    let outer_orbit = sys
        .planets
        .last()
        .map(|p| p.orbit_au * SCENE_UNITS_PER_AU)
        .unwrap_or(1.0);
    let outer_belt = sys
        .belts
        .iter()
        .map(|b| b.outer_au * SCENE_UNITS_PER_AU)
        .fold(0.0_f32, f32::max);
    let system_scale = outer_orbit.max(outer_belt).max(1.0);

    let star_disp =
        (system_scale * 0.045 * (sys.star.radius_solar.max(0.3)).powf(0.35)).max(0.04);
    let intensity = 1.4 + sys.star.luminosity_solar.powf(0.2);

    // First write all planet positions, recording them so moons can offset.
    let mut planet_positions = [[0.0f32; 3]; MAX_SYSTEM_PLANETS];
    let mut planet_disp_r = [0.0f32; MAX_SYSTEM_PLANETS];
    for (i, planet) in sys.planets.iter().take(n_p).enumerate() {
        let omega = 0.20 / planet.orbit_au.powf(1.5);
        let theta = planet.phase_rad + time * omega;
        let r = planet.orbit_au * SCENE_UNITS_PER_AU;
        let pos = [r * theta.cos(), 0.0, r * theta.sin()];
        let disp_r = display_radius_for(planet.body_type, planet.radius_earth, system_scale);
        let col = schematic_color_for(planet.body_type, planet.in_habitable_zone);
        out.planets[i * 2] = [pos[0], pos[1], pos[2], disp_r];
        out.planets[i * 2 + 1] = [col[0], col[1], col[2], r];
        planet_positions[i] = pos;
        planet_disp_r[i] = disp_r;
    }

    // Pack moons. Distribute across planets in proportion to each planet's
    // moon count, capping at MAX_SYSTEM_MOONS total. We render each moon as
    // a small dot positioned around its host planet, scaled so the orbit
    // ring is just outside the planet's display radius.
    let mut moon_idx = 0usize;
    for (i, planet) in sys.planets.iter().take(n_p).enumerate() {
        let host_pos = planet_positions[i];
        let host_r = planet_disp_r[i];
        // Cap moons rendered per planet at 6 so the dots don't pile up.
        for moon in planet.moons.iter().take(6) {
            if moon_idx >= MAX_SYSTEM_MOONS {
                break;
            }
            // Moon orbit display radius — outside the planet disc, scales
            // with the moon's orbital ring (compressed for visibility).
            let orbit_r = host_r * (1.6 + (moon.orbit_radii / 12.0).min(4.0));
            // Spin moons quickly (visible motion at default time-scale).
            let omega = 0.6 / (moon.orbit_radii).powf(1.5);
            let theta = moon.phase_rad + time * omega;
            let pos = [
                host_pos[0] + orbit_r * theta.cos(),
                host_pos[1],
                host_pos[2] + orbit_r * theta.sin(),
            ];
            let disp_r = (host_r * 0.18 * moon.radius_earth.powf(0.5)).max(0.003);
            // Encode icy vs rocky as sign of w; magnitude = display radius.
            // Shader reads abs(w) as radius, sign as icy flag.
            let w = if moon.icy { disp_r } else { -disp_r };
            out.moons[moon_idx] = [pos[0], pos[1], pos[2], w];
            moon_idx += 1;
        }
        if moon_idx >= MAX_SYSTEM_MOONS {
            break;
        }
    }

    // Pack belts.
    let n_b = sys.belts.len().min(MAX_SYSTEM_BELTS);
    for (i, belt) in sys.belts.iter().take(n_b).enumerate() {
        out.belts[i] = [
            belt.inner_au * SCENE_UNITS_PER_AU,
            belt.outer_au * SCENE_UNITS_PER_AU,
            belt.density,
            0.0,
        ];
    }

    out.info = [n_p as f32, star_disp, intensity, moon_idx as f32];
    out.star_color = [
        sys.star.color[0],
        sys.star.color[1],
        sys.star.color[2],
        n_b as f32,
    ];
    out
}

fn mesh_resolution(quality: f32) -> u32 {
    if quality < 0.55 {
        96
    } else if quality < 0.85 {
        144
    } else {
        PLANET_RES
    }
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
