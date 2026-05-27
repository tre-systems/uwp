use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Quat, Vec3};
use wgpu::util::DeviceExt;

use crate::camera::Camera;
use crate::domain::surface_prebake::{self, BakeInput};
use crate::mesh::cubesphere;
use crate::params::PlanetParams;

pub const PLANET_RES: u32 = 384;
pub const SCENE_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct DetailUniforms {
    pub view_proj: [[f32; 4]; 4],
    pub inv_view_proj: [[f32; 4]; 4],
    pub model: [[f32; 4]; 4],
    pub camera_pos: [f32; 4],
    pub sun_dir: [f32; 4],
    pub ocean_color: [f32; 4],
    pub land_color: [f32; 4],
    pub mountain_color: [f32; 4],
    pub sand_color: [f32; 4],
    pub snow_color: [f32; 4],
    pub atmosphere_color: [f32; 4],
    /// xyz = noise seed offset, w = ice_latitude
    pub seed_block: [f32; 4],
    /// x = water fraction, y = mountain_amp, z = signed sea height,
    /// w = body visual mode (0 terrain, 1.0 gas giant, 1.16 ice giant,
    ///     1.32 mini-Neptune, 2 star, 3 asteroid)
    pub planet_params: [f32; 4],
    /// x = atmosphere_density, y = time, z = cloud_coverage, w = render_quality
    pub misc: [f32; 4],
    /// x = width, y = height, z = aspect, w = planet_radius
    pub resolution: [f32; 4],
    /// x = crater_density, y = population_intensity, z = vegetation_richness, w = atm_banding
    pub world_features: [f32; 4],
}

pub struct DetailMesh {
    pub vertex_buffer: wgpu::Buffer,
    pub index_buffer: wgpu::Buffer,
    pub num_indices: u32,
}

pub struct TerrainAtlas {
    // Texture handles must outlive their views; held here for resource lifetime.
    _height_texture: wgpu::Texture,
    _biome_texture: wgpu::Texture,
    pub bind_group: wgpu::BindGroup,
    pub sea_level_threshold: f32,
}

pub fn create_terrain_layout(device: &wgpu::Device) -> wgpu::BindGroupLayout {
    device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("terrain_atlas_layout"),
        entries: &[
            // Height: R32Float for vertex displacement + per-pixel relief.
            wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: false },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            },
            // Biome: R8Uint, sampled per-fragment for the palette lookup
            // that replaced the in-shader biome derivation stack.
            wgpu::BindGroupLayoutEntry {
                binding: 1,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Uint,
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            },
        ],
    })
}

pub fn create_terrain_atlas(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    layout: &wgpu::BindGroupLayout,
    params: &PlanetParams,
    mean_temp_k: f32,
) -> TerrainAtlas {
    // Atlas resolution follows render_quality so weak devices get a
    // smaller upload (and a quicker bake) and high-end devices pick up
    // a sharper coastline. Tier helper lives on BakeInput so the
    // surface_map path can stay in sync. mean_temp_k flows in from the
    // main world's ClimateSummary so a frozen / hot world classifies
    // biomes correctly on the globe.
    let bake = surface_prebake::generate_with(
        BakeInput {
            seed: params.seed,
            water_fraction: params.sea_level,
            ice_latitude: params.ice_latitude,
            mean_temp_k,
            vegetation_richness: params.vegetation_richness,
            lon_cells: surface_prebake::PREBAKE_LON as u32,
            lat_cells: surface_prebake::PREBAKE_LAT as u32,
        }
        .with_quality(params.render_quality),
    );
    let sea_level_threshold = bake.sea_level;

    // Height texture (R32Float).
    let height_texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("terrain_atlas_height"),
        size: wgpu::Extent3d {
            width: bake.lon_cells,
            height: bake.lat_cells,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::R32Float,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    let height_view = height_texture.create_view(&wgpu::TextureViewDescriptor::default());
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &height_texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        bytemuck::cast_slice(&bake.heightmap),
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(bake.lon_cells * std::mem::size_of::<f32>() as u32),
            rows_per_image: Some(bake.lat_cells),
        },
        wgpu::Extent3d {
            width: bake.lon_cells,
            height: bake.lat_cells,
            depth_or_array_layers: 1,
        },
    );

    // Biome texture (R8Uint).
    let biome_texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("terrain_atlas_biome"),
        size: wgpu::Extent3d {
            width: bake.lon_cells,
            height: bake.lat_cells,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::R8Uint,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    let biome_view = biome_texture.create_view(&wgpu::TextureViewDescriptor::default());
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &biome_texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        &bake.biome_id,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(bake.lon_cells),
            rows_per_image: Some(bake.lat_cells),
        },
        wgpu::Extent3d {
            width: bake.lon_cells,
            height: bake.lat_cells,
            depth_or_array_layers: 1,
        },
    );

    let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("terrain_atlas_bind_group"),
        layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(&height_view),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::TextureView(&biome_view),
            },
        ],
    });

    TerrainAtlas {
        _height_texture: height_texture,
        _biome_texture: biome_texture,
        bind_group,
        sea_level_threshold,
    }
}

