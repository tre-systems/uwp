// AGX display transform (after Troy Sobotka). Compresses HDR scene-linear
// values to a perceptually pleasing display range while preserving hue better
// than the older ACES filmic curve. Matrices and polynomial fit per Three.js
// r166 implementation, matching Blender 4.x default View Transform.
fn agx(c_in: vec3<f32>) -> vec3<f32> {
    let m1 = mat3x3<f32>(
        0.842479062, 0.0423282, 0.0423756,
        0.0784335,   0.878468,  0.0784336,
        0.0792237,   0.0791661, 0.879142,
    );
    let min_ev = -8.0;
    let max_ev =  4.026069;
    var v = m1 * max(c_in, vec3<f32>(0.0));
    v = log2(max(v, vec3<f32>(1e-10)));
    v = clamp((v - min_ev) / (max_ev - min_ev), vec3<f32>(0.0), vec3<f32>(1.0));

    let x  = v;
    let x2 = x * x;
    let x4 = x2 * x2;
    let s  = 15.5 * x4 * x2
           - 40.14 * x4 * x
           + 31.96 * x4
           -  6.868 * x2 * x
           +  0.4298 * x2
           +  0.1191 * x
           -  0.00232;

    let m2 = mat3x3<f32>(
         1.196879, -0.0528015, -0.0528992,
        -0.0980219,  1.151944, -0.0980505,
        -0.0989032, -0.0989030, 1.151013,
    );
    return m2 * s;
}
