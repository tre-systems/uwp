pub const PLANET_RES: u32 = 200;
pub const SCENE_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;

pub fn mesh_resolution(quality: f32) -> u32 {
    if quality < 0.55 {
        96
    } else if quality < 0.85 {
        144
    } else {
        PLANET_RES
    }
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