/// Retained for the regression test below — the live atlas path uses the
/// quantile already stored on `PreBake::sea_level`.
#[cfg(test)]
fn quantile_height(heightmap: &[f32], water_fraction: f32) -> f32 {
    if heightmap.is_empty() {
        return 0.0;
    }
    let mut sorted = heightmap.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let target_below = (water_fraction.clamp(0.0, 1.0) * sorted.len() as f32)
        .clamp(0.0, sorted.len() as f32) as usize;
    if target_below == 0 {
        sorted[0] - 0.001
    } else if target_below >= sorted.len() {
        sorted[sorted.len() - 1] + 0.001
    } else {
        sorted[target_below]
    }
}

pub fn mesh_resolution(quality: f32) -> u32 {
    if quality < 0.55 {
        96
    } else if quality < 0.85 {
        192
    } else {
        PLANET_RES
    }
}

pub fn create_mesh_buffers(device: &wgpu::Device, quality: f32) -> DetailMesh {
    let mesh = cubesphere(mesh_resolution(quality));
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

    DetailMesh {
        vertex_buffer,
        index_buffer,
        num_indices: mesh.indices.len() as u32,
    }
}

pub fn camera_fit_distance(
    current_distance: f32,
    planet_radius: f32,
    aspect: f32,
    fov_y: f32,
) -> f32 {
    camera_fit_distance_for_subject(current_distance, planet_radius.max(0.05), aspect, fov_y)
}

pub fn camera_fit_distance_for_body(
    current_distance: f32,
    planet_radius: f32,
    body_kind: f32,
    aspect: f32,
    fov_y: f32,
) -> f32 {
    camera_fit_distance_for_subject(
        current_distance,
        camera_subject_radius(planet_radius, body_kind),
        aspect,
        fov_y,
    )
}

fn camera_fit_distance_for_subject(
    current_distance: f32,
    radius: f32,
    aspect: f32,
    fov_y: f32,
) -> f32 {
    let vertical_fov = fov_y.max(0.1);
    let horizontal_fov = 2.0 * ((vertical_fov * 0.5).tan() * aspect.max(0.1)).atan();
    let limiting_fov = vertical_fov.min(horizontal_fov).max(0.1);
    // Keep a small composition margin so the atmosphere, limb glow, and
    // first user drag don't crop the planet on narrow phone viewports.
    let fit_distance = radius / (limiting_fov * 0.5).sin() * 1.10;
    let min_dist = (radius * 1.4).max(0.25);
    let max_dist = (radius * 60.0).max(60.0);
    current_distance.max(fit_distance).clamp(min_dist, max_dist)
}

/// Compute the camera distance that frames the planet correctly,
/// IGNORING the current camera state. Use when entering Detail view
/// or switching worlds — we want to *snap to* the fit distance so a
/// small planet doesn't render as a dot just because the previous
/// camera was far away. `camera_fit_distance` preserves zoom-out and
/// is for in-mode updates.
pub fn camera_target_distance_for_body(
    planet_radius: f32,
    body_kind: f32,
    aspect: f32,
    fov_y: f32,
) -> f32 {
    camera_target_distance_for_subject(
        camera_subject_radius(planet_radius, body_kind),
        aspect,
        fov_y,
    )
}

fn camera_target_distance_for_subject(radius: f32, aspect: f32, fov_y: f32) -> f32 {
    let vertical_fov = fov_y.max(0.1);
    let horizontal_fov = 2.0 * ((vertical_fov * 0.5).tan() * aspect.max(0.1)).atan();
    let limiting_fov = vertical_fov.min(horizontal_fov).max(0.1);
    let fit_distance = radius / (limiting_fov * 0.5).sin() * 1.10;
    let min_dist = (radius * 1.4).max(0.25);
    let max_dist = (radius * 60.0).max(60.0);
    fit_distance.clamp(min_dist, max_dist)
}

