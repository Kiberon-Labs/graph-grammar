use serde_json::Value;

// ============================================================================
// RNG ,a bit-for-bit port of util.ts `RNG` (Mulberry32). The TS state is a JS
// number that the bitwise ops reduce mod 2^32 every step, so a `u32` that wraps
// by the constant reproduces it exactly. `int`/`float`/`shuffle` mirror the TS
// methods; `iter_random` mirrors LabelBucket.iterRandom (the stochastic seed
// walk). Matching these call-for-call is what makes seeded runs reproducible.
// ============================================================================

pub(crate) struct Rng {
    state: u32,
}

impl Rng {
    pub(crate) fn new(seed: u32) -> Self {
        Rng { state: if seed == 0 { 1 } else { seed } }
    }

    pub(crate) fn next(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6d2b_79f5);
        let mut t = self.state;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f64) / 4_294_967_296.0
    }

    pub(crate) fn int(&mut self, min: f64, max: f64) -> f64 {
        min + (self.next() * (max - min + 1.0)).floor()
    }

    pub(crate) fn float(&mut self, min: f64, max: f64) -> f64 {
        min + self.next() * (max - min)
    }

    /// Fisher-Yates, in place ,mirrors the local `shuffle` in findMatches and
    /// RNG.shuffle (consumes `len - 1` draws).
    pub(crate) fn shuffle<T>(&mut self, arr: &mut [T]) {
        if arr.len() < 2 {
            return;
        }
        let mut i = arr.len() - 1;
        while i > 0 {
            let j = (self.next() * ((i + 1) as f64)).floor() as usize;
            arr.swap(i, j);
            i -= 1;
        }
    }

    /// Weighted index ,mirrors RNG.weightedIndex (consumes 1 draw).
    pub(crate) fn weighted_index(&mut self, weights: &[f64]) -> usize {
        let total: f64 = weights.iter().sum();
        if total <= 0.0 {
            return (self.next() * (weights.len() as f64)).floor() as usize;
        }
        let mut r = self.next() * total;
        for (i, w) in weights.iter().enumerate() {
            r -= w;
            if r <= 0.0 {
                return i;
            }
        }
        weights.len() - 1
    }

    /// Mirror of LabelBucket.iterRandom: a full-cycle stride walk. Consumes 2
    /// draws when `arr.len() > 1`, none for length 0 or 1.
    pub(crate) fn iter_random(&mut self, arr: &[String]) -> Vec<String> {
        let l = arr.len();
        if l == 0 {
            return Vec::new();
        }
        if l == 1 {
            return vec![arr[0].clone()];
        }
        let mut stride = 1 + (self.next() * ((l - 1) as f64)).floor() as usize;
        while gcd(stride, l) != 1 {
            stride = (stride % (l - 1)) + 1;
        }
        let start = (self.next() * (l as f64)).floor() as usize;
        (0..l).map(|i| arr[(start + i * stride) % l].clone()).collect()
    }
}

fn gcd(mut a: usize, mut b: usize) -> usize {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}

/// Coerce a computed number to a JSON value the way JS JSON.stringify does:
/// integral values become integers (so they compare equal to the engine's
/// `5`, not `5.0`), everything else stays a float.
pub(crate) fn number_value(f: f64) -> Value {
    if f.is_finite() && f.fract() == 0.0 && f >= i64::MIN as f64 && f <= i64::MAX as f64 {
        Value::from(f as i64)
    } else {
        Value::from(f)
    }
}
