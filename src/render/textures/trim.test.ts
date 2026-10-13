import { describe, expect, test } from "bun:test";
import { paintSurface } from "./index";
import { TRIM_SURFACES, archPart, trimForWall, trimSurface } from "./kinds";
import { SURFACE_SETS, TEXELS_PER_METRE, TRIM_BLOCK_H, TRIM_BLOCK_W, TRIM_SPAN, TRIM_TEX, trimBlocks } from "./surfaces";

/** The dressed stone every band frames its doorways, piers and pillars
 * with: square texels, tiling, a public block layout the mesh builder can
 * snap faces onto, and each band's own weathering. */

const painted = new Map(TRIM_SURFACES.map((k) => [k, paintSurface(k)] as const));

describe("dressed stone (trim)", () => {
  test("one per surface set, named <set>-trim", () => {
    expect(TRIM_SURFACES.length).toBe(SURFACE_SETS.length);
    for (const set of SURFACE_SETS) {
      expect(archPart(trimSurface(set))).toEqual({ set, part: "trim" });
      expect(trimForWall(`${set}-wall`)).toBe(trimSurface(set));
    }
  });

  test("32 texels a metre, tiling, opaque", () => {
    expect(TRIM_TEX / TRIM_SPAN).toBe(TEXELS_PER_METRE);
    for (const [k, p] of painted) {
      expect([p.w, p.h]).toEqual([TRIM_TEX, TRIM_TEX]);
      for (let i = 3; i < p.color.length; i += 4) if (p.color[i] !== 255) throw new Error(`${k} has a hole`);
      expect(p.rough).not.toBeNull();
    }
  });

  test("the snap blocks are whole blocks with joints on their edges", () => {
    const blocks = trimBlocks();
    expect(blocks.length).toBeGreaterThanOrEqual(6);
    const p = painted.get("catacombs-trim")!;
    const lum = (x: number, y: number) => {
      const i = (y * p.w + x) * 4;
      return p.color[i] + p.color[i + 1] + p.color[i + 2];
    };
    for (const [x0, y0] of blocks) {
      expect(x0 + TRIM_BLOCK_W).toBeLessThanOrEqual(TRIM_TEX);
      expect(y0 + TRIM_BLOCK_H).toBeLessThanOrEqual(TRIM_TEX);
      // The joint along the block's top is darker than the block's middle.
      let joint = 0;
      let face = 0;
      for (let x = x0 + 2; x < x0 + TRIM_BLOCK_W - 2; x++) {
        joint += lum(x, y0);
        face += lum(x, y0 + TRIM_BLOCK_H / 2);
      }
      expect(joint).toBeLessThan(face);
    }
  });

  test("each band weathers its own way: only the catacombs' sandstone never glows", () => {
    for (const set of SURFACE_SETS) {
      const p = painted.get(trimSurface(set))!;
      if (set === "catacombs") {
        expect(p.emit).toBeNull();
        continue;
      }
      expect(p.emit).not.toBeNull();
      let lit = 0;
      for (let i = 0; i < p.emit!.length; i += 4) if (p.emit![i] + p.emit![i + 1] + p.emit![i + 2] > 60) lit++;
      expect(lit).toBeGreaterThan(0);
      expect(lit / (p.w * p.h)).toBeLessThan(0.08);
    }
  });

  test("deterministic", () => {
    for (const k of TRIM_SURFACES) expect(paintSurface(k).color).toEqual(painted.get(k)!.color);
  });
});