fn camera_subject_radius(planet_radius: f32, body_kind: f32) -> f32 {
    let radius = planet_radius.max(0.05);
    if body_kind > 0.5 && body_kind < 1.5 {
        // Leave room for visible ring arcs and atmospheric glow around giant
        // planets. The user can still pinch/scroll in for cloud-top detail.
        radius * 1.72
    } else if body_kind > 1.5 && body_kind < 2.5 {
        // Stars need a little breathing room for limb prominences/corona.
        radius * 1.24
    } else {
        radius
    }
}

/// Recompute the full uniform struct. Use this when params, camera, or
/// resolution change. For per-frame updates that only advance `time` and
/// `rotation_t`, prefer `patch_frame_dynamics` to skip the heavy work
/// (sun direction, seed tilt, view-proj inverse, view-proj itself).
pub fn uniforms_for(
    params: &PlanetParams,
    camera: &Camera,
    time: f32,
    rotation_t: f32,
    width: u32,
    height: u32,
    sea_level_threshold: f32,
) -> DetailUniforms {
    // Spin around the planet's local Y, then apply a seed-derived tilt so
    // each world has its own axial inclination instead of standing bolt-upright.
    // Quat multiply applies right-to-left: spin first, tilt wraps the result.
    let (tilt_axis, tilt_angle) = seed_to_tilt(params.seed);
    let tilt = Quat::from_axis_angle(tilt_axis, tilt_angle);
    let spin = Quat::from_rotation_y(rotation_t);
    let model = Mat4::from_quat(tilt * spin);
    let view_proj = camera.view_proj();
    let inv_view_proj = view_proj.inverse();
    let cam_pos = camera.position();

    let sun_yaw = params.sun_angle * std::f32::consts::TAU;
    // The UI's default/randomized angle range is authored around the viewer-facing side.
    let sun_dir = Vec3::new(-sun_yaw.cos() * 0.85, 0.32, -sun_yaw.sin() * 0.85).normalize();

    let seed = seed_offsets(params.seed);

    DetailUniforms {
        view_proj: view_proj.to_cols_array_2d(),
        inv_view_proj: inv_view_proj.to_cols_array_2d(),
        model: model.to_cols_array_2d(),
        camera_pos: [cam_pos.x, cam_pos.y, cam_pos.z, 1.0],
        sun_dir: [sun_dir.x, sun_dir.y, sun_dir.z, 0.0],
        ocean_color: vec3_to_v4(params.ocean_color),
        land_color: vec3_to_v4(params.land_color),
        mountain_color: vec3_to_v4(params.mountain_color),
        sand_color: vec3_to_v4(params.sand_color),
        snow_color: vec3_to_v4(params.snow_color),
        atmosphere_color: vec3_to_v4(params.atmosphere_color),
        seed_block: [seed[0], seed[1], seed[2], params.ice_latitude],
        planet_params: [
            params.sea_level,
            params.mountain_height,
            sea_level_threshold,
            params.body_visual_mode,
        ],
        misc: [
            params.atmosphere_density,
            time,
            params.cloud_coverage,
            params.render_quality.clamp(0.0, 1.0),
        ],
        resolution: [
            width as f32,
            height as f32,
            camera.aspect,
            params.planet_radius,
        ],
        world_features: [
            params.crater_density,
            params.population_intensity,
            params.vegetation_richness,
            params.atm_banding,
        ],
    }
}

#[cfg(test)]
mod camera_tests {
    use super::{camera_fit_distance, camera_target_distance_for_body};

    #[test]
    fn portrait_viewports_fit_the_planet_horizontally() {
        let desktop = camera_fit_distance(3.0, 1.0, 16.0 / 9.0, 35f32.to_radians());
        let phone = camera_fit_distance(3.0, 1.0, 390.0 / 844.0, 35f32.to_radians());

        assert!(desktop > 3.0);
        assert!(phone > desktop * 2.0);
    }

    #[test]
    fn giant_planets_leave_room_for_rings() {
        let terrestrial = camera_target_distance_for_body(1.0, 0.0, 16.0 / 9.0, 35f32.to_radians());
        let gas_giant = camera_target_distance_for_body(1.0, 1.0, 16.0 / 9.0, 35f32.to_radians());
        let star = camera_target_distance_for_body(1.0, 2.0, 16.0 / 9.0, 35f32.to_radians());

        assert!(gas_giant > terrestrial * 1.65);
        assert!(star > terrestrial * 1.15);
    }
}

