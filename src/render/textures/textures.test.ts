import { describe, expect, test } from "bun:test";
import { Rng } from "../../core/rng";
import { TILE, WALL_HEIGHT } from "../../core/config";
import { blank, decodeNormal, heightToNormal, scalarToRgba } from "./canvas";
import { RUNE_CIRCLE_SIZE, paintRuneCircle } from "./decals";
import { RUNE_TABLET_SIZE, glyphMask, paintGlyphAtlas, paintRuneTablet } from "./glyphs";
import { SURFACE_DEFS, paintSurface } from "./index";
import { ARCH_SURFACES, SURFACE_KINDS, archPart, setSurfaces, type SurfaceKind } from "./kinds";
import { fbm, worley } from "./noise";
import { ramp } from "./palette";
import {
  CEIL_SPAN,
  CEIL_TEX,
  FLOOR_SPAN,
  FLOOR_TEX,
  SURFACE_SETS,
  TEXELS_PER_METRE,
  VARIANT_WEIGHTS,
  WALL_TEX_H,
  WALL_TEX_W,
  WALL_VARIANTS,
  wallAtlasU,
} from "./surfaces";

/** Painters are pure, so the whole art pipeline short of the canvas upload
 * is testable here: sizes (square texels everywhere), determinism, which
 * surfaces glow and glint, the normal-map convention, and the glyph and
 * decal painters. */

