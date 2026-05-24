use bytemuck::{Pod, Zeroable};

use crate::system::{BodyType, SolarSystem};

pub const MAX_SYSTEM_PLANETS: usize = 16;
pub const MAX_SYSTEM_MOONS: usize = 32;
pub const MAX_SYSTEM_BELTS: usize = 4;
pub const SCENE_UNITS_PER_AU: f32 = 1.0;

/// Packed system data for the system shader. Tightly packed for transfer
/// efficiency; `shaders/system.wgsl` owns the matching unpacking code.
///
///   planets[2i  ]: xyz = world position, w = display radius
///   planets[2i+1]: xyz = base colour,    w = orbital radius (scene units)
///   planet_meta[i]: x = body_type (shader id), y = seed, z = axial tilt, w = unused
///   moons[i]      : xyz = world position, w = display radius (sign = icy flag)
///   belts[i]      : x = inner_au, y = outer_au, z = density [0..1], w = unused
///   companion     : xyz = world position, w = display radius (0 = no companion)
///   companion_color: xyz = colour, w = intensity
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, Default)]
pub struct SystemUniforms {
    /// x = planet count, y = primary-star display radius, z = primary intensity,
    /// w = moon count.
    pub info: [f32; 4],
    /// xyz = primary-star colour, w = belt count.
    pub star_color: [f32; 4],
    pub planets: [[f32; 4]; MAX_SYSTEM_PLANETS * 2],
    pub planet_meta: [[f32; 4]; MAX_SYSTEM_PLANETS],
    pub moons: [[f32; 4]; MAX_SYSTEM_MOONS],
    pub belts: [[f32; 4]; MAX_SYSTEM_BELTS],
    pub companion: [f32; 4],
    pub companion_color: [f32; 4],
    /// x = primary temperature, y = primary warmth, z = companion temperature,
    /// w = companion warmth.
    pub stars_meta: [f32; 4],
}

pub fn camera_fit_distance(sys: &SolarSystem) -> f32 {
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
    let star_disp = star_display_radius(sys, system_scale);
    let gap = star_disp * 0.45;
    let mut prev_outer_edge = star_disp + gap;
    let mut last_disp_r = star_disp;
    for planet in &sys.planets {
        let real_r = planet.orbit_au * SCENE_UNITS_PER_AU;
        let p_radius = display_radius_for(planet.body_type, planet.radius_earth, system_scale);
        let needed_r = prev_outer_edge + p_radius;
        let r = real_r.max(needed_r);
        last_disp_r = r;
        prev_outer_edge = r + p_radius + gap;
    }
    let fit = last_disp_r.max(outer_belt).max(5.0);
    (fit * 1.6).max(3.0)
}

