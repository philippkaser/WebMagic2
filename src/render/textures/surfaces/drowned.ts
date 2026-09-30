import type { Rng } from "../../../core/rng";
import { blank, glow, putRgb, setRough, tint, type Painted } from "../canvas";
import { fbm } from "../noise";
import { hex, ramp } from "../palette";
import { cracks, drips, paintBlocks, paintFlagstones, puddles } from "./common";
import type { SurfaceSet } from "./types";

/** The Drowned Crypts: sea-green ashlar furred with moss from above, a
 * slick black tide-line below, bioluminescent specks, standing water. */

const STONE = ramp(["#18231f", "#223330", "#2d423c", "#3a5249", "#4b6558", "#5d7865"]);
const MORTAR = hex("#0b1311");
const MOSS = ramp(["#1a2e14", "#27441a", "#375c22", "#4f7a2c"]);
const TIDE = hex("#0a1413");
const ALGAE = hex("#2b3a1c");
const LUME = hex("#5cffd8");
const WATER = hex("#07131a");

export const drowned: SurfaceSet = {
  wall(rng, variant) {
    const p = blank(64, 128, { rough: true, emit: true });
    paintBlocks(p, rng, { bw: 32, bh: 16, stone: STONE, mortar: MORTAR, seed: 61 + variant, mottle: 0.45 });
    cracks(p, rng, 3, hex("#07100d"), 14);
    mossCurtain(p, rng, 0.42 + variant * 0.08);
    tideLine(p, rng);
    drips(p, rng, 7, hex("#0c1a18"), 0.5, true);
    if (variant === 1) kelp(p, rng);
    if (variant === 2) seep(p, rng);
    return p;
  },

  floor(rng) {
    const p = blank(128, 128, { rough: true });
    paintFlagstones(p, rng, { cells: 4, stone: STONE, gap: hex("#0a1411"), seed: 71, gapWidth: 0.09 });
    // Moss creeps out of the seams.
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++)
        if (p.height[y * 128 + x] < 0.1 && fbm(x, y, 128, 128, 6, 72) > 0.52) putRgb(p, x, y, MOSS(rng.next()), 0.2);
    puddles(p, 73, 0.58, WATER);
    return p;
  },

  ceiling(rng) {
    const p = blank(64, 64, { rough: true, emit: true });
    paintBlocks(p, rng, {
      bw: 32,
      bh: 16,
      stone: ramp(["#0d1513", "#15201d", "#1d2b27"]),
      mortar: hex("#050a09"),
      seed: 81,
    });
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        if (fbm(x, y, 64, 64, 6, 82) > 0.55) putRgb(p, x, y, MOSS(rng.next() * 0.6), 0.7);
        if (rng.chance(0.004)) glow(p, x, y, LUME, 0.8);
      }
    return p;
  },
};

/** Moss hanging from the top of the wall in ragged tongues. */
function mossCurtain(p: Painted, rng: Rng, reach: number) {
  for (let x = 0; x < p.w; x++) {
    const tongue = fbm(x, 0, p.w, p.h, 6, 91) * reach * p.h + rng.range(-2, 2);
    for (let y = 0; y < tongue; y++) {
      const t = 1 - y / tongue;
      if (fbm(x, y, p.w, p.h, 12, 92) < 0.35 + (1 - t) * 0.3) continue;
      putRgb(p, x, y, MOSS(t * 0.8 + rng.next() * 0.2), 0.75 + rng.next() * 0.2);
      setRough(p, x, y, 1);
      if (rng.chance(0.012)) glow(p, x, y, LUME);
    }
  }
}

/** Waterline at the foot: black, wet, crusted with algae and barnacles. */
function tideLine(p: Painted, rng: Rng) {
  const top = Math.floor(p.h * 0.78);
  for (let y = top; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const wave = Math.sin(x * 0.4) * 1.5 + fbm(x, y, p.w, p.h, 8, 93) * 4;
      if (y < top + wave) continue;
      tint(p, x, y, TIDE, 0.6 + ((y - top) / (p.h - top)) * 0.35);
      setRough(p, x, y, 0.2);
      if (y < top + wave + 2) tint(p, x, y, ALGAE, 0.7);
      if (rng.chance(0.02)) putRgb(p, x, y, hex("#6e7a6a"), 0.9); // barnacle
    }
  }
}

function kelp(p: Painted, rng: Rng) {
  for (let k = 0; k < 5; k++) {
    let x = rng.int(0, p.w - 1);
    const len = rng.int(40, 80);
    for (let y = 0; y < len; y++) {
      x = (x + Math.round(Math.sin(y * 0.25 + k) * 0.6) + p.w) % p.w;
      putRgb(p, x, y, MOSS(0.3 + (y / len) * 0.4), 0.9);
      putRgb(p, (x + 1) % p.w, y, MOSS(0.15), 0.85);
      if (y % 9 === 4) glow(p, x, y, LUME, 0.9);
    }
  }
}

/** A cracked seam where the sea still seeps in, glossy and pale. */
function seep(p: Painted, rng: Rng) {
  let x = rng.int(10, 54);
  for (let y = 20; y < p.h; y++) {
    if (rng.chance(0.25)) x += rng.chance(0.5) ? 1 : -1;
    for (let dx = -1; dx <= 1; dx++) {
      const px = (x + dx + p.w) % p.w;
      tint(p, px, y, hex("#4c7d86"), dx === 0 ? 0.55 : 0.25);
      setRough(p, px, y, 0.05);
    }
  }
}
