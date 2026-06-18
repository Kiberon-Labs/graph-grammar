// Small dependency-free utilities: ids, seeded RNG, deep clone.

let _counter = 0
/** Short unique id. Not cryptographic; fine for graph elements. */
export function uid (prefix = 'n'): string {
  _counter = (_counter + 1) >>> 0
  return `${prefix}${Date.now().toString(36)}_${(_counter).toString(36)}_${Math.floor(
    Math.random() * 1e6
  ).toString(36)}`
}

/** Reset the local element counter (used by deterministic exports/tests). */
export function resetCounter () {
  _counter = 0
}

/**
 * Mulberry32 , a tiny, fast, decent-quality seeded PRNG. Deterministic given a
 * seed, which we need for reproducible stochastic grammar runs.
 */
export class RNG {
  private state: number
  constructor (seed: number) {
    this.state = seed >>> 0 || 1
  }

  next (): number {
    let t = (this.state += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  int (minInclusive: number, maxInclusive: number): number {
    return minInclusive + Math.floor(this.next() * (maxInclusive - minInclusive + 1))
  }

  float (min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)]
  }

  /** Fisher-Yates shuffle (in place) using this RNG. Returns the same array. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }

  /** Weighted pick. Returns index. */
  weightedIndex (weights: number[]): number {
    const total = weights.reduce((a, b) => a + b, 0)
    if (total <= 0) return Math.floor(this.next() * weights.length)
    let r = this.next() * total
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]
      if (r <= 0) return i
    }
    return weights.length - 1
  }
}

export function deepClone<T> (obj: T): T {
  // structuredClone is available in Node 18+ and all modern browsers.
  return structuredClone(obj)
}

export function clamp (v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
