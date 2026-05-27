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
            // Far plane must comfortably contain the outermost moon shell
            // (~45 R) at maximum camera distance (~60 R). 200 leaves margin
            // for ring systems and stars projected at infinity.
            far: 200.0,
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

    /// Point the camera at a surface latitude / longitude. Does not change
    /// distance. Returns the spin angle needed to put the requested
    /// longitude on the camera-facing meridian — the caller sets the
    /// renderer's `rotation_t` to that value to land the chosen hex in
    /// the centre of the frame.
    pub fn point_at(&mut self, lat_deg: f32, lon_deg: f32) -> f32 {
        let lat = lat_deg.to_radians();
        // Camera sits at (yaw, pitch) on a sphere; look-at is origin. To
        // face the latitude `lat`, pitch should match that latitude.
        self.pitch = lat.clamp(-1.45, 1.45);
        // Bring the longitude to face the camera: standard convention is
        // longitude 0 sits at +Z, camera-default yaw is 0.6 so we offset.
        self.yaw = 0.0;
        // Return the spin angle that puts the requested longitude on the
        // +Z meridian (where the default camera looks). Longitude 0 sits
        // on +X, so we rotate by π/2 − lon to bring that meridian to +Z.
        std::f32::consts::FRAC_PI_2 - lon_deg.to_radians()
    }

    pub fn dolly(&mut self, delta: f32, planet_radius: f32) {
        // Min distance scales with the rendered planet so the camera never
        // clips inside a super-Earth and we can still zoom right in on an
        // asteroid-sized world. Max distance widened to 60× planet radius
        // so distant moons (3rd orbital shell sits at 30-45 planet radii)
        // come into frame when zoomed all the way out.
        let min_dist = (planet_radius * 1.4).max(0.25);
        let max_dist = (planet_radius * 60.0).max(60.0);
        self.distance = (self.distance * (1.0 + delta * 0.0015)).clamp(min_dist, max_dist);
    }
}
