import type { CanvasTexture } from "three";
import { Rng } from "../../core/rng";
import { blank, toTexture, type Painted } from "../../render/textures/canvas";
import { glyph } from "../../render/textures/surfaces/common";

/** Alpha-cut pixel decals: the corner cobweb and the rune circle. Drawn
 * with integer plots (no canvas antialiasing) so they stay as crisp as the
 * painted surfaces around them. */

let web: CanvasTexture | null = null;
let rune: CanvasTexture | null = null;

function plot(p: Painted, x: number, y: number, v = 255) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  const i = (y * p.w + x) * 4;
  p.color[i] = v;
  p.color[i + 1] = v;
  p.color[i + 2] = v;
  p.color[i + 3] = 255;
}

function line(p: Painted, x0: number, y0: number, x1: number, y1: number, v = 255) {
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
  for (let i = 0; i <= n; i++) plot(p, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, v);
}

/** Threads fanning down from the top edge, with sagging spiral rungs. */
export function webTexture(): CanvasTexture {
  if (web) return web;
  const p = blank(64, 64);
  const rng = new Rng(77);
  const spokes = 9;
  const angle = (i: number) => (i / (spokes - 1)) * Math.PI;
  for (let i = 0; i < spokes; i++) {
    const a = angle(i);
    line(p, 32, 0, 32 + Math.cos(a) * 34, Math.sin(a) * 60, 200);
  }
  for (let r = 6; r < 60; r += rng.int(5, 8)) {
    for (let i = 0; i < spokes - 1; i++) {
      if (rng.chance(0.12)) continue; // torn strands
      const a0 = angle(i);
      const a1 = angle(i + 1);
      const x0 = 32 + Math.cos(a0) * r * 0.57;
      const y0 = Math.sin(a0) * r;
      const x1 = 32 + Math.cos(a1) * r * 0.57;
      const y1 = Math.sin(a1) * r;
      const sag = r * 0.08;
      line(p, x0, y0, (x0 + x1) / 2, (y0 + y1) / 2 - sag, 170);
      line(p, (x0 + x1) / 2, (y0 + y1) / 2 - sag, x1, y1, 170);
    }
  }
  web = toTexture(p.color, 64, 64, true, 1, 1);
  return web;
}

/** Double ring of glyphs around a star polygon. Grayscale: the material's
 * color tints it per biome. */
export function runeCircleTexture(): CanvasTexture {
  if (rune) return rune;
  const S = 128;
  const p = blank(S, S);
  const rng = new Rng(1337);
  const c = S / 2;
  const ring = (r: number, v: number) => {
    const steps = Math.ceil(r * 7);
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      plot(p, c + Math.cos(a) * r, c + Math.sin(a) * r, v);
    }
  };
  ring(62, 255);
  ring(60, 200);
  ring(47, 255);
  ring(30, 160);
  // Glyph band between the outer rings.
  const glyphs = 14;
  for (let g = 0; g < glyphs; g++) {
    const bits = glyph(rng, 5, 7);
    const a = (g / glyphs) * Math.PI * 2;
    const gx = c + Math.cos(a) * 53.5 - 2;
    const gy = c + Math.sin(a) * 53.5 - 3;
    for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) if (bits[y * 5 + x]) plot(p, gx + x, gy + y, 230);
  }
  // Heptagram: every third vertex of a heptagon.
  const pts = Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * Math.PI * 2 - Math.PI / 2;
    return [c + Math.cos(a) * 46, c + Math.sin(a) * 46];
  });
  for (let i = 0; i < 7; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 3) % 7];
    line(p, x0, y0, x1, y1, 210);
  }
  // A small eye of light at the heart.
  for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) if (x * x + y * y <= 9) plot(p, c + x, c + y, 255);
  rune = toTexture(p.color, S, S, true, 1, 1);
  rune.center.set(0.5, 0.5);
  return rune;
}
