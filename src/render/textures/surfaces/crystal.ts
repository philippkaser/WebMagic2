import type { Rng } from "../../../core/rng";
import { blank, glow, putRgb, setRough, tint, type Painted } from "../canvas";
import { fbm, ridge, worley } from "../noise";
import { hex, mix, ramp, type Rgb } from "../palette";
import { CEIL_TEX, FLOOR_TEX, WALL_TEX_H, WALL_TEX_W, foot, type SurfaceSet } from "./types";

/** The Crystal Deep: raw indigo cave rock in warped strata, threaded with
 * glowing crystal veins; geodes break the wall open; the ceiling is a field
 * of glints like a night sky turned inside out. (Ported from the artpass
 * branch's Crystal Hollows.) */

const ROCK = ramp(["#100d20", "#19152e", "#231d3e", "#2f2750", "#3d3262", "#4e4176"]);
const CRYSTAL = ramp(["#3a2a8a", "#5a4ad8", "#62b8ff", "#b8f4ff"], true);
const PINK = ramp(["#6a1a7a", "#c04ad8", "#ff9af0"], true);

export const crystal: SurfaceSet = {
  wall(rng, variant) {
    const p = blank(WALL_TEX_W, WALL_TEX_H, { rough: true, emit: true });
    strata(p, rng, 151 + variant);
    veins(p, 152 + variant, variant === 2 ? PINK : CRYSTAL, 0.965);
    if (variant === 1) geode(p, rng, 32, foot(p, 60), 13);
    if (variant === 2) for (let i = 0; i < 3; i++) geode(p, rng, rng.int(8, 56), rng.int(20, p.h - 18), rng.int(5, 8));
    return p;
  },

  floor(rng) {
    const p = blank(FLOOR_TEX, FLOOR_TEX, { rough: true, emit: true });
    // Polished dark stone — the hollows' floors were worn smooth by something.
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        const c = worley(x, y, p.w, p.h, 6, 6, 161);
        const n = fbm(x, y, p.w, p.h, 6, 162);
        const edge = c.f2 - c.f1;
        const t = 0.1 + c.id * 0.35 + (n - 0.5) * 0.3 + (rng.next() - 0.5) * 0.1 - (edge < 0.08 ? 0.15 : 0);
        putRgb(p, x, y, ROCK(t), edge < 0.05 ? 0.1 : 0.5 + n * 0.2);
        setRough(p, x, y, edge < 0.05 ? 0.9 : 0.25 + n * 0.25);
      }
    // Sparse on the floor: it tiles across the whole level, so dense veins
    // turn into a wall of glowing noise.
    veins(p, 163, CRYSTAL, 0.988, 0.62);
    return p;
  },

  ceiling(rng) {
    const p = blank(CEIL_TEX, CEIL_TEX, { rough: true, emit: true });
    strata(p, rng, 171);
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        tint(p, x, y, hex("#05040c"), 0.5);
        if (rng.chance(0.0025)) glow(p, x, y, rng.chance(0.3) ? PINK(0.9) : CRYSTAL(0.6 + rng.next() * 0.4));
      }
    return p;
  },
};

/** Warped sedimentary bands. */
function strata(p: Painted, rng: Rng, seed: number) {
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const warp = fbm(x, y, p.w, p.h, 3, seed) * 18;
      const band = Math.sin((y + warp) * 0.35) * 0.5 + 0.5;
      const n = fbm(x, y, p.w, p.h, 10, seed + 1);
      const t = 0.15 + band * 0.35 + (n - 0.5) * 0.4 + (rng.next() - 0.5) * 0.12;
      putRgb(p, x, y, ROCK(t), 0.35 + band * 0.3 + n * 0.3);
      setRough(p, x, y, 0.85);
    }
}

/** Ridged-noise crystal veins: bright, glossy and emissive. A low-frequency
 * mask keeps them to a few seams per surface so the rock still reads. */
function veins(p: Painted, seed: number, tone: (t: number) => Rgb, threshold: number, mask = 0.5) {
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      if (fbm(x, y, p.w, p.h, 2, seed + 50, 2) < mask) continue;
      const r = ridge(x, y, p.w, p.h, 2, seed);
      if (r < threshold) {
        if (r > threshold - 0.04) tint(p, x, y, tone(0.1), 0.35); // mineral halo
        continue;
      }
      const k = (r - threshold) / (1 - threshold);
      putRgb(p, x, y, tone(0.4 + k * 0.6), 0.9);
      glow(p, x, y, tone(0.3 + k * 0.7));
      setRough(p, x, y, 0.1);
    }
}

/** A cracked-open geode: dark rim, faceted glowing crystal core. */
function geode(p: Painted, rng: Rng, cx: number, cy: number, r: number) {
  const tone = rng.chance(0.5) ? CRYSTAL : PINK;
  for (let y = cy - r - 2; y <= cy + r + 2; y++)
    for (let x = cx - r - 2; x <= cx + r + 2; x++) {
      if (y < 0 || y >= p.h) continue;
      const px = (x + p.w) % p.w;
      const d = Math.hypot(x - cx, (y - cy) * 0.8) / r;
      if (d > 1.12) continue;
      if (d > 0.92) {
        putRgb(p, px, y, hex("#07050e"), 0.2);
        continue;
      }
      // Facets: flat-shaded wedges pointing to the center.
      const a = Math.atan2(y - cy, x - cx);
      const facet = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 9);
      const k = (1 - d) * 0.6 + (facet % 3) * 0.15;
      putRgb(p, px, y, mix(tone(0.3), tone(0.95), k), 0.3 + (1 - d) * 0.7 + (facet % 2) * 0.1);
      glow(p, px, y, tone(0.2 + k * 0.8), 0.3 + k * 0.4);
      setRough(p, px, y, 0.08);
    }
}
