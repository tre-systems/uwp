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
///
/// Vertices on shared face boundaries are WELDED (deduplicated by spherified
/// position). The previous version emitted 6 × n² independent vertices and
/// adjacent face patches generated separate-but-coincident vertices at their
/// shared edges. With WebGPU's rasterizer applying its own tie-breaking on
/// triangle-edge coverage, the unshared edges produced sub-pixel gaps and
/// faint dark lines along the cube-sphere face boundaries — visible as
/// "straight edges" on the rendered planet at higher mesh resolution.
/// Welding via spherified-position rounding shares the boundary vertices
/// between adjacent faces' index buffers, so the rasterizer treats the edge
/// as a single seam owned by one triangle pair instead of two competing
/// pairs.
pub fn cubesphere(resolution: u32) -> MeshData {
    use std::collections::HashMap;

    assert!(resolution >= 2);
    let n = resolution as usize;

    // Six (right, up) basis pairs — `forward` is right × up so the face points outward.
    let faces: [(Vec3, Vec3); 6] = [
        (Vec3::Z, Vec3::Y),     // +X
        (Vec3::NEG_Z, Vec3::Y), // -X
        (Vec3::X, Vec3::NEG_Z), // +Y (top)
        (Vec3::X, Vec3::Z),     // -Y (bottom)
        (Vec3::NEG_X, Vec3::Y), // +Z
        (Vec3::X, Vec3::Y),     // -Z
    ];

    let mut vertices: Vec<Vertex> = Vec::with_capacity(6 * n * n);
    let mut indices: Vec<u32> = Vec::with_capacity(6 * (n - 1) * (n - 1) * 6);
    // Position-hash → global vertex index. Resolution of 1e5 gives ~10 µm
    // precision on a unit sphere, well below any meaningful displacement
    // delta between adjacent face patches' shared edges.
    let mut position_index: HashMap<[i32; 3], u32> = HashMap::with_capacity(6 * n * n);

    for (right, up) in faces.iter() {
        let forward = right.cross(*up);
        // Per-face local→global index map for assembling triangles after
        // we've welded shared boundary vertices.
        let mut local_to_global: Vec<u32> = Vec::with_capacity(n * n);
        for j in 0..n {
            for i in 0..n {
                let u = (i as f32 / (n - 1) as f32) * 2.0 - 1.0;
                let v = (j as f32 / (n - 1) as f32) * 2.0 - 1.0;
                let p_cube = *right * u + *up * v + forward;
                // Spherify with a uniform mapping that gives a more even
                // distribution than plain normalize — reduces stretching
                // at face corners.
                let p = spherify(p_cube);
                let key = [
                    (p.x * 1.0e5).round() as i32,
                    (p.y * 1.0e5).round() as i32,
                    (p.z * 1.0e5).round() as i32,
                ];
                let global_idx = match position_index.get(&key) {
                    Some(&idx) => idx,
                    None => {
                        let idx = vertices.len() as u32;
                        vertices.push(Vertex {
                            position: p.to_array(),
                            _pad: 0.0,
                        });
                        position_index.insert(key, idx);
                        idx
                    }
                };
                local_to_global.push(global_idx);
            }
        }
        for j in 0..n - 1 {
            for i in 0..n - 1 {
                let a = local_to_global[j * n + i];
                let b = local_to_global[j * n + i + 1];
                let c = local_to_global[(j + 1) * n + i];
                let d = local_to_global[(j + 1) * n + i + 1];
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
