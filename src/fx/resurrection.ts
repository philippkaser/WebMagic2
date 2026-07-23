/** Coming back to the living world — leaving the dungeon with your loot, or
 * being dragged back up after death. Same chunky tear as the descent
 * (fx/tearField.ts), but recast as a resurrection: a warm gold wound instead
 * of a cold one, a heart kicking back into a quickening beat, life flooding up
 * from below, and embers of it rising past you as you surface.
 *
 * `renderRise` is the crossing (an opaque veil over the held loading phase);
 * `renderWake` is the arrival (drains off the live village as your eyes open,
 * with one last settling throb). Both layer their warmth on top of the tear
 * buffer, so the passage still reads as the same tear you fell through — only
 * now it is giving you back. */

import { renderTear } from "./tearField";

// Warm gold wound, blood surging back through it. Independent of whichever
// portal you used, so death and the gold "leave" portal both feel like life
// returning rather than the cold fall down.
const GOLD: readonly [number, number, number] = [1.0, 0.7, 0.26];
const BLOOD: readonly [number, number, number] = [0.8, 0.07, 0.05];
const LIFE: readonly [number, number, number] = [1.0, 0.9, 0.62];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** A heart restarting: a few beats, quickening and strengthening as life takes
 * hold. Returns 0..1, spiking sharply at each beat. */
function heartbeat(t: number): number {
  // lub-dub pairs, accelerating toward the surface.
  const beats: readonly [number, number][] = [
    [0.14, 0.45],
    [0.3, 0.4],
    [0.56, 0.62],
    [0.72, 0.55],
    [0.96, 0.85],
    [1.09, 1.0],
  ];
  let v = 0;
  for (let i = 0; i < beats.length; i++) {
    const d = (t - beats[i][0]) / 0.045;
    v = Math.max(v, beats[i][1] * Math.exp(-d * d));
  }
  return v;
}

// Cheap deterministic per-ember jitter.
const frac = (v: number) => v - Math.floor(v);
const eHash = (i: number) => frac(Math.sin(i * 12.9898) * 43758.5453);

/** Splat the rising embers of life onto the buffer. */
function embers(data: Uint8ClampedArray, gw: number, gh: number, t: number, glow: number): void {
  const N = 26;
  for (let i = 0; i < N; i++) {
    const speed = 0.35 + eHash(i) * 0.5;
    const off = eHash(i + 100);
    const baseX = 0.12 + eHash(i + 200) * 0.76;
    // Rise from the bottom to the top, wrapping.
    const yy = 1 - frac(t * speed + off);
    const xx = baseX + Math.sin(t * 1.7 + i) * 0.02;
    const px = (xx * gw) | 0;
    const py = (yy * gh) | 0;
    if (px < 0 || px >= gw || py < 0 || py >= gh) continue;
    const bright = (0.5 + 0.5 * glow) * (0.4 + 0.6 * yy); // dimmer as they die at the top
    const size = eHash(i + 300) < 0.7 ? 1 : 2;
    for (let sy = 0; sy < size; sy++) {
      for (let sx = 0; sx < size; sx++) {
        const x = px + sx;
        const y = py + sy;
        if (x >= gw || y >= gh) continue;
        const o = (y * gw + x) * 4;
        data[o] = data[o] + GOLD[0] * bright * 255;
        data[o + 1] = data[o + 1] + GOLD[1] * bright * 210;
        data[o + 2] = data[o + 2] + GOLD[2] * bright * 150;
      }
    }
  }
}

/** The ascent: the gold tear swallows you and life floods back. Opaque. */
export function renderRise(data: Uint8ClampedArray, gw: number, gh: number, t: number, seed: number): void {
  // The wound itself — the same tear, warmed to gold.
  renderTear(data, gw, gh, t, seed, "enter", GOLD);

  const beat = heartbeat(t);
  const life = clamp01(t / 1.15);

  let o = 0;
  for (let py = 0; py < gh; py++) {
    const uvy = (py + 0.5) / gh;
    const vert = 1 - uvy; // 1 at the top: the surface, the light above
    // Warm gold light floods in, strongest toward the surface, rising with life.
    const warm = clamp01(life * (0.22 + 0.85 * vert)) * 0.5;
    // Heartbeat drives blood back through the body — felt lowest, in the chest.
    const surge = beat * (0.3 + 0.7 * uvy);
    for (let px = 0; px < gw; px++, o += 4) {
      data[o] = data[o] + (warm * GOLD[0] + surge * BLOOD[0]) * 255;
      data[o + 1] = data[o + 1] + (warm * GOLD[1] + surge * BLOOD[1]) * 255;
      data[o + 2] = data[o + 2] + (warm * GOLD[2] + surge * BLOOD[2]) * 255;
    }
  }

  embers(data, gw, gh, t, beat);
}

/** The arrival: the gold tear tears open over the waking village, then the last
 * of the warmth drains off with one settling throb — eyes opening. */
export function renderWake(data: Uint8ClampedArray, gw: number, gh: number, t: number, seed: number): void {
  // The far side rips open over the live scene (renderTear handles the reveal).
  renderTear(data, gw, gh, t, seed, "exit", GOLD);

  // A slowing heartbeat and a warm haze that recedes as vision returns.
  const beat = heartbeat(0.5 + t * 0.7);
  const fade = 1 - clamp01(t / 0.95);
  const cx = gw * 0.5;
  const cy = gh * 0.5;
  const maxD = Math.hypot(cx, cy);

  let o = 0;
  for (let py = 0; py < gh; py++) {
    for (let px = 0; px < gw; px++, o += 4) {
      const a = data[o + 3];
      if (a <= 0) continue; // clear where the world already shows through
      // Vision returns from the centre outward — warmth lingers at the edges.
      const edge = Math.hypot(px - cx, py - cy) / maxD;
      const warm = fade * (0.25 + 0.55 * edge);
      const throb = beat * fade * 0.5;
      data[o] = data[o] + (warm * LIFE[0] + throb * BLOOD[0]) * 255;
      data[o + 1] = data[o + 1] + (warm * LIFE[1] + throb * BLOOD[1]) * 210;
      data[o + 2] = data[o + 2] + (warm * LIFE[2] + throb * BLOOD[2]) * 150;
    }
  }
}
