use glam::{Mat4, Vec3};

pub struct Camera {
    pub yaw: f32,
    pub pitch: f32,
    pub distance: f32,
    pub aspect: f32,
    pub fov_y: f32,
    pub near: f32,
    pub far: f32,
}

impl Camera {
    pub fn new(aspect: f32) -> Self {
        Self {
            yaw: 0.6,
            pitch: 0.25,
            distance: 3.0,
            aspect,
            fov_y: 35f32.to_radians(),
            near: 0.05,
            far: 100.0,
        }
    }

    pub fn position(&self) -> Vec3 {
        let cp = self.pitch.cos();
        Vec3::new(
            self.distance * cp * self.yaw.sin(),
            self.distance * self.pitch.sin(),
            self.distance * cp * self.yaw.cos(),
        )
    }

    pub fn view(&self) -> Mat4 {
        Mat4::look_at_rh(self.position(), Vec3::ZERO, Vec3::Y)
    }

    pub fn projection(&self) -> Mat4 {
        Mat4::perspective_rh(self.fov_y, self.aspect, self.near, self.far)
    }

    pub fn view_proj(&self) -> Mat4 {
        self.projection() * self.view()
    }

    pub fn orbit(&mut self, dx: f32, dy: f32) {
        self.yaw -= dx;
        self.pitch = (self.pitch + dy).clamp(-1.45, 1.45);
    }

    pub fn dolly(&mut self, delta: f32, planet_radius: f32) {
        // Min distance scales with the rendered planet so the camera never
        // clips inside a super-Earth and we can still zoom right in on an
        // asteroid-sized world.
        let min_dist = (planet_radius * 1.4).max(0.25);
        self.distance = (self.distance * (1.0 + delta * 0.0015)).clamp(min_dist, 12.0);
    }
}
