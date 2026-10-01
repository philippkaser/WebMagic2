import type { Rng } from "../../../core/rng";
import { blank, putRgb, setRough, type Painted } from "../canvas";
import { fbm } from "../noise";
import { hex, ramp } from "../palette";
import { cracks, drips, grimeBand, hole, paintBlocks, paintFlagstones, speckle, stamp } from "./common";
import {
  CEIL_TEX,
  FLOOR_TEX,
  WALL_TEX_H,
  WALL_TEX_W,
  foot,
  footFrac,
  tallness,
  type SurfaceSet,
} from "./types";

/** The Catacombs: warm sandstone ossuary brick, dusty flagstones, burial
 * niches with their tenants still in them. (Ported from the artpass
 * branch; walls stretched to our wall height with the foot kept at the
 * foot — see surfaces/types.ts.) */

const STONE = ramp(["#2a2622", "#3c3530", "#50473e", "#655a4d", "#7b6e5d", "#94846f"]);
const MORTAR = hex("#17120e");
const DIRT = hex("#1a150e");
const MOSS = hex("#343c1e");
const BONE = hex("#cbbd98");
const BONE_SHADE = hex("#8a7d60");
const VOID = hex("#070504");

const SKULL = [
  "  ####  ",
  " ###### ",
  "########",
  "#oo##oo#",
  "#oo##oo#",
  "###..###",
  " ###### ",
  " #.#.#. ",
];

export const catacombs: SurfaceSet = {
  wall(rng, variant) {
    const p = blank(WALL_TEX_W, WALL_TEX_H, { rough: true });
    const k = tallness(p);
    paintBlocks(p, rng, { bw: 16, bh: 8, stone: STONE, mortar: MORTAR, seed: 11 + variant });
    grimeBand(p, footFrac(p, 0.72), 1, DIRT, 0.9, 21);
    grimeBand(p, 0, 0.12, DIRT, 0.6, 22);
    drips(p, rng, Math.round(5 * k), DIRT, 0.35);
    cracks(p, rng, Math.round((4 + variant * 3) * k), hex("#130f0b"), 16);
    if (variant === 1) burialNiche(p, rng);
    if (variant === 2) {
      // Collapse: missing bricks and roots pushing through, on brick rows.
      const rows = Math.floor(p.h / 8);
      for (let i = 0; i < Math.round(4 * k); i++)
        hole(p, rng.int(2, 46) + 1, rng.int(3, rows - 4) * 8 + 1, 15, 7, VOID, hex("#6a5842"));
      roots(p, rng);
    }
    // Moss only where damp pools at the wall's foot.
    for (let y = foot(p, 96); y < p.h; y++)
      for (let x = 0; x < p.w; x++)
        if (fbm(x, y, p.w, p.h, 10, 31) > 0.62 && rng.chance(0.6)) putRgb(p, x, y, MOSS, 0.6);
    return p;
  },

  floor(rng) {
    const p = blank(FLOOR_TEX, FLOOR_TEX, { rough: true });
    paintFlagstones(p, rng, { cells: 5, stone: STONE, gap: hex("#120e0a"), seed: 41 });
    // Bone chips and grit in the dust.
    speckle(p, rng, 0.004, BONE_SHADE, 0.7);
    speckle(p, rng, 0.002, BONE, 0.8);
    return p;
  },

  ceiling(rng) {
    const p = blank(CEIL_TEX, CEIL_TEX, { rough: true });
    paintBlocks(p, rng, {
      bw: 32,
      bh: 16,
      stone: ramp(["#16110d", "#211a14", "#2c231b", "#382c21"]),
      mortar: hex("#0a0806"),
      seed: 51,
    });
    roots(p, rng);
    return p;
  },
};

/** An arched burial slot with a skull and a few long bones, at chest
 * height above the floor. */
function burialNiche(p: Painted, rng: Rng) {
  const x0 = 18;
  const y0 = foot(p, 48);
  const w = 28;
  const h = 26;
  for (let y = y0 - 8; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const dx = (x - (x0 + w / 2)) / (w / 2);
      const arch = y >= y0 || dx * dx + ((y - y0) / 8) ** 2 <= 1;
      if (!arch) continue;
      const rim = y === y0 + h - 1 || Math.abs(dx) > 0.9;
      putRgb(p, x, y, rim ? hex("#4a3d31") : VOID, rim ? 0.3 : 0);
      setRough(p, x, y, 1);
    }
  }
  const pal: Record<string, [ReturnType<typeof hex>, number]> = {
    "#": [BONE, 0.7],
    o: [hex("#0b0806"), 0.2],
    ".": [BONE_SHADE, 0.5],
  };
  stamp(p, SKULL, x0 + 4 + rng.int(0, 3), y0 + h - 9, pal);
  // Long bones stacked beside the skull.
  for (let i = 0; i < 3; i++) {
    const by = y0 + h - 3 - i * 2;
    for (let x = x0 + 15; x < x0 + w - 2; x++) putRgb(p, x, by, i % 2 ? BONE_SHADE : BONE, 0.6);
  }
}

/** Dark roots snaking down from above. */
function roots(p: Painted, rng: Rng) {
  const col = hex("#1e150c");
  for (let r = 0; r < 3; r++) {
    let x = rng.int(0, p.w - 1);
    const len = rng.int(p.h * 0.2, p.h * 0.45);
    for (let y = 0; y < len; y++) {
      if (rng.chance(0.3)) x = (x + (rng.chance(0.5) ? 1 : p.w - 1)) % p.w;
      putRgb(p, x, y, col, 0.9);
      if (y < len * 0.4) putRgb(p, (x + 1) % p.w, y, col, 0.85);
    }
  }
}
