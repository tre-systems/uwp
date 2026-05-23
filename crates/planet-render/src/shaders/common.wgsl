struct Uniforms {
    view_proj:       mat4x4<f32>,
    inv_view_proj:   mat4x4<f32>,
    model:           mat4x4<f32>,
    camera_pos:      vec4<f32>,
    sun_dir:         vec4<f32>,
    ocean_color:     vec4<f32>,
    land_color:      vec4<f32>,
    mountain_color:  vec4<f32>,
    sand_color:      vec4<f32>,
    snow_color:      vec4<f32>,
    atmosphere_color:vec4<f32>,
    // xyz = seed offsets, w = ice latitude (0..1)
    seed_block:      vec4<f32>,
    // x = sea_level, y = mountain_amp, z = noise_freq, w = noise_octaves
    planet_params:   vec4<f32>,
    // x = atmosphere_density, y = time, z = cloud_coverage, w = render_quality
    misc:            vec4<f32>,
    // x = width, y = height, z = aspect, w = planet radius
    resolution:      vec4<f32>,
    // x = crater_density, y = population_intensity, z = vegetation_richness, w = atm_banding
    world_features:  vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
