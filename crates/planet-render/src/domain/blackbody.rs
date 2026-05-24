//! Physically-grounded blackbody → sRGB conversion.
//!
//! Pipeline:
//!   1. Planck radiance B(λ, T) sampled at 10 nm intervals from 380-780 nm.
//!   2. Multiply by the CIE 1931 2-degree colour-matching functions
//!      x̄(λ), ȳ(λ), z̄(λ) and integrate to get tristimulus values (X, Y, Z).
//!   3. Convert XYZ -> linear sRGB via the standard D65 matrix.
//!   4. Clamp to >= 0 (deep red / blue spills negative in sRGB) and normalise
//!      so the largest channel is 1.0. This keeps the *chromaticity* faithful
//!      and lets the renderer control absolute luminance elsewhere.
//!
//! The polynomial fit it replaces was good for a quick demo but pinned the
//! red channel to 1.0 for hot stars (no proper blueish tip) and produced
//! washed pinks at mid temperatures. The integral version is still cheap
//! (40 samples once per star) and matches photometric reference colours
//! for the OBAFGKM spectral classes much more closely.

// CIE 1931 2° standard observer at 10 nm intervals from 380 nm to 780 nm.
// Values are tabulated to four decimal places (sufficient for u8/f32 work).
// Source: CIE 15:2004 reprint of the 1931 standard observer.
const CIE_X: [f32; 41] = [
    0.0014, 0.0042, 0.0143, 0.0435, 0.1344, 0.2839, 0.3483, 0.3362, 0.2908, 0.1954, 0.0956, 0.0320,
    0.0049, 0.0093, 0.0633, 0.1655, 0.2904, 0.4334, 0.5945, 0.7621, 0.9163, 1.0263, 1.0622, 1.0026,
    0.8544, 0.6424, 0.4479, 0.2835, 0.1649, 0.0874, 0.0468, 0.0227, 0.0114, 0.0058, 0.0029, 0.0014,
    0.0007, 0.0003, 0.0002, 0.0001, 0.0000,
];
const CIE_Y: [f32; 41] = [
    0.0000, 0.0001, 0.0004, 0.0012, 0.0040, 0.0116, 0.0230, 0.0380, 0.0600, 0.0910, 0.1390, 0.2080,
    0.3230, 0.5030, 0.7100, 0.8620, 0.9540, 0.9950, 0.9950, 0.9520, 0.8700, 0.7570, 0.6310, 0.5030,
    0.3810, 0.2650, 0.1750, 0.1070, 0.0610, 0.0320, 0.0170, 0.0082, 0.0041, 0.0021, 0.0010, 0.0005,
    0.0003, 0.0001, 0.0001, 0.0000, 0.0000,
];
const CIE_Z: [f32; 41] = [
    0.0065, 0.0201, 0.0679, 0.2074, 0.6456, 1.3856, 1.7471, 1.7721, 1.6692, 1.2876, 0.8130, 0.4652,
    0.2720, 0.1582, 0.0782, 0.0422, 0.0203, 0.0087, 0.0039, 0.0021, 0.0017, 0.0011, 0.0008, 0.0003,
    0.0002, 0.0000, 0.0000, 0.0000, 0.0000, 0.0000, 0.0000, 0.0000, 0.0000, 0.0000, 0.0000, 0.0000,
    0.0000, 0.0000, 0.0000, 0.0000, 0.0000,
];

const LAMBDA_START_NM: f32 = 380.0;
const LAMBDA_STEP_NM: f32 = 10.0;
const SAMPLES: usize = 41;

/// Planck's law in arbitrary radiance units (the absolute scale washes out
/// during the final normalise step, so we drop the 2hc² prefactor).
fn planck(lambda_m: f32, temp_k: f32) -> f32 {
    // hc/k in metre·kelvin (1.438 769e-2).
    let hc_over_k: f32 = 1.438_769e-2;
    let x = hc_over_k / (lambda_m * temp_k);
    // exp() can overflow far in the UV for cool stars; clamp to keep finite.
    let denom = if x > 700.0 {
        f32::INFINITY
    } else {
        x.exp() - 1.0
    };
    if !denom.is_finite() || denom == 0.0 {
        return 0.0;
    }
    1.0 / (lambda_m.powi(5) * denom)
}

