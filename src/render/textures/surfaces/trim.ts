import type { Rng } from "../../../core/rng";
import { blank, glow, putRgb, setRough, tint, type Painted } from "../canvas";
import { fbm, hash2 } from "../noise";
import { hex, ramp, type Rgb } from "../palette";
import { carveGlyph, cracks, glyph } from "./common";
import { TEXELS_PER_METRE, type SurfaceSetId } from "./types";

/** Dressed stone: the cut-and-tooled ashlar every band frames its doorways,
 * piers, ribs and pillars with (render/models/archStoneMesh.ts), and its
 * fallen masonry lies in. Big blocks — a metre long, half a metre high, in
 * running bond — with a light lip along the top of each (lit from above),
 * a dark one under it, diagonal chisel tooling, chipped corners, and each
 * band's weathering in the joints: dust, algae and lume, soot and embers,
 * crystal veins, sinew and bleeding runes.
 *
 * The layout is fixed and public (TRIM_BLOCK_*, trimBlocks) so the mesh
 * builder can snap a small face — a voussoir, a quoin, a capital — onto
 * exactly one block, its edges on the block's joints. The texture tiles in
 * both directions, so big faces (a pillar's shaft, a header) are simply
 * world-mapped at TRIM_SPAN metres per repeat. */

export const TRIM_TEX = 64;
/** Metres per repeat: texels stay 32 per metre, like every other surface. */
export const TRIM_SPAN = TRIM_TEX / TEXELS_PER_METRE;
export const TRIM_BLOCK_W = 32;
export const TRIM_BLOCK_H = 16;

/** Running bond: odd courses shifted by half a block. */
function rowOffset(row: number): number {
  return (row % 2) * (TRIM_BLOCK_W / 2);
}

/** The whole blocks of the texture that don't wrap across its edge, as
 * their top-left texel — the blocks a small face can be snapped onto. */
export function trimBlocks(): [number, number][] {
  const out: [number, number][] = [];
  for (let row = 0; row < TRIM_TEX / TRIM_BLOCK_H; row++) {
    for (let x = rowOffset(row); x + TRIM_BLOCK_W <= TRIM_TEX; x += TRIM_BLOCK_W) out.push([x, row * TRIM_BLOCK_H]);
  }
  return out;
}

interface TrimStyle {
  stone: (t: number) => Rgb;
  mortar: Rgb;
  weather(p: Painted, rng: Rng): void;
  glows: boolean;
}

const STYLES: Record<SurfaceSetId, TrimStyle> = {
  // Warm sandstone, paler than the brick it frames; dust in the joints.
  catacombs: {
    stone: ramp(["#3a332c", "#4d443a", "#615548", "#766857", "#8c7c67", "#a39079"]),
    mortar: hex("#1a140f"),
    glows: false,
    weather(p, rng) {
      cracks(p, rng, 3, hex("#1d1711"), 10);
      dustJoints(p, hex("#2a2117"), 0.5);
    },
  },
  // Sea-green ashlar, algae in the joints, a few lume specks.
  drowned: {
    stone: ramp(["#1d2b26", "#283a34", "#344a42", "#425c51", "#526f60", "#648270"]),
    mortar: hex("#0a1411"),
    glows: true,
    weather(p, rng) {
      const algae = hex("#2e4a1e");
      for (let y = 0; y < p.h; y++)
        for (let x = 0; x < p.w; x++) {
          const n = fbm(x, y, p.w, p.h, 6, 611);
          if (isJointish(x, y) && n > 0.45) tint(p, x, y, algae, 0.7);
          if (n > 0.66) setRough(p, x, y, 0.35); // still wet
        }
      const lume = hex("#5cffd8");
      for (let i = 0; i < 9; i++) {
        const x = rng.int(0, p.w - 1);
        const y = rng.int(0, p.h - 1);
        glow(p, x, y, lume, 0.9);
      }
    },
  },
  // Basalt, soot-blackened, embers still glowing deep in a few joints.
  forge: {
    stone: ramp(["#16141a", "#201d24", "#2b272e", "#37323a", "#453e45", "#564b50"]),
    mortar: hex("#070506"),
    glows: true,
    weather(p, rng) {
      const soot = hex("#060505");
      for (let y = 0; y < p.h; y++)
        for (let x = 0; x < p.w; x++) {
          const n = fbm(x, y, p.w, p.h, 5, 621);
          if (n > 0.55) tint(p, x, y, soot, (n - 0.55) * 1.6);
        }
      const ember = hex("#ff5a10");
      for (let y = 0; y < p.h; y++)
        for (let x = 0; x < p.w; x++) {
          if (!isJoint(x, y)) continue;
          if (fbm(x, y, p.w, p.h, 4, 622) > 0.66 && rng.chance(0.8)) {
            putRgb(p, x, y, hex("#3a1206"), 0.02);
            glow(p, x, y, ember, 0.85);
          }
        }
    },
  },
  // Indigo dressed stone threaded with a couple of cold veins.
  crystal: {
    stone: ramp(["#19152e", "#231d3e", "#2e2750", "#3b3262", "#4b4076", "#5c508a"]),
    mortar: hex("#07050e"),
    glows: true,
    weather(p, rng) {
      cracks(p, rng, 3, hex("#3a2a8a"), 14, hex("#62b8ff"));
    },
  },
  // Obsidian-dark flesh-stone, sinew in the joints, a bleeding rune or two.
  abyss: {
    stone: ramp(["#170910", "#230d15", "#32121c", "#441823", "#58212b", "#6e2e33"]),
    mortar: hex("#08020a"),
    glows: true,
    weather(p, rng) {
      const blood = hex("#ff2a3a");
      for (const [bx, by] of [trimBlocks()[1], trimBlocks()[4]]) {
        const bits = glyph(rng);
        carveGlyph(p, bits, 5, bx + 13, by + 4, hex("#12040a"), blood);
      }
    },
  },
};

