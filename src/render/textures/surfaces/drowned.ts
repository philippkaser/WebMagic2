import type { Rng } from "../../../core/rng";
import { blank, glow, putRgb, setRough, tint, type Painted } from "../canvas";
import { fbm } from "../noise";
import { hex, ramp } from "../palette";
import { cracks, drips, paintBlocks, paintFlagstones, puddles } from "./common";
import { CEIL_TEX, FLOOR_TEX, REF_WALL_PX, WALL_TEX_H, WALL_TEX_W, foot, tallness, type SurfaceSet } from "./types";

/** The Drowned Halls: sea-green ashlar furred with moss from above, a
 * slick black tide-line below, bioluminescent specks, standing water.
 * (Ported from the artpass branch's Drowned Crypts — the look the player
 * fell for. Walls stretched to our wall height: the moss still hangs from
 * the vault, the tide line still sits a metre above the floor.) */

const STONE = ramp(["#18231f", "#223330", "#2d423c", "#3a5249", "#4b6558", "#5d7865"]);
const MORTAR = hex("#0b1311");
const MOSS = ramp(["#1a2e14", "#27441a", "#375c22", "#4f7a2c"]);
const TIDE = hex("#0a1413");
const ALGAE = hex("#2b3a1c");
const LUME = hex("#5cffd8");
const WATER = hex("#07131a");

export const drowned: SurfaceSet = {
  wall(rng, variant) {
    const p = blank(WALL_TEX_W, WALL_TEX_H, { rough: true, emit: true });
    const k = tallness(p);
    paintBlocks(p, rng, { bw: 32, bh: 16, stone: STONE, mortar: MORTAR, seed: 61 + variant, mottle: 0.45 });
    cracks(p, rng, Math.round(3 * k), hex("#07100d"), 14);
    mossCurtain(p, rng, 0.42 + variant * 0.08);
    tideLine(p, rng);
    drips(p, rng, Math.round(7 * k), hex("#0c1a18"), 0.5, true);
    if (variant === 1) kelp(p, rng);
    if (variant === 2) seep(p, rng);
    return p;
  },

  floor(rng) {
    const p = blank(FLOOR_TEX, FLOOR_TEX, { rough: true });
    paintFlagstones(p, rng, { cells: 4, stone: STONE, gap: hex("#0a1411"), seed: 71, gapWidth: 0.09 });
    // Moss creeps out of the seams.
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++)
        if (p.height[y * p.w + x] < 0.1 && fbm(x, y, p.w, p.h, 6, 72) > 0.52) putRgb(p, x, y, MOSS(rng.next()), 0.2);
    puddles(p, 73, 0.58, WATER);
    return p;
  },

  ceiling(rng) {
    const p = blank(CEIL_TEX, CEIL_TEX, { rough: true, emit: true });
    paintBlocks(p, rng, {
      bw: 32,
      bh: 16,
      stone: ramp(["#0d1513", "#15201d", "#1d2b27"]),
      mortar: hex("#050a09"),
      seed: 81,
    });
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        if (fbm(x, y, p.w, p.h, 6, 82) > 0.55) putRgb(p, x, y, MOSS(rng.next() * 0.6), 0.7);
        if (rng.chance(0.004)) glow(p, x, y, LUME, 0.8);
      }
    return p;
  },
};

/** Moss hanging from the top of the wall in ragged tongues. On a wall
 * taller than the artpass one the tongues hang further (most of the extra
 * height), so their ragged ends still come down into view. */
function mossCurtain(p: Painted, rng: Rng, reach: number) {
  const extra = (p.h - REF_WALL_PX) * 0.6;
  for (let x = 0; x < p.w; x++) {
    const tongue = fbm(x, 0, p.w, p.h, 6, 91) * reach * REF_WALL_PX + extra + rng.range(-2, 2);
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
  const top = foot(p, Math.floor(128 * 0.78));
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

/** Kelp streamers hanging from the vault, lume beads along them. */
function kelp(p: Painted, rng: Rng) {
  const k = tallness(p);
  for (let s = 0; s < 5; s++) {
    let x = rng.int(0, p.w - 1);
    const len = Math.round(rng.int(40, 80) * k);
    for (let y = 0; y < len && y < p.h; y++) {
      x = (x + Math.round(Math.sin(y * 0.25 + s) * 0.6) + p.w) % p.w;
      putRgb(p, x, y, MOSS(0.3 + (y / len) * 0.4), 0.9);
      putRgb(p, (x + 1) % p.w, y, MOSS(0.15), 0.85);
      if (y % 9 === 4) glow(p, x, y, LUME, 0.9);
    }
  }
}

/** A cracked seam where the sea still seeps in, glossy and pale. */
function seep(p: Painted, rng: Rng) {
  let x = rng.int(10, 54);
  for (let y = Math.round(20 * tallness(p)); y < p.h; y++) {
    if (rng.chance(0.25)) x += rng.chance(0.5) ? 1 : -1;
    for (let dx = -1; dx <= 1; dx++) {
      const px = (x + dx + p.w) % p.w;
      tint(p, px, y, hex("#4c7d86"), dx === 0 ? 0.55 : 0.25);
      setRough(p, px, y, 0.05);
    }
  }
}
