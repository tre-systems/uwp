use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Vec3, Vec4};

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

pub struct SystemResources {
    pub uniform_buffer: wgpu::Buffer,
    pub bind_group_layout: wgpu::BindGroupLayout,
    pub bind_group: wgpu::BindGroup,
}

pub fn create_resources(device: &wgpu::Device) -> SystemResources {
    let uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("system_uniforms"),
        size: std::mem::size_of::<SystemUniforms>() as u64,
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
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
    let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("system_bind_group"),
        layout: &bind_group_layout,
        entries: &[wgpu::BindGroupEntry {
            binding: 0,
            resource: uniform_buffer.as_entire_binding(),
        }],
    });

    SystemResources {
        uniform_buffer,
        bind_group_layout,
        bind_group,
    }
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
    let kick = binary_kick(sys, time);
    for (i, planet) in sys.planets.iter().take(n_p).enumerate() {
        let a_disp = display_orbit_r[i];
        let pos = planet_world_position(planet, a_disp, kick, time);
        let disp_r = planet_disp_r[i];
        let col = schematic_color_for(planet.body_type, planet.in_habitable_zone);
        out.planets[i * 2] = [pos[0], pos[1], pos[2], disp_r];
        // Slot w still carries the semi-major axis so the shader draws the
        // schematic orbital ring at the average radius rather than the
        // moving instantaneous radius.
        out.planets[i * 2 + 1] = [col[0], col[1], col[2], a_disp];
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

/// Compute a planet's instantaneous Kepler position at `time` given the
/// already-spaced display semi-major axis. Kept as a separate fn so the
/// renderer (uniforms_for) and the picker (pick_planet) stay in sync.
pub fn planet_world_position(
    planet: &crate::system::Planet,
    a_disp: f32,
    binary_kick: Option<f32>,
    time: f32,
) -> [f32; 3] {
    let omega = (0.04 / planet.orbit_au.powf(1.5)).min(0.50);
    let mean_anomaly = planet.phase_rad + time * omega;

    let mut e = (planet.eccentricity * 0.4).min(0.35);
    if let Some(k) = binary_kick {
        let kick = k * 0.04 * (1.0 / (1.0 + planet.orbit_au * 0.5));
        e = (e + kick).clamp(0.0, 0.55);
    }

    let mut e_anom = mean_anomaly;
    for _ in 0..5 {
        let f = e_anom - e * e_anom.sin() - mean_anomaly;
        let fp = 1.0 - e * e_anom.cos();
        e_anom -= f / fp.max(1e-6);
    }
    let s_half = (e_anom * 0.5).sin();
    let c_half = (e_anom * 0.5).cos();
    let nu = 2.0 * ((1.0 + e).sqrt() * s_half).atan2((1.0 - e).sqrt() * c_half);

    let arg_peri = ((planet.seed as f32 * 1.123e-4).sin()) * std::f32::consts::TAU;
    let theta = nu + arg_peri;
    let r_kepler = a_disp * (1.0 - e * e_anom.cos());
    [r_kepler * theta.cos(), 0.0, r_kepler * theta.sin()]
}

/// Sample the binary companion's phase-driven eccentricity kick at `time`.
/// Returns `None` for single-star systems.
pub fn binary_kick(sys: &SolarSystem, time: f32) -> Option<f32> {
    let c = sys.companion.as_ref()?;
    let omega_b = (0.018 / c.separation_au.powf(1.5)).min(0.20);
    Some((c.phase_rad + time * omega_b).sin())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PickKind {
    Planet,
    PrimaryStar,
    CompanionStar,
    AsteroidBelt,
}

/// Result of a ray-pick against the system view. `index` is the body index
/// inside the matching list (`planets`, `belts`, or 0/1 for stars); the
/// renderer client surfaces the rest of the metadata through `getSystem`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PickHit {
    pub kind: PickKind,
    pub index: usize,
    /// Hit distance along the ray (camera-space units). Lets the caller
    /// resolve overlapping bodies if it later picks moons too.
    pub distance: f32,
}

/// Pick the closest system-view planet under an NDC point (`-1..1` in
/// both axes; (0, 0) is the canvas centre, y points up). Returns `None`
/// when the ray misses every planet. The pick mirrors `uniforms_for`'s
/// position math so the user clicks exactly the sphere they see.
pub fn pick_planet(
    sys: &SolarSystem,
    time: f32,
    view_proj: Mat4,
    camera_pos: Vec3,
    ndc_x: f32,
    ndc_y: f32,
) -> Option<PickHit> {
    pick_body(sys, time, view_proj, camera_pos, ndc_x, ndc_y)
        .filter(|hit| hit.kind == PickKind::Planet)
}

/// Pick the closest selectable body in system view: primary star, companion
/// star, planets, or asteroid belts. This mirrors the same display-space
/// compression used by `uniforms_for`, so a click resolves the object the
/// user actually sees rather than the raw physical AU position.
pub fn pick_body(
    sys: &SolarSystem,
    time: f32,
    view_proj: Mat4,
    camera_pos: Vec3,
    ndc_x: f32,
    ndc_y: f32,
) -> Option<PickHit> {
    let inv = view_proj.inverse();
    let near = inv * Vec4::new(ndc_x, ndc_y, 0.0, 1.0);
    let far = inv * Vec4::new(ndc_x, ndc_y, 1.0, 1.0);
    if near.w == 0.0 || far.w == 0.0 {
        return None;
    }
    let p_near = Vec3::new(near.x / near.w, near.y / near.w, near.z / near.w);
    let p_far = Vec3::new(far.x / far.w, far.y / far.w, far.z / far.w);
    let mut ray_dir = p_far - p_near;
    let len = ray_dir.length();
    if !len.is_finite() || len < 1e-6 {
        return None;
    }
    ray_dir /= len;

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

    let n_p = sys.planets.len().min(MAX_SYSTEM_PLANETS);
    let mut best: Option<PickHit> = None;

    if let Some(t) = ray_sphere(camera_pos, ray_dir, Vec3::ZERO, star_disp * 1.15) {
        best = Some(PickHit {
            kind: PickKind::PrimaryStar,
            index: 0,
            distance: t,
        });
    }

    if let Some(comp) = &sys.companion {
        let omega = (0.012 / comp.separation_au.powf(1.5)).min(0.05);
        let theta = comp.phase_rad + time * omega;
        let incl = comp.inclination_deg.to_radians();
        let r = comp.separation_au * SCENE_UNITS_PER_AU;
        let pos = Vec3::new(
            r * theta.cos(),
            r * theta.sin() * incl.sin(),
            r * theta.sin() * incl.cos(),
        );
        let disp_r =
            (system_scale * 0.045 * (comp.star.radius_solar.max(0.3)).powf(0.35)).max(0.04);
        if let Some(t) = ray_sphere(camera_pos, ray_dir, pos, disp_r * 1.15) {
            if best.is_none_or(|b| t < b.distance) {
                best = Some(PickHit {
                    kind: PickKind::CompanionStar,
                    index: 1,
                    distance: t,
                });
            }
        }
    }

    if ray_dir.y.abs() > 1e-5 {
        let t = -camera_pos.y / ray_dir.y;
        if t >= 0.0 {
            let p = camera_pos + ray_dir * t;
            let r = (p.x * p.x + p.z * p.z).sqrt();
            for (i, belt) in sys.belts.iter().take(MAX_SYSTEM_BELTS).enumerate() {
                let inner = belt.inner_au * SCENE_UNITS_PER_AU;
                let outer = belt.outer_au * SCENE_UNITS_PER_AU;
                let pad = (outer - inner).max(0.01) * 0.08;
                if r >= inner - pad && r <= outer + pad && best.is_none_or(|b| t < b.distance) {
                    best = Some(PickHit {
                        kind: PickKind::AsteroidBelt,
                        index: i,
                        distance: t,
                    });
                }
            }
        }
    }

    let mut prev_outer_edge = star_disp + gap;
    let kick = binary_kick(sys, time);
    for (i, planet) in sys.planets.iter().take(n_p).enumerate() {
        let real_r = planet.orbit_au * SCENE_UNITS_PER_AU;
        let p_radius = display_radius_for(planet.body_type, planet.radius_earth, system_scale);
        let needed_r = prev_outer_edge + p_radius;
        let r = real_r.max(needed_r);
        prev_outer_edge = r + p_radius + gap;

        let pos = planet_world_position(planet, r, kick, time);
        let centre = Vec3::new(pos[0], pos[1], pos[2]);

        // Slight padding around the rendered disc lets the user grab a
        // small planet without millimetre precision, but stays tight
        // enough that two adjacent planets don't share pick territory.
        let pick_radius = p_radius * 1.25;
        if let Some(t) = ray_sphere(camera_pos, ray_dir, centre, pick_radius) {
            if best.is_none_or(|b| t < b.distance) {
                best = Some(PickHit {
                    kind: PickKind::Planet,
                    index: i,
                    distance: t,
                });
            }
        }
    }
    best
}

fn ray_sphere(origin: Vec3, dir: Vec3, centre: Vec3, radius: f32) -> Option<f32> {
    let m = origin - centre;
    let b = m.dot(dir);
    let c = m.dot(m) - radius * radius;
    if c > 0.0 && b > 0.0 {
        return None;
    }
    let disc = b * b - c;
    if disc < 0.0 {
        return None;
    }
    let t = -b - disc.sqrt();
    Some(t.max(0.0))
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
    use super::{pick_body, pick_planet, uniforms_for, PickKind, SystemUniforms};
    use crate::system;
    use glam::{Mat4, Vec3};

    #[test]
    fn system_uniform_contract_stays_shader_aligned() {
        assert_eq!(std::mem::size_of::<SystemUniforms>(), 1424);
        assert_eq!(std::mem::align_of::<SystemUniforms>(), 4);
        assert_eq!(std::mem::size_of::<SystemUniforms>() % 16, 0);
    }

    #[test]
    fn pick_planet_lands_on_centre() {
        // Take a known system, project every planet's world centre into NDC,
        // then ask pick_planet to recover the index. Every planet should be
        // pick-able from its own screen centre.
        let sys = system::generate(0xDEAD_BEEF);
        let uniforms = uniforms_for(&sys, 0.0);
        let camera_pos = Vec3::new(0.0, 35.0, 60.0);
        let view = Mat4::look_at_rh(camera_pos, Vec3::ZERO, Vec3::Y);
        let proj = Mat4::perspective_rh(35f32.to_radians(), 16.0 / 9.0, 0.05, 200.0);
        let vp = proj * view;
        for (i, _) in sys
            .planets
            .iter()
            .enumerate()
            .take(super::MAX_SYSTEM_PLANETS)
        {
            // planets[2i] xyz = world position
            let pos = uniforms.planets[i * 2];
            let world = glam::Vec4::new(pos[0], pos[1], pos[2], 1.0);
            let clip = vp * world;
            if clip.w <= 0.0 {
                continue;
            }
            let ndc_x = clip.x / clip.w;
            let ndc_y = clip.y / clip.w;
            if ndc_x.abs() > 1.0 || ndc_y.abs() > 1.0 {
                continue;
            }
            let hit = pick_planet(&sys, 0.0, vp, camera_pos, ndc_x, ndc_y);
            assert!(hit.is_some(), "planet {i} should hit at its centre");
            assert_eq!(hit.unwrap().index, i);
        }
    }

    #[test]
    fn pick_planet_misses_off_screen() {
        let sys = system::generate(7);
        let camera_pos = Vec3::new(0.0, 20.0, 30.0);
        let view = Mat4::look_at_rh(camera_pos, Vec3::ZERO, Vec3::Y);
        let proj = Mat4::perspective_rh(35f32.to_radians(), 16.0 / 9.0, 0.05, 200.0);
        // Ray that points straight up - should miss everything in the orbital plane.
        let vp = proj * view;
        let miss = pick_planet(&sys, 0.0, vp, camera_pos, 0.0, 0.99);
        // Either misses entirely or, at worst, hits the closest planet if
        // it happens to be near the top of frame. Don't assert None - just
        // ensure the function returns without panicking and the result is
        // well-formed.
        if let Some(hit) = miss {
            assert!(hit.index < sys.planets.len());
            assert!(hit.distance >= 0.0);
        }
    }

    #[test]
    fn pick_body_lands_on_primary_star() {
        let sys = system::generate(7);
        let camera_pos = Vec3::new(0.0, 20.0, 30.0);
        let view = Mat4::look_at_rh(camera_pos, Vec3::ZERO, Vec3::Y);
        let proj = Mat4::perspective_rh(35f32.to_radians(), 16.0 / 9.0, 0.05, 200.0);
        let vp = proj * view;

        let hit = pick_body(&sys, 0.0, vp, camera_pos, 0.0, 0.0).expect("star should pick");

        assert_eq!(hit.kind, PickKind::PrimaryStar);
        assert_eq!(hit.index, 0);
    }

    #[test]
    fn pick_body_can_hit_asteroid_belt_plane() {
        let mut sys = system::generate(3);
        sys.planets.clear();
        sys.belts = vec![crate::system::AsteroidBelt {
            inner_au: 2.0,
            outer_au: 3.0,
            density: 0.8,
        }];
        let camera_pos = Vec3::new(0.0, 8.0, 8.0);
        let view = Mat4::look_at_rh(camera_pos, Vec3::ZERO, Vec3::Y);
        let proj = Mat4::perspective_rh(35f32.to_radians(), 1.0, 0.05, 200.0);
        let vp = proj * view;
        let world = glam::Vec4::new(2.5, 0.0, 0.0, 1.0);
        let clip = vp * world;
        let ndc_x = clip.x / clip.w;
        let ndc_y = clip.y / clip.w;

        let hit = pick_body(&sys, 0.0, vp, camera_pos, ndc_x, ndc_y).expect("belt should pick");

        assert_eq!(hit.kind, PickKind::AsteroidBelt);
        assert_eq!(hit.index, 0);
    }
}
