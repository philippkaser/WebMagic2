import { DataTexture, LinearFilter, RGBAFormat, UnsignedByteType } from "three";
import { Rng } from "../../core/rng";

/** The glass in front of the eye: smudges, dried droplets and a few wipes,
 * painted procedurally once (no image files — the zero-binary-assets rule)
 * into a small texture. It's invisible until light falls through it — the
 * composite multiplies it by the bloom and the streaks — so it only shows
 * when you face something bright: the moon, a blast, the forge's fire.
 *
 * Values are 0…1 per channel, slightly warm or cool per mark, so the glass
 * catches a little colour of its own. */

export const DIRT_W = 384;
export const DIRT_H = 216;

/** The dirt as raw RGBA bytes (exported for tests). */
export function paintLensDirt(seed = 0x5eed1e5): Uint8Array {
  const rng = new Rng(seed);
  const acc = new Float32Array(DIRT_W * DIRT_H * 3);
  const stamp = (cx: number, cy: number, rx: number, ry: number, angle: number, amount: number, ring: number, tint: [number, number, number]) => {
    const r = Math.max(rx, ry);
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const x0 = Math.max(0, Math.floor(cx - r - 1));
    const x1 = Math.min(DIRT_W - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1));
    const y1 = Math.min(DIRT_H - 1, Math.ceil(cy + r + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const u = (dx * ca + dy * sa) / rx;
        const v = (-dx * sa + dy * ca) / ry;
        const d = Math.sqrt(u * u + v * v);
        if (d >= 1) continue;
        // A soft blob, or (ring) a dried droplet: darker middle, bright rim.
        const soft = (1 - d * d) ** 2;
        const rim = Math.exp(-(((d - 0.85) / 0.1) ** 2));
        const a = amount * (ring > 0 ? soft * (1 - ring) * 0.35 + rim * ring : soft);
        const i = (y * DIRT_W + x) * 3;
        acc[i] += a * tint[0];
        acc[i + 1] += a * tint[1];
        acc[i + 2] += a * tint[2];
      }
    }
  };
  const tint = (): [number, number, number] => {
    const t = rng.range(-1, 1) * 0.12;
    return [1 + t, 1, 1 - t];
  };
  // Big faint smudges (a thumb's been here).
  for (let i = 0; i < 26; i++) {
    const r = rng.range(18, 60);
    stamp(rng.range(0, DIRT_W), rng.range(0, DIRT_H), r, r * rng.range(0.6, 1), rng.range(0, Math.PI), rng.range(0.05, 0.14), 0, tint());
  }
  // Dried droplets, mostly toward the edges of the glass: soft spots with
  // only a hint of a rim (a hard ring reads as a bubble, not dirt), each a
  // little out of round.
  for (let i = 0; i < 55; i++) {
    const r = rng.range(2, 8);
    const edge = rng.next() < 0.7;
    const x = edge ? (rng.next() < 0.5 ? rng.range(0, DIRT_W * 0.3) : rng.range(DIRT_W * 0.7, DIRT_W)) : rng.range(0, DIRT_W);
    stamp(x, rng.range(0, DIRT_H), r, r * rng.range(0.6, 0.95), rng.range(0, Math.PI), rng.range(0.12, 0.3), rng.range(0.1, 0.3), tint());
  }
  // Specks.
  for (let i = 0; i < 160; i++) {
    const r = rng.range(0.8, 2.2);
    stamp(rng.range(0, DIRT_W), rng.range(0, DIRT_H), r, r, 0, rng.range(0.2, 0.7), 0, tint());
  }
  // A few wipes: long thin streaks at a slant.
  for (let i = 0; i < 5; i++) {
    const len = rng.range(50, 140);
    stamp(rng.range(0, DIRT_W), rng.range(0, DIRT_H), len, rng.range(2, 5), rng.range(-0.5, 0.5) + (rng.next() < 0.5 ? 0 : Math.PI / 2), rng.range(0.08, 0.18), 0, tint());
  }
  const out = new Uint8Array(DIRT_W * DIRT_H * 4);
  for (let p = 0; p < DIRT_W * DIRT_H; p++) {
    for (let c = 0; c < 3; c++) out[p * 4 + c] = Math.round(Math.min(1, acc[p * 3 + c]) * 255);
    out[p * 4 + 3] = 255;
  }
  return out;
}

export function makeLensDirt(): DataTexture {
  const tex = new DataTexture(paintLensDirt(), DIRT_W, DIRT_H, RGBAFormat, UnsignedByteType);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
