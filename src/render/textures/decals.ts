import { Rng } from "../../core/rng";
import { blank, type Painted } from "./canvas";
import { glyph } from "./surfaces/common";

/** Alpha-cut pixel decals, drawn with integer plots (no canvas
 * antialiasing) so they stay as crisp as the painted surfaces around them.
 * Ported from the artpass branch: the arrival sigil — the magic circle
 * under a wizard's feet where they step onto a floor. */

/** Edge length of the rune circle decal. */
export const RUNE_CIRCLE_SIZE = 128;

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

/** Double ring of glyphs around a heptagram, with a small eye of light at
 * the heart. Grayscale on black: the material's color tints it per biome,
 * and it's drawn additively, so black is simply "no light". */
export function paintRuneCircle(): Painted {
  const S = RUNE_CIRCLE_SIZE;
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
  return p;
}
