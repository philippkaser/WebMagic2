/** Tiny color helpers for painters: every surface picks its tones from a
 * short hand-tuned ramp instead of free-floating rgb math, which is what
 * keeps a biome's palette cohesive. */

export type Rgb = [number, number, number];

export function hex(c: string): Rgb {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function scale(c: Rgb, k: number): Rgb {
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** A color ramp sampled at t∈[0,1]. Stepped (no blend) by default: the
 * banding IS the pixel-art look. */
export function ramp(stops: string[], smooth = false): (t: number) => Rgb {
  const cols = stops.map(hex);
  const n = cols.length - 1;
  return (t) => {
    const f = Math.max(0, Math.min(0.9999, t)) * (smooth ? n : n + 1);
    if (!smooth) return cols[Math.floor(f)];
    const i = Math.floor(f);
    return mix(cols[i], cols[Math.min(n, i + 1)], f - i);
  };
}