/// Compute the perceived sRGB colour of a perfect blackbody at `temp_k`.
/// Returns linear-light sRGB in [0, 1], normalised so the brightest channel
/// is 1.0. The shader applies its own AGX tonemap on top.
pub fn blackbody_srgb(temp_k: f32) -> [f32; 3] {
    let temp = temp_k.clamp(1000.0, 40000.0);
    let mut x_sum = 0.0_f32;
    let mut y_sum = 0.0_f32;
    let mut z_sum = 0.0_f32;
    for i in 0..SAMPLES {
        let lambda_nm = LAMBDA_START_NM + LAMBDA_STEP_NM * i as f32;
        let lambda_m = lambda_nm * 1.0e-9;
        let radiance = planck(lambda_m, temp);
        x_sum += radiance * CIE_X[i];
        y_sum += radiance * CIE_Y[i];
        z_sum += radiance * CIE_Z[i];
    }

    // CIE XYZ -> linear sRGB (D65). Bradford-adapted matrix from sRGB spec.
    let r = 3.2406 * x_sum - 1.5372 * y_sum - 0.4986 * z_sum;
    let g = -0.9689 * x_sum + 1.8758 * y_sum + 0.0415 * z_sum;
    let b = 0.0557 * x_sum - 0.2040 * y_sum + 1.0570 * z_sum;

    // Gamut: blackbody locus sometimes pokes out of sRGB. Clamp negatives so
    // the renderer doesn't see a "negative" channel.
    let r = r.max(0.0);
    let g = g.max(0.0);
    let b = b.max(0.0);
    let max_chan = r.max(g).max(b);
    if max_chan <= 0.0 {
        // Shouldn't happen for any positive temperature, but defend against
        // numerical underflow at the cool tail.
        return [1.0, 1.0, 1.0];
    }
    [r / max_chan, g / max_chan, b / max_chan]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f32, b: f32, eps: f32) -> bool {
        (a - b).abs() < eps
    }

    #[test]
    fn solar_temperature_is_near_white() {
        let c = blackbody_srgb(5778.0);
        assert!(close(c[0], 1.0, 0.05), "red {r} not ~1", r = c[0]);
        assert!(c[1] > 0.85, "green {g} too low for sunlight", g = c[1]);
        let b = c[2];
        assert!(b > 0.70 && b < 1.0, "blue {b} should be slightly below R");
    }

    #[test]
    fn cool_star_is_red() {
        let c = blackbody_srgb(3000.0);
        let (r, g, b) = (c[0], c[1], c[2]);
        assert!(r > 0.99, "red {r} should saturate");
        assert!(b < g, "blue {b} should be below green {g}");
        assert!(b < 0.5, "blue {b} should be dim");
    }

    #[test]
    fn hot_star_is_blue_white() {
        let c = blackbody_srgb(20000.0);
        let (r, g, b) = (c[0], c[1], c[2]);
        assert!(b >= g, "blue {b} not dominant over green {g}");
        assert!(b >= r, "blue {b} not dominant over red {r}");
        assert!(r > 0.4, "red {r} too low for visible blue-white");
    }

    #[test]
    fn normalised_to_unit_max() {
        for &t in &[2500.0_f32, 5778.0, 8000.0, 15000.0, 30000.0] {
            let c = blackbody_srgb(t);
            let max = c[0].max(c[1]).max(c[2]);
            assert!(close(max, 1.0, 1e-4), "max {max} not 1 at {t} K");
        }
    }

    #[test]
    fn no_nan_at_extremes() {
        for &t in &[100.0_f32, 1.0, 100_000.0] {
            let c = blackbody_srgb(t);
            for v in c {
                assert!(v.is_finite(), "non-finite channel at {t} K");
                assert!(v >= 0.0, "negative channel at {t} K");
            }
        }
    }
}
