import type { Rng } from "../../../core/rng";
import { blank, glow, putRgb, setRough, tint, type Painted } from "../canvas";
import { fbm, hash2, worley } from "../noise";
import { hex, ramp } from "../palette";
import { cracks, grimeBand } from "./common";
import type { SurfaceSet } from "./types";

/** The Ember Forge: columnar basalt split by seams that still glow, iron
 * banding, soot, and floors veined with cooling magma. */

const BASALT = ramp(["#0c0b0e", "#151418", "#1e1c21", "#29262b", "#353036", "#443c3f"]);
const SEAM = hex("#060506");
const MAGMA = ramp(["#b31d00", "#ff4a0a", "#ff8a1f", "#ffc85a"], true);
const IRON = ramp(["#1b1a1d", "#2a282b", "#3a3637", "#4c4545"]);
const SOOT = hex("#050404");

export const forge: SurfaceSet = {
  wall(rng, variant) {
    const p = blank(64, 128, { rough: true, emit: true });
    basaltColumns(p, rng, 6, 2, 101 + variant, 0.1);
    grimeBand(p, 0, 0.3, SOOT, 1.1, 102);
    cracks(p, rng, 1, SEAM, 20, MAGMA(0.4));
    if (variant === 1) ironBand(p, rng, 52);
    if (variant === 2) magmaFissure(p, rng);
    heatGlowAtFoot(p);
    return p;
  },

  floor(rng) {
    const p = blank(128, 128, { rough: true, emit: true });
    // Cooled slabs over a magma bed: lava shows through a third of the seams.
    basaltColumns(p, rng, 5, 5, 111, 0.35);
    return p;
  },

  ceiling(rng) {
    const p = blank(64, 64, { rough: true, emit: true });
    basaltColumns(p, rng, 4, 4, 121, 0);
    grimeBand(p, 0, 1, SOOT, 0.7, 122);
    cracks(p, rng, 2, SEAM, 12, MAGMA(0.2));
    return p;
  },
};

/** Worley-cell basalt. `hotSeams` is the fraction of cell edges that glow. */
function basaltColumns(p: Painted, rng: Rng, cx: number, cy: number, seed: number, hotSeams: number) {
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const c = worley(x, y, p.w, p.h, cx, cy, seed);
      const edge = c.f2 - c.f1;
      const fine = rng.next();
      const n = fbm(x, y, p.w, p.h, 8, seed + 1);
      // Whether a seam glows is a property of the *pair* of cells, so it
      // runs its whole length instead of flickering pixel to pixel.
      const hot = hash2(Math.floor((c.id + c.id2) * 997), Math.floor(c.id * c.id2 * 997), seed) < hotSeams;
      if (edge < 0.06) {
        putRgb(p, x, y, SEAM, 0.02);
        setRough(p, x, y, 1);
        if (hot) {
          const heat = 1 - edge / 0.06;
          glow(p, x, y, MAGMA(0.3 + heat * 0.6));
          putRgb(p, x, y, MAGMA(heat * 0.4), 0.02);
        }
        continue;
      }
      const t = 0.15 + c.id * 0.5 + (n - 0.5) * 0.4 + (fine - 0.5) * 0.15 - (edge < 0.1 ? 0.12 : 0);
      putRgb(p, x, y, BASALT(t), 0.4 + Math.min(edge, 0.35) * 1.4 + fine * 0.08);
      setRough(p, x, y, 0.65 + fine * 0.25);
      // Stone beside a live seam is heat-scorched and faintly lit.
      if (hot && edge < 0.13) {
        const k = 1 - (edge - 0.06) / 0.07;
        tint(p, x, y, hex("#5a1c08"), k * 0.6);
        glow(p, x, y, MAGMA(0), k * 0.25);
      }
    }
  }
}

/** Riveted iron strap bolted across the stone. */
function ironBand(p: Painted, rng: Rng, y0: number) {
  for (let y = y0; y < y0 + 10; y++) {
    for (let x = 0; x < p.w; x++) {
      const edge = y === y0 || y === y0 + 9;
      const rivet = (y === y0 + 3 || y === y0 + 6) && x % 8 === 3;
      const rust = fbm(x, y, p.w, p.h, 16, 131) > 0.62;
      const col = rivet ? IRON(0.95) : edge ? IRON(0.1) : rust ? hex("#4a2a18") : IRON(0.35 + rng.next() * 0.3);
      putRgb(p, x, y, col, rivet ? 1 : edge ? 0.6 : 0.8);
      setRough(p, x, y, rust ? 0.95 : 0.45);
    }
  }
}

/** A wide molten crack from floor to midway up. */
function magmaFissure(p: Painted, rng: Rng) {
  let x = rng.int(20, 44);
  for (let y = p.h - 1; y > p.h * 0.3; y--) {
    if (rng.chance(0.35)) x += rng.chance(0.5) ? 1 : -1;
    const width = 1 + Math.round((y / p.h) * 2);
    for (let dx = -width - 2; dx <= width + 2; dx++) {
      const px = (x + dx + p.w) % p.w;
      const d = Math.abs(dx);
      if (d <= width) {
        const heat = 1 - d / (width + 1);
        putRgb(p, px, y, MAGMA(heat * 0.7), 0);
        glow(p, px, y, MAGMA(0.4 + heat * 0.6));
      } else tint(p, px, y, hex("#5a1e08"), 0.4);
    }
  }
}

/** Forge heat pools low: a faint ember wash at the foot of every wall. */
function heatGlowAtFoot(p: Painted) {
  const warm = hex("#ff5a10");
  for (let y = Math.floor(p.h * 0.88); y < p.h; y++) {
    const k = ((y - p.h * 0.88) / (p.h * 0.12)) ** 2 * 0.25;
    for (let x = 0; x < p.w; x++) glow(p, x, y, warm, k * (0.5 + fbm(x, y, p.w, p.h, 8, 141)));
  }
}
