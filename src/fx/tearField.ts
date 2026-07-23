/** The between-floors passage, drawn to look like the portal you stepped
 * into. `render/RiftPortal.tsx` runs a procedural fragment shader for the
 * wound — a ragged vertical slit, domain-warped void swirl, dead stars deep
 * inside, a white-hot frayed rim, all snapped to fat pixels. This is that
 * same shader ported to a tiny 2D buffer (upscaled with the pixelated hint),
 * staged as a journey *through* the tear:
 *
 *   enter — the wound rushes up and yawns open until it swallows the eye;
 *   exit  — a rip of the far side tears open ahead and widens you back out.
 *
 * Rendered into a handful of thousand fat pixels, so the whole warp is
 * intrinsically chunky and cheap no matter the screen. */

export type TearMode = "enter" | "exit";

const fract = (v: number) => v - Math.floor(v);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** Snap a level to `n` bands so gradients stay chunky. Mirrors the shader's
 * `floor(col * 8.0) / 8.0`. */
const band = (v: number, n: number) => Math.floor(v * n) / n;

// Value-noise fbm, byte-for-byte the same as the portal shader so the warp
// grain matches the wound it came out of.
function hash(x: number, y: number): number {
  let px = fract(x * 234.34);
  let py = fract(y * 435.345);
  const d = px * (px + 34.23) + py * (py + 34.23);
  px += d;
  py += d;
  return fract(px * py);
}
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
function fbm(x: number, y: number): number {
  let v = 0;
  let a = 0.5;
  for (let i = 0; i < 4; i++) {
    v += a * vnoise(x, y);
    const nx = x * 2.13 + 17.0;
    const ny = y * 2.13 + 9.2;
    x = nx;
    y = ny;
    a *= 0.5;
  }
  return v;
}

const DEEP_R = 0.012;
const DEEP_G = 0.004;
const DEEP_B = 0.028;

/** Fill `data` (an RGBA buffer of `gw * gh` fat pixels) with the tear for the
 * given moment. `t` is seconds since the passage began. */
export function renderTear(
  data: Uint8ClampedArray,
  gw: number,
  gh: number,
  t: number,
  seed: number,
  mode: TearMode,
): void {
  // Passage envelope — how wide the wound gapes (`open`), how far the interior
  // has rushed toward the eye (`zoom`), and, on the way out, how much of the
  // void has bled away (`fade`).
  let open: number;
  let zoom: number;
  let fade: number;
  let st: number; // interior swirl time
  if (mode === "enter") {
    // Pulled in: the slit tears wide over the first beat, then holds deep in
    // the void with a slow forward drift so the crossing keeps travelling.
    const dive = clamp01(t / 0.7);
    const eased = 1 - (1 - dive) * (1 - dive);
    open = 0.7 + eased * 5.6;
    zoom = 1 + eased * 1.7 + Math.max(0, t - 0.7) * 0.32;
    fade = 0;
    st = t * 1.15;
  } else {
    // Breaking out: a rip of the far side yawns open ahead, accelerating, then
    // the last of the void drains off once you are through.
    const emerge = clamp01(t / 0.62);
    open = emerge * emerge * 6.2;
    zoom = 2.3 - emerge * 1.35;
    fade = smoothstep(0.62, 0.96, t);
    st = 0.9 + t * 1.15;
  }
  const invZoom = 1 / zoom;

  let o = 0;
  for (let py = 0; py < gh; py++) {
    const uvy = (py + 0.5) / gh;
    const cy = (uvy - 0.5) * 2.0;
    // Ragged silhouette: a vertical slit whose lips rip open and shut with
    // noise, pinned toward the tips so it stays a tear.
    const rip = fbm(uvy * 5.0 + seed, st * 0.8) - 0.5;
    const lip = 1 - smoothstep(0.0, 1.05, Math.abs(cy));
    const halfWidth = Math.max(lip * (0.42 + rip * 0.3) * open, 1e-4);
    for (let px = 0; px < gw; px++, o += 4) {
      const uvx = (px + 0.5) / gw;
      const cx = (uvx - 0.5) * 2.0;
      const d = Math.abs(cx) / halfWidth;

      // Interior: coordinates dragged around the wound and warped twice, with
      // the whole field magnified as it rushes past — the sense of travel.
      const zx = cx * invZoom;
      const zy = cy * invZoom;
      const ang = Math.atan2(zy, zx);
      const r = Math.sqrt(zx * zx + zy * zy);
      const spin = ang + r * 5.0 - st * 2.4;
      const swx = Math.cos(spin) * r;
      const swy = Math.sin(spin) * r;
      const inner = fbm(swx * 5.2 + st, swy * 5.2 + st) * 1.5 - st * 0.4;
      const m = fbm(swx * 2.6 + inner, swy * 2.6 + inner);

      // Colour drifts teal at the core toward violet at the rim — the palette
      // shared by the portals and the warp.
      const vio = clamp01(r * 0.8);
      const colR = 0.2 + vio * 0.55;
      const colG = 0.95 - vio * 0.5;
      const colB = 0.85 + vio * 0.15;

      // Void only lights up inside the lips; a fat pixel just outside stays
      // near-black so the wound reads against the dark.
      const insideS = 1 - smoothstep(0.92, 1.05, d);
      const glow = smoothstep(0.2, 0.85, m) * insideS;
      let R = DEEP_R * (1 - glow) + colR * 0.55 * glow;
      let G = DEEP_G * (1 - glow) + colG * 0.55 * glow;
      let B = DEEP_B * (1 - glow) + colB * 0.55 * glow;
      const p3 = m * m * m * insideS;
      R += colR * p3 * 2.2;
      G += colG * p3 * 2.2;
      B += colB * p3 * 2.2;
      // Dead stars strewn on the far side.
      const twk = Math.floor(st * 3.0) * 0.31 + seed;
      if (insideS > 0.5 && hash(uvx * 93.0 + twk, uvy * 97.0 + twk) >= 0.982) {
        R += 1;
        G += 1;
        B += 1;
      }
      // The frayed rim burns white-hot — a ridge riding the lip of the tear.
      const rim = smoothstep(0.5, 1.0, d) * (1 - smoothstep(1.0, 1.7, d));
      const rimP = rim * rim * rim;
      R += (colR * 1.6 + 0.85) * rimP * 1.4;
      G += (colG * 1.6 + 0.85) * rimP * 1.4;
      B += (colB * 1.6 + 0.85) * rimP * 1.4;
      // Chunky pixels deserve chunky colours.
      R = band(R, 8);
      G = band(G, 8);
      B = band(B, 8);

      let a: number;
      if (mode === "enter") {
        // The veil covers the tearing-down scene entirely.
        a = 1;
      } else if (d < 0.98) {
        // Through the rip you can see the far side (the live scene beneath);
        // only the frayed lip of the opening still glows.
        const openLip = smoothstep(0.62, 0.98, d);
        R = band(colR * 1.6 + 0.9, 8);
        G = band(colG * 1.6 + 0.9, 8);
        B = band(colB * 1.6 + 0.9, 8);
        a = openLip * (1 - fade);
      } else {
        // The not-yet-torn void still hangs over the scene, draining off as
        // you finish stepping through.
        a = 1 - fade;
      }

      data[o] = R * 255;
      data[o + 1] = G * 255;
      data[o + 2] = B * 255;
      data[o + 3] = a * 255;
    }
  }
}