/// Patch the time-varying fields of a cached uniform struct. The expensive
/// matrices and per-seed offsets stay the same; only the model matrix
/// (rotation_t spin around the seed-derived tilt) and the `time` field in
/// `misc` need to refresh each frame.
pub fn patch_frame_dynamics(
    uniforms: &mut DetailUniforms,
    params: &PlanetParams,
    rotation_t: f32,
    time: f32,
) {
    let (tilt_axis, tilt_angle) = seed_to_tilt(params.seed);
    let tilt = Quat::from_axis_angle(tilt_axis, tilt_angle);
    let spin = Quat::from_rotation_y(rotation_t);
    let model = Mat4::from_quat(tilt * spin);
    uniforms.model = model.to_cols_array_2d();
    uniforms.misc[1] = time;
}

fn vec3_to_v4(c: [f32; 3]) -> [f32; 4] {
    [c[0], c[1], c[2], 1.0]
}

/// Derive a per-seed axial tilt (axis in the XZ plane + angle 0..~35 deg) so
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

pub fn create_depth_view(device: &wgpu::Device, width: u32, height: u32) -> wgpu::TextureView {
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
        // TEXTURE_BINDING lets the atmosphere pass cap scattering at the
        // nearest opaque object instead of veiling foreground moons.
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });
    texture.create_view(&wgpu::TextureViewDescriptor::default())
}

pub fn create_scene_view(device: &wgpu::Device, width: u32, height: u32) -> wgpu::TextureView {
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

pub fn create_atmosphere_bind_group(
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

pub struct DetailRenderPass<'a> {
    pub background_pipeline: &'a wgpu::RenderPipeline,
    pub planet_pipeline: &'a wgpu::RenderPipeline,
    pub atmosphere_pipeline: &'a wgpu::RenderPipeline,
    pub vertex_buffer: &'a wgpu::Buffer,
    pub index_buffer: &'a wgpu::Buffer,
    pub num_indices: u32,
    pub uniforms_bind_group: &'a wgpu::BindGroup,
    pub terrain_bind_group: &'a wgpu::BindGroup,
    pub atmosphere_bind_group: &'a wgpu::BindGroup,
    pub scene_view: &'a wgpu::TextureView,
    pub depth_view: &'a wgpu::TextureView,
}

pub fn encode_render(
    encoder: &mut wgpu::CommandEncoder,
    view: &wgpu::TextureView,
    pass_input: DetailRenderPass<'_>,
) {
    {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("scene_pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: pass_input.scene_view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: pass_input.depth_view,
                depth_ops: Some(wgpu::Operations {
                    load: wgpu::LoadOp::Clear(1.0),
                    store: wgpu::StoreOp::Store,
                }),
                stencil_ops: None,
            }),
            timestamp_writes: None,
            occlusion_query_set: None,
        });

        pass.set_pipeline(pass_input.background_pipeline);
        pass.set_bind_group(0, pass_input.uniforms_bind_group, &[]);
        pass.draw(0..3, 0..1);

        pass.set_pipeline(pass_input.planet_pipeline);
        pass.set_bind_group(0, pass_input.uniforms_bind_group, &[]);
        pass.set_bind_group(1, pass_input.terrain_bind_group, &[]);
        pass.set_vertex_buffer(0, pass_input.vertex_buffer.slice(..));
        pass.set_index_buffer(pass_input.index_buffer.slice(..), wgpu::IndexFormat::Uint32);
        pass.draw_indexed(0..pass_input.num_indices, 0, 0..1);
    }

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
        pass.set_pipeline(pass_input.atmosphere_pipeline);
        pass.set_bind_group(0, pass_input.uniforms_bind_group, &[]);
        pass.set_bind_group(1, pass_input.atmosphere_bind_group, &[]);
        pass.draw(0..3, 0..1);
    }
}

#[cfg(test)]
mod tests {
    use super::{quantile_height, DetailUniforms};

    #[test]
    fn detail_uniform_contract_stays_shader_aligned() {
        assert_eq!(std::mem::size_of::<DetailUniforms>(), 400);
        assert_eq!(std::mem::align_of::<DetailUniforms>(), 4);
        assert_eq!(std::mem::size_of::<DetailUniforms>() % 16, 0);
    }

    #[test]
    fn quantile_height_turns_water_fraction_into_threshold() {
        let heightmap = [-0.6, 0.1, 0.8, -0.2];
        let threshold = quantile_height(&heightmap, 0.5);
        let underwater = heightmap
            .iter()
            .filter(|height| **height < threshold)
            .count();

        assert_eq!(underwater, 2);
        assert_eq!(threshold, 0.1);
    }
}