function fnv(bytes: ArrayLike<number> & Iterable<number>): number {
  let h = 2166136261 >>> 0;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Paint each kind once for the whole file.
const painted = new Map(SURFACE_KINDS.map((k) => [k, paintSurface(k)] as const));

/** Which architecture parts paint a glow layer (the artpass sets). */
const GLOWS: Record<string, boolean> = {
  "catacombs-wall": false,
  "catacombs-floor": false,
  "catacombs-ceiling": false,
  "drowned-wall": true, // lume specks in the moss, kelp beads
  "drowned-floor": false,
  "drowned-ceiling": true,
  "forge-wall": true,
  "forge-floor": true,
  "forge-ceiling": true,
  "crystal-wall": true,
  "crystal-floor": true,
  "crystal-ceiling": true,
  "abyss-wall": true,
  "abyss-floor": true,
  "abyss-ceiling": true,
};

describe("surface table", () => {
  test("every kind has a painter and hints, and nothing extra", () => {
    expect(new Set(Object.keys(SURFACE_DEFS))).toEqual(new Set(SURFACE_KINDS));
    expect(new Set(SURFACE_KINDS).size).toBe(SURFACE_KINDS.length);
  });

  test("architecture kinds are <set>-<part> for every surface set", () => {
    expect(ARCH_SURFACES.length).toBe(SURFACE_SETS.length * 3);
    for (const set of SURFACE_SETS) {
      const s = setSurfaces(set);
      for (const [part, kind] of Object.entries(s)) expect(archPart(kind)).toEqual({ set, part: part as never });
    }
    // Props and village kinds the models call by name keep working.
    for (const k of ["planks", "barrel", "ceramic", "stone", "slab", "dirt", "runestone", "cobble", "timber"])
      expect(SURFACE_KINDS).toContain(k as SurfaceKind);
    expect(archPart("planks")).toBeNull();
  });

  test("hints are sane material params", () => {
    for (const k of SURFACE_KINDS) {
      const h = SURFACE_DEFS[k].hints;
      for (const v of [h.roughness, h.metalness]) expect(v >= 0 && v <= 1).toBe(true);
      expect(h.envMapIntensity).toBeGreaterThanOrEqual(0);
      // With a roughness map three.js multiplies — the hint must not dampen it.
      if (painted.get(k)!.rough) expect(h.roughness).toBe(1);
    }
  });

  test("slab is the waystone basalt (same bytes as runestone)", () => {
    expect(fnv(painted.get("slab")!.color)).toBe(fnv(painted.get("runestone")!.color));
  });
});

describe("painters", () => {
  test("texels are square in the world: 32 per metre on every architecture part", () => {
    expect(WALL_TEX_W).toBe(TILE * TEXELS_PER_METRE);
    expect(WALL_TEX_H).toBe(Math.round(WALL_HEIGHT * TEXELS_PER_METRE));
    expect(FLOOR_TEX / FLOOR_SPAN).toBe(TEXELS_PER_METRE);
    expect(CEIL_TEX / CEIL_SPAN).toBe(TEXELS_PER_METRE);
    for (const set of SURFACE_SETS) {
      const s = setSurfaces(set);
      const wall = painted.get(s.wall)!;
      expect([wall.w, wall.h]).toEqual([WALL_TEX_W * WALL_VARIANTS, WALL_TEX_H]);
      expect([painted.get(s.floor)!.w, painted.get(s.floor)!.h]).toEqual([FLOOR_TEX, FLOOR_TEX]);
      expect([painted.get(s.ceiling)!.w, painted.get(s.ceiling)!.h]).toEqual([CEIL_TEX, CEIL_TEX]);
    }
  });

  test("buffers are complete: opaque colour, finite heights, roughness in 0..1", () => {
    for (const k of SURFACE_KINDS) {
      const p = painted.get(k)!;
      expect(p.color.length).toBe(p.w * p.h * 4);
      expect(p.height.length).toBe(p.w * p.h);
      for (let i = 3; i < p.color.length; i += 4) if (p.color[i] !== 255) throw new Error(`${k} has a hole at ${i >> 2}`);
      for (const v of p.height) if (!(v >= -0.5 && v <= 2)) throw new Error(`${k} height ${v}`);
      if (p.rough) for (const v of p.rough) if (!(v >= 0 && v <= 1)) throw new Error(`${k} roughness ${v}`);
    }
  });

  test("deterministic: the same kind paints the same bytes every time", () => {
    for (const k of ["drowned-wall", "forge-floor", "abyss-wall", "planks", "cobble"] as const) {
      expect(fnv(paintSurface(k).color)).toBe(fnv(painted.get(k)!.color));
    }
  });

  test("the bands glow where the artpass painted light — and only there", () => {
    for (const k of ARCH_SURFACES) {
      const p = painted.get(k)!;
      expect(p.emit !== null).toBe(GLOWS[k]);
      if (!p.emit) continue;
      let lit = 0;
      for (let i = 0; i < p.emit.length; i += 4) if (p.emit[i] + p.emit[i + 1] + p.emit[i + 2] > 60) lit++;
      // Specks and seams, not wallpaper.
      expect(lit).toBeGreaterThan(0);
      expect(lit / (p.w * p.h)).toBeLessThan(0.25);
    }
  });

  test("the drowned halls: moss hangs from the vault, the tide line is wet and dark at the foot", () => {
    const p = painted.get("drowned-wall")!;
    const rowStats = (y: number) => {
      let g = 0;
      let rough = 0;
      for (let x = 0; x < p.w; x++) {
        const i = (y * p.w + x) * 4;
        g += p.color[i + 1] - (p.color[i] + p.color[i + 2]) / 2;
        rough += p.rough![y * p.w + x];
      }
      return { green: g / p.w, rough: rough / p.w };
    };
    // Top rows: moss — clearly greener than the stone below.
    expect(rowStats(2).green).toBeGreaterThan(rowStats(Math.floor(p.h * 0.6)).green + 10);
    // Bottom rows: the tide line — slick (low roughness).
    expect(rowStats(p.h - 3).rough).toBeLessThan(0.45);
    expect(rowStats(Math.floor(p.h * 0.6)).rough).toBeGreaterThan(0.6);
    // Standing water on the floor: some texels mirror-wet.
    const floor = painted.get("drowned-floor")!;
    expect(floor.rough!.some((r) => r < 0.15)).toBe(true);
  });

  test("the forge's heat pools at the foot of its walls", () => {
    const p = painted.get("forge-wall")!;
    const glowAt = (y: number) => {
      let e = 0;
      for (let x = 0; x < p.w; x++) e += p.emit![(y * p.w + x) * 4];
      return e;
    };
    expect(glowAt(p.h - 1)).toBeGreaterThan(glowAt(Math.floor(p.h * 0.5)));
  });

  test("variant atlas: three columns, mostly the common wall, insets inside their own column", () => {
    expect(VARIANT_WEIGHTS.length).toBe(WALL_VARIANTS);
    expect(VARIANT_WEIGHTS.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(VARIANT_WEIGHTS[0]).toBeGreaterThan(0.5);
    for (let v = 0; v < WALL_VARIANTS; v++) {
      const [u0, u1] = wallAtlasU(v);
      expect(Math.floor(u0 * WALL_TEX_W * WALL_VARIANTS)).toBe(v * WALL_TEX_W);
      expect(Math.floor(u1 * WALL_TEX_W * WALL_VARIANTS)).toBe((v + 1) * WALL_TEX_W - 1);
    }
  });
});

describe("normal map", () => {
  test.each([...SURFACE_KINDS])("%s encodes unit normals facing out", (k) => {
    const p = painted.get(k)!;
    const nm = heightToNormal(p, SURFACE_DEFS[k].normalStrength, SURFACE_DEFS[k].tileW ?? p.w);
    expect(nm.length).toBe(p.w * p.h * 4);
    for (let i = 0; i < p.w * p.h; i++) {
      const [x, y, z] = decodeNormal(nm, i);
      const len = Math.hypot(x, y, z);
      // 8-bit quantization allows a little slack.
      if (Math.abs(len - 1) > 0.02) throw new Error(`${k} normal ${i} length ${len}`);
      if (z <= 0) throw new Error(`${k} normal ${i} faces into the wall`);
    }
  });

  test("follows three.js's +Y-up convention (upper lip of a block lights from above)", () => {
    // A raised band on rows 6..9 of a 16×16 field. Its top row slopes up
    // the texture (toward row 0) → +G; its bottom row → −G. Its right
    // edge faces +x → +R.
    const p = blank(16, 16);
    for (let y = 6; y < 10; y++) for (let x = 4; x < 12; x++) p.height[y * 16 + x] = 1;
    const nm = heightToNormal(p, 2.4);
    expect(decodeNormal(nm, 6 * 16 + 8)[1]).toBeGreaterThan(0.2);
    expect(decodeNormal(nm, 9 * 16 + 8)[1]).toBeLessThan(-0.2);
    expect(decodeNormal(nm, 8 * 16 + 11)[0]).toBeGreaterThan(0.2);
    expect(decodeNormal(nm, 8 * 16 + 4)[0]).toBeLessThan(-0.2);
  });

  test("an atlas wraps each tile onto itself, not onto its neighbour", () => {
    // Two 8-wide tiles: the left one flat, the right one raised. The left
    // tile's edges must stay flat (they wrap to their own column).
    const p = blank(16, 4);
    for (let y = 0; y < 4; y++) for (let x = 8; x < 16; x++) p.height[y * 16 + x] = 1;
    const nm = heightToNormal(p, 2.4, 8);
    for (const x of [0, 7, 8, 15]) expect(Math.abs(decodeNormal(nm, 16 + x)[0])).toBeLessThan(0.02);
  });

  test("roughness packs into the green channel", () => {
    const rgba = scalarToRgba(new Float32Array([0, 0.5, 1]));
    expect([rgba[1], rgba[5], rgba[9]]).toEqual([0, 128, 255]);
    expect(rgba[3]).toBe(255);
  });
});

describe("noise and palette", () => {
  test("fbm is periodic over the texture, so every surface tiles", () => {
    for (let y = 0; y < 64; y += 7) {
      expect(fbm(64, y, 64, 64, 6, 3)).toBeCloseTo(fbm(0, y, 64, 64, 6, 3), 9);
      expect(fbm(y, 64, 64, 64, 6, 3)).toBeCloseTo(fbm(y, 0, 64, 64, 6, 3), 9);
    }
  });

  test("worley gives ordered distances and stable ids", () => {
    const a = worley(10, 20, 64, 64, 4, 4, 9);
    expect(a.f2).toBeGreaterThanOrEqual(a.f1);
    expect(worley(10, 20, 64, 64, 4, 4, 9)).toEqual(a);
  });

  test("stepped ramps band (no blending between stops)", () => {
    const r = ramp(["#000000", "#ffffff"]);
    expect(r(0.2)).toEqual([0, 0, 0]);
    expect(r(0.8)).toEqual([255, 255, 255]);
  });
});

describe("runes and decals", () => {
  test("a lore tablet is deterministic per seed and differs between seeds", () => {
    const a = paintRuneTablet("fragment-a");
    const b = paintRuneTablet("fragment-a");
    const c = paintRuneTablet("fragment-b");
    expect(a.w).toBe(RUNE_TABLET_SIZE);
    expect(a.emit).not.toBeNull();
    expect(fnv(b.emit!)).toBe(fnv(a.emit!));
    expect(fnv(c.emit!)).not.toBe(fnv(a.emit!));
  });

  test("the tablet glyph glows and is grayscale (tinted by the model)", () => {
    const e = paintRuneTablet("x").emit!;
    let lit = 0;
    for (let i = 0; i < e.length; i += 4) {
      expect(e[i]).toBe(e[i + 1]);
      expect(e[i]).toBe(e[i + 2]);
      if (e[i] > 200) lit++;
    }
    expect(lit).toBeGreaterThan(10);
  });

  test("glyph masks are never empty", () => {
    const rng = new Rng(99);
    for (let i = 0; i < 100; i++) {
      const w = rng.int(3, 14);
      const h = rng.int(5, 16);
      expect(glyphMask(rng, w, h).reduce((a, b) => a + b, 0)).toBeGreaterThan(2);
    }
  });

  test("the seal atlas is a strip of opaque masks", () => {
    const { rgba, width, height } = paintGlyphAtlas(8, 16);
    expect(width).toBe(128);
    expect(height).toBe(16);
    expect(rgba.length).toBe(128 * 16 * 4);
    for (let i = 3; i < rgba.length; i += 4) expect(rgba[i]).toBe(255);
  });

  test("the arrival rune circle is a grayscale ring pattern with an empty outside", () => {
    const p = paintRuneCircle();
    const S = RUNE_CIRCLE_SIZE;
    let lit = 0;
    for (let i = 0; i < S * S; i++) {
      const v = p.color[i * 4];
      expect(p.color[i * 4 + 1]).toBe(v);
      if (v > 0) lit++;
    }
    expect(lit).toBeGreaterThan(400);
    // Corners lie outside the outer ring.
    expect(p.color[0]).toBe(0);
    expect(p.color[(S * S - 1) * 4]).toBe(0);
    // Deterministic.
    expect(fnv(paintRuneCircle().color)).toBe(fnv(p.color));
  });
});
