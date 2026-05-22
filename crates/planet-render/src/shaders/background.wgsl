// Procedural starfield + faint nebula gradient drawn as a fullscreen triangle.

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
    seed_block:      vec4<f32>,
    planet_params:   vec4<f32>,
    misc:            vec4<f32>,
    resolution:      vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) ndc: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {
    // Fullscreen triangle that overshoots the viewport.
    var pos = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 3.0, -1.0),
        vec2<f32>(-1.0,  3.0),
    );
    var o: VsOut;
    o.clip = vec4<f32>(pos[vi], 0.9999, 1.0);
    o.ndc = pos[vi];
    return o;
}

fn hash21(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn star_layer(uv: vec2<f32>, scale: f32, threshold: f32) -> f32 {
    let g = floor(uv * scale);
    let c = fract(uv * scale);
    let r1 = hash21(g);
    let r2 = hash21(g + vec2<f32>(17.31, 41.7));
    let r3 = hash21(g + vec2<f32>(53.9, 19.2));
    let star_pos = vec2<f32>(r2, r3);
    let d = distance(c, star_pos);
    let star_size = mix(0.03, 0.10, r1);
    let bright = smoothstep(star_size, 0.0, d);
    // Only keep cells where the random gate exceeds the threshold (sparse stars).
    let mask = smoothstep(threshold, threshold + 0.02, r1);
    return bright * mask * mix(0.5, 1.4, hash21(g + vec2<f32>(89.0, 0.7)));
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let aspect = u.resolution.z;
    let uv = vec2<f32>(in.ndc.x * aspect, in.ndc.y);

    // Faint background tint that suggests a galactic gradient.
    let glow = smoothstep(2.2, 0.0, length(uv - vec2<f32>(-0.3, 0.2)));
    let base = mix(
        vec3<f32>(0.005, 0.006, 0.012),
        u.atmosphere_color.rgb * 0.07,
        glow * 0.6
    );

    // Three layers of stars at different scales/densities.
    var stars = 0.0;
    stars = stars + star_layer(uv, 35.0,  0.985);
    stars = stars + star_layer(uv, 90.0,  0.992) * 0.7;
    stars = stars + star_layer(uv, 220.0, 0.996) * 0.45;

    // Subtle twinkle using time
    let twinkle = 0.9 + 0.1 * sin(u.misc.y * 1.3 + uv.x * 30.0 + uv.y * 20.0);

    let col = base + vec3<f32>(stars) * twinkle;
    return vec4<f32>(col, 1.0);
}
