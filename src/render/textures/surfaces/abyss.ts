import type { Rng } from "../../../core/rng";
import { blank, glow, putRgb, setRough, tint, type Painted } from "../canvas";
import { fbm, ridge, worley } from "../noise";
import { hex, ramp } from "../palette";
import { carveGlyph, glyph } from "./common";
import { CEIL_TEX, FLOOR_TEX, WALL_TEX_H, WALL_TEX_W, foot, tallness, type SurfaceSet } from "./types";

/** The abyss — worn by the Hollow, our deepest band: flesh-stone, masonry
 * that has started to become a body. Sinew-veined cells, carved rune bands
 * bleeding crimson light, and eyes that open in the walls (the silence down
 * there listens back). Floors are black ribbed obsidian over red seams.
 * (Ported from the artpass branch.) */

const FLESH = ramp(["#0e0407", "#1a070c", "#2a0c13", "#3c121a", "#521c22", "#6a2a2a"]);
const SINEW = hex("#08020a");
const BLOOD = ramp(["#5a0010", "#b3001e", "#ff2a3a", "#ff8a7a"], true);
const OBSIDIAN = ramp(["#050407", "#0b090e", "#131018", "#1c1722"]);
const IRIS = ramp(["#6a3a00", "#ffae1a", "#fff2a0"], true);

export const abyss: SurfaceSet = {
  wall(rng, variant) {
    const p = blank(WALL_TEX_W, WALL_TEX_H, { rough: true, emit: true });
    // Nine cell rows per artpass wall; keep the cells' proportions.
    fleshStone(p, rng, 201 + variant, Math.round(9 * tallness(p)));
    if (variant === 1) runeBand(p, rng, foot(p, 44));
    if (variant === 2) eye(p, 32, foot(p, 58));
    else runeBand(p, rng, foot(p, variant === 0 ? 92 : 30), 0.5);
    return p;
  },

  floor(rng) {
    const p = blank(FLOOR_TEX, FLOOR_TEX, { rough: true, emit: true });
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        const rib = Math.sin((x + fbm(x, y, p.w, p.h, 3, 211) * 20) * 0.39);
        const n = fbm(x, y, p.w, p.h, 8, 212);
        const t = 0.2 + rib * 0.25 + (n - 0.5) * 0.4 + (rng.next() - 0.5) * 0.1;
        putRgb(p, x, y, OBSIDIAN(t), 0.4 + rib * 0.3);
        setRough(p, x, y, 0.2 + n * 0.3);
        const r = ridge(x, y, p.w, p.h, 3, 213);
        if (r > 0.972) {
          putRgb(p, x, y, BLOOD(0.2), 0.02);
          glow(p, x, y, BLOOD((r - 0.972) * 30));
        }
      }
    return p;
  },

  ceiling(rng) {
    const p = blank(CEIL_TEX, CEIL_TEX, { rough: true, emit: true });
    fleshStone(p, rng, 221, 9);
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) tint(p, x, y, SINEW, 0.35);
    return p;
  },
};

/** Organic cells separated by dark sinew, pulsing faintly along the veins. */
function fleshStone(p: Painted, rng: Rng, seed: number, rows: number) {
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const c = worley(x, y, p.w, p.h, 5, rows, seed);
      const edge = c.f2 - c.f1;
      const n = fbm(x, y, p.w, p.h, 8, seed + 1);
      if (edge < 0.09) {
        const k = 1 - edge / 0.09;
        putRgb(p, x, y, SINEW, 0.1);
        setRough(p, x, y, 0.35);
        if (c.id < 0.35) glow(p, x, y, BLOOD(0.1), k * 0.6);
        continue;
      }
      // Cells bulge: bright center, darker rim.
      const t = 0.1 + c.id * 0.3 + (1 - c.f1) * 0.35 + (n - 0.5) * 0.3 + (rng.next() - 0.5) * 0.1;
      putRgb(p, x, y, FLESH(t), 0.3 + (1 - c.f1) * 0.6);
      setRough(p, x, y, 0.4 + n * 0.3);
    }
}

/** A carved stone strip with a row of glowing glyphs. */
function runeBand(p: Painted, rng: Rng, y0: number, brightness = 1) {
  for (let y = y0; y < y0 + 11; y++)
    for (let x = 0; x < p.w; x++) {
      const lip = y === y0 || y === y0 + 10;
      putRgb(p, x, y, OBSIDIAN(lip ? 0.7 : 0.35 + rng.next() * 0.15), lip ? 0.8 : 0.6);
      setRough(p, x, y, 0.3);
    }
  for (let g = 0; g < 8; g++) {
    const bits = glyph(rng, 5, 7);
    carveGlyph(p, bits, 5, g * 8 + 1, y0 + 2, BLOOD(0.3), BLOOD(0.55 * brightness + 0.1));
  }
}

/** An eye grown into the stone. */
function eye(p: Painted, cx: number, cy: number) {
  const rx = 14;
  const ry = 7;
  for (let y = cy - ry - 3; y <= cy + ry + 3; y++)
    for (let x = cx - rx - 3; x <= cx + rx + 3; x++) {
      const dx = (x - cx) / rx;
      const lid = 1 - dx * dx;
      const dy = (y - cy) / ry;
      if (Math.abs(dy) > lid + 0.35) continue;
      if (Math.abs(dy) > lid) {
        putRgb(p, x, y, FLESH(0.9), 0.95); // swollen lid
        continue;
      }
      const d = Math.hypot(x - cx, (y - cy) * 1.1);
      if (d < 2) putRgb(p, x, y, SINEW, 0.2); // slit pupil
      else if (d < 6.5) {
        putRgb(p, x, y, IRIS(1 - d / 6.5), 0.5);
        glow(p, x, y, IRIS(1 - d / 7));
      } else {
        putRgb(p, x, y, hex("#b8a890"), 0.6);
        glow(p, x, y, hex("#401010"));
      }
      setRough(p, x, y, 0.08);
    }
  // Vertical slit: a goat-like pupil reads as "wrong" instantly.
  for (let y = cy - 5; y <= cy + 5; y++) putRgb(p, cx, y, SINEW, 0.2);
}