pub fn uniforms_for(sys: &SolarSystem, time: f32) -> SystemUniforms {
    let mut out = SystemUniforms::default();
    let n_p = sys.planets.len().min(MAX_SYSTEM_PLANETS);

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

    let star_disp = star_display_radius(sys, system_scale);
    let intensity = 1.4 + sys.star.luminosity_solar.powf(0.2);

    let gap = star_disp * 0.45;
    let mut display_orbit_r = [0.0f32; MAX_SYSTEM_PLANETS];
    let mut planet_disp_r = [0.0f32; MAX_SYSTEM_PLANETS];
    let mut prev_outer_edge = star_disp + gap;
    for (i, planet) in sys.planets.iter().take(n_p).enumerate() {
        let real_r = planet.orbit_au * SCENE_UNITS_PER_AU;
        let p_radius = display_radius_for(planet.body_type, planet.radius_earth, system_scale);
        let needed_r = prev_outer_edge + p_radius;
        let r = real_r.max(needed_r);
        display_orbit_r[i] = r;
        planet_disp_r[i] = p_radius;
        prev_outer_edge = r + p_radius + gap;
    }

    let mut planet_positions = [[0.0f32; 3]; MAX_SYSTEM_PLANETS];
    for (i, planet) in sys.planets.iter().take(n_p).enumerate() {
        let omega = (0.04 / planet.orbit_au.powf(1.5)).min(0.50);
        let theta = planet.phase_rad + time * omega;
        let r = display_orbit_r[i];
        let pos = [r * theta.cos(), 0.0, r * theta.sin()];
        let disp_r = planet_disp_r[i];
        let col = schematic_color_for(planet.body_type, planet.in_habitable_zone);
        out.planets[i * 2] = [pos[0], pos[1], pos[2], disp_r];
        out.planets[i * 2 + 1] = [col[0], col[1], col[2], r];
        let tilt = ((planet.seed as f32 * 1.7e-5).sin() * 0.45) + 0.1;
        let seed_f = ((planet.seed % 9973) as f32) / 9973.0 * 1000.0;
        out.planet_meta[i] = [planet.body_type.as_shader_id(), seed_f, tilt, 0.0];
        planet_positions[i] = pos;
    }

    let mut moon_idx = 0usize;
    for (i, planet) in sys.planets.iter().take(n_p).enumerate() {
        let host_pos = planet_positions[i];
        let host_r = planet_disp_r[i];
        for moon in planet.moons.iter().take(6) {
            if moon_idx >= MAX_SYSTEM_MOONS {
                break;
            }
            let orbit_r = host_r * (1.6 + (moon.orbit_radii / 12.0).min(4.0));
            let omega = (0.15 / moon.orbit_radii.powf(1.5)).min(0.40);
            let theta = moon.phase_rad + time * omega;
            let pos = [
                host_pos[0] + orbit_r * theta.cos(),
                host_pos[1],
                host_pos[2] + orbit_r * theta.sin(),
            ];
            let disp_r = (host_r * 0.18 * moon.radius_earth.powf(0.5)).max(0.003);
            let w = if moon.icy { disp_r } else { -disp_r };
            out.moons[moon_idx] = [pos[0], pos[1], pos[2], w];
            moon_idx += 1;
        }
        if moon_idx >= MAX_SYSTEM_MOONS {
            break;
        }
    }

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

    let primary_warmth = sys.star.color[0] - sys.star.color[2];
    out.stars_meta = [
        sys.star.temperature_k,
        primary_warmth,
        sys.companion
            .as_ref()
            .map(|c| c.star.temperature_k)
            .unwrap_or(0.0),
        sys.companion
            .as_ref()
            .map(|c| c.star.color[0] - c.star.color[2])
            .unwrap_or(0.0),
    ];

    if let Some(comp) = &sys.companion {
        let omega = (0.012 / comp.separation_au.powf(1.5)).min(0.05);
        let theta = comp.phase_rad + time * omega;
        let incl = comp.inclination_deg.to_radians();
        let r = comp.separation_au * SCENE_UNITS_PER_AU;
        let cp = theta.cos();
        let sp = theta.sin();
        let ci = incl.cos();
        let si = incl.sin();
        let pos = [r * cp, r * sp * si, r * sp * ci];
        let disp_r =
            (system_scale * 0.045 * (comp.star.radius_solar.max(0.3)).powf(0.35)).max(0.04);
        let comp_intensity = 1.4 + comp.star.luminosity_solar.powf(0.2);
        out.companion = [pos[0], pos[1], pos[2], disp_r];
        out.companion_color = [
            comp.star.color[0],
            comp.star.color[1],
            comp.star.color[2],
            comp_intensity,
        ];
    }
    out
}

pub fn encode_render(
    encoder: &mut wgpu::CommandEncoder,
    view: &wgpu::TextureView,
    pipeline: &wgpu::RenderPipeline,
    uniforms_bind_group: &wgpu::BindGroup,
    system_bind_group: &wgpu::BindGroup,
) {
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
    pass.set_pipeline(pipeline);
    pass.set_bind_group(0, uniforms_bind_group, &[]);
    pass.set_bind_group(1, system_bind_group, &[]);
    pass.draw(0..3, 0..1);
}

fn star_display_radius(sys: &SolarSystem, system_scale: f32) -> f32 {
    (system_scale * 0.045 * sys.star.radius_solar.max(0.3).powf(0.35)).max(0.04)
}

fn display_radius_for(body: BodyType, real_radius_earth: f32, system_scale: f32) -> f32 {
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

fn schematic_color_for(body: BodyType, in_hz: bool) -> [f32; 3] {
    match body {
        BodyType::GasGiant => [0.86, 0.74, 0.55],
        BodyType::IceGiant => [0.47, 0.63, 0.85],
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

#[cfg(test)]
mod tests {
    use super::SystemUniforms;

    #[test]
    fn system_uniform_contract_stays_shader_aligned() {
        assert_eq!(std::mem::size_of::<SystemUniforms>(), 1424);
        assert_eq!(std::mem::align_of::<SystemUniforms>(), 4);
        assert_eq!(std::mem::size_of::<SystemUniforms>() % 16, 0);
    }
}
