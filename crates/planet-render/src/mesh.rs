use bytemuck::{Pod, Zeroable};
use glam::Vec3;

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct Vertex {
    pub position: [f32; 3],
    pub _pad: f32,
}

pub struct MeshData {
    pub vertices: Vec<Vertex>,
    pub indices: Vec<u32>,
}

/// Cubesphere: 6 faces, each subdivided into `resolution` x `resolution` quads.
/// Each face's UV is mapped into a [-1, 1] square offset on the appropriate axis,
/// then normalized to land on a unit sphere.
pub fn cubesphere(resolution: u32) -> MeshData {
    assert!(resolution >= 2);
    let n = resolution as usize;

    // Six (right, up) basis pairs — `forward` is right × up so the face points outward.
    let faces: [(Vec3, Vec3); 6] = [
        (Vec3::Z, Vec3::Y),                 // +X
        (Vec3::NEG_Z, Vec3::Y),             // -X
        (Vec3::X, Vec3::NEG_Z),             // +Y (top)
        (Vec3::X, Vec3::Z),                 // -Y (bottom)
        (Vec3::NEG_X, Vec3::Y),             // +Z
        (Vec3::X, Vec3::Y),                 // -Z
    ];

    let mut vertices = Vec::with_capacity(6 * n * n);
    let mut indices = Vec::with_capacity(6 * (n - 1) * (n - 1) * 6);

    for (face_idx, (right, up)) in faces.iter().enumerate() {
        let forward = right.cross(*up);
        let base = (face_idx * n * n) as u32;
        for j in 0..n {
            for i in 0..n {
                let u = (i as f32 / (n - 1) as f32) * 2.0 - 1.0;
                let v = (j as f32 / (n - 1) as f32) * 2.0 - 1.0;
                let p_cube = *right * u + *up * v + forward;
                // Spherify with a uniform mapping that gives a more even distribution
                // than plain normalize — reduces stretching at face corners.
                let p = spherify(p_cube);
                vertices.push(Vertex {
                    position: p.to_array(),
                    _pad: 0.0,
                });
            }
        }
        for j in 0..n - 1 {
            for i in 0..n - 1 {
                let a = base + (j * n + i) as u32;
                let b = a + 1;
                let c = a + n as u32;
                let d = c + 1;
                // Two triangles per quad
                indices.extend_from_slice(&[a, c, b, b, c, d]);
            }
        }
    }

    MeshData { vertices, indices }
}

fn spherify(p: Vec3) -> Vec3 {
    let x2 = p.x * p.x;
    let y2 = p.y * p.y;
    let z2 = p.z * p.z;
    Vec3::new(
        p.x * (1.0 - y2 * 0.5 - z2 * 0.5 + y2 * z2 / 3.0).sqrt(),
        p.y * (1.0 - z2 * 0.5 - x2 * 0.5 + z2 * x2 / 3.0).sqrt(),
        p.z * (1.0 - x2 * 0.5 - y2 * 0.5 + x2 * y2 / 3.0).sqrt(),
    )
}