/** Paint one band's dressed stone (64², tiling). */
export function paintTrim(set: SurfaceSetId, rng: Rng): Painted {
  const style = STYLES[set];
  const p = blank(TRIM_TEX, TRIM_TEX, { rough: true, emit: style.glows });
  const seed = 700 + set.length;
  for (let y = 0; y < p.h; y++) {
    const row = Math.floor(y / TRIM_BLOCK_H);
    const v = y - row * TRIM_BLOCK_H;
    for (let x = 0; x < p.w; x++) {
      const xx = (x - rowOffset(row) + TRIM_TEX) % TRIM_TEX;
      const col = Math.floor(xx / TRIM_BLOCK_W);
      const u = xx - col * TRIM_BLOCK_W;
      const fine = rng.next();
      if (u === 0 || v === 0) {
        putRgb(p, x, y, style.mortar, 0.04);
        setRough(p, x, y, 1);
        continue;
      }
      const id = hash2(col, row, seed);
      // Chipped corners: a block loses a bite here and there.
      const cu = Math.min(u - 1, TRIM_BLOCK_W - 1 - u);
      const cv = Math.min(v - 1, TRIM_BLOCK_H - 1 - v);
      if (cu + cv < 2 && hash2(col * 7 + (u < 8 ? 0 : 1), row * 5 + (v < 8 ? 0 : 1), seed + 9) > 0.55) {
        putRgb(p, x, y, style.mortar, 0.12);
        setRough(p, x, y, 1);
        continue;
      }
      const n = fbm(x, y, p.w, p.h, 8, seed + 3);
      // Diagonal chisel tooling across each face.
      const tool = (u + v * 2 + Math.floor(id * 7)) % 5 === 0 ? -0.06 : 0;
      // Lit lip along the top, a shadowed one under the block.
      const lip = v === 1 ? 0.14 : v === TRIM_BLOCK_H - 1 ? -0.16 : u === 1 ? 0.05 : u === TRIM_BLOCK_W - 1 ? -0.08 : 0;
      const t = 0.24 + id * 0.42 + (n - 0.5) * 0.4 + (fine - 0.5) * 0.1 + tool + lip;
      const edge = Math.min(cu, cv);
      putRgb(p, x, y, style.stone(t), 0.5 + Math.min(edge, 2) * 0.15 + n * 0.12 + tool);
      setRough(p, x, y, 0.78 + fine * 0.18);
    }
  }
  style.weather(p, rng);
  return p;
}

function isJoint(x: number, y: number): boolean {
  const row = Math.floor(y / TRIM_BLOCK_H);
  const xx = (x - rowOffset(row) + TRIM_TEX) % TRIM_TEX;
  return xx % TRIM_BLOCK_W === 0 || y % TRIM_BLOCK_H === 0;
}

/** Within a texel of a joint. */
function isJointish(x: number, y: number): boolean {
  return isJoint(x, y) || isJoint((x + 1) % TRIM_TEX, y) || isJoint(x, (y + 1) % TRIM_TEX);
}

/** Dust settled on the lower lip of every course. */
function dustJoints(p: Painted, dust: Rgb, strength: number): void {
  for (let y = 0; y < p.h; y++) {
    if (y % TRIM_BLOCK_H !== TRIM_BLOCK_H - 1) continue;
    for (let x = 0; x < p.w; x++) if (fbm(x, y, p.w, p.h, 8, 631) > 0.4) tint(p, x, y, dust, strength);
  }
}
