import { describe, expect, test } from "bun:test";
import {
  CEILING_SURFACES,
  FLOOR_SURFACES,
  SURFACE_KINDS,
  WALL_SURFACES,
  type SurfaceKind,
} from "./kinds";
import { decodeNormal, heightToNormal, packRoughness } from "./normalMap";
import { TEX_SIZE, blockField, splitSpan, tileNoise } from "./paint";
import { SURFACE_DEFS, paintSurface } from "./painters";
import { RUNE_TABLET_SIZE, glyphMask, paintGlyphAtlas, paintRuneTablet } from "./painters/glyphs";
import { Rng } from "../../core/rng";

/** Painters are pure, so the whole art pipeline short of the canvas upload
 * is testable here: sizes, ranges, determinism, the normal-map convention,
 * and which kinds carry emissive / roughness layers. */

/** The layer contract from the biome brief. Anything else must NOT pay for
 * an emissive or roughness map. */
const EMISSIVE: ReadonlySet<SurfaceKind> = new Set([
  "basalt",
  "ashslab",
  "crystal",
  "crystalslab",
  "bone",
  "boneslab",
]);
const ROUGHNESS: ReadonlySet<SurfaceKind> = new Set(["wetstone", "wetslab"]);

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

describe("surface table", () => {
  test("every kind has a painter and hints, and nothing extra", () => {
    expect(new Set(Object.keys(SURFACE_DEFS))).toEqual(new Set(SURFACE_KINDS));
    for (const k of SURFACE_KINDS) {
      expect(typeof SURFACE_DEFS[k].paint).toBe("function");
      expect(SURFACE_DEFS[k].hints).toBeDefined();
    }
    expect(new Set(SURFACE_KINDS).size).toBe(SURFACE_KINDS.length);
  });

  test("biome surface names are the fixed contract", () => {
    expect([...WALL_SURFACES]).toEqual(["stone", "wetstone", "basalt", "crystal", "bone"]);
    expect([...FLOOR_SURFACES]).toEqual(["slab", "wetslab", "ashslab", "crystalslab", "boneslab"]);
    expect([...CEILING_SURFACES]).toEqual(["dark", "void"]);
  });

  test("hints are sane material params", () => {
    for (const k of SURFACE_KINDS) {
      const h = SURFACE_DEFS[k].hints;
      expect(h.roughness).toBeGreaterThanOrEqual(0);
      expect(h.roughness).toBeLessThanOrEqual(1);
      expect(h.metalness).toBeGreaterThanOrEqual(0);
      expect(h.metalness).toBeLessThanOrEqual(1);
      expect(h.envMapIntensity).toBeGreaterThanOrEqual(0);
      // An emissive map is invisible without an emissive color, and an
      // emissive color without a map would glow the whole surface.
      expect(h.emissive !== undefined).toBe(EMISSIVE.has(k));
      expect(h.emissiveIntensity !== undefined).toBe(EMISSIVE.has(k));
      // With a roughness map three.js multiplies — the hint must not dampen it.
      if (ROUGHNESS.has(k)) expect(h.roughness).toBe(1);
    }
  });
});

describe("painters", () => {
  test.each([...SURFACE_KINDS])("%s is deterministic", (k) => {
    const a = painted.get(k)!;
    const b = paintSurface(k);
    expect(fnv(b.color)).toBe(fnv(a.color));
    expect(fnv(new Uint8Array(b.height.buffer))).toBe(fnv(new Uint8Array(a.height.buffer)));
    if (a.emissive) expect(fnv(b.emissive!)).toBe(fnv(a.emissive));
    if (a.roughness) expect(fnv(new Uint8Array(b.roughness!.buffer))).toBe(fnv(new Uint8Array(a.roughness.buffer)));
  });

  test.each([...SURFACE_KINDS])("%s has 64×64 buffers with values in range", (k) => {
    const p = painted.get(k)!;
    const n = TEX_SIZE * TEX_SIZE;
    expect(p.size).toBe(64);
    expect(p.color.length).toBe(n * 4);
    expect(p.height.length).toBe(n);
    for (let i = 0; i < n; i++) {
      expect(p.color[i * 4 + 3]).toBe(255);
      const h = p.height[i];
      if (!(h >= 0 && h <= 1)) throw new Error(`${k} height[${i}] = ${h}`);
    }
    if (p.emissive) {
      expect(p.emissive.length).toBe(n * 4);
      for (let i = 0; i < n; i++) expect(p.emissive[i * 4 + 3]).toBe(255);
    }
    if (p.roughness) {
      expect(p.roughness.length).toBe(n);
      for (const r of p.roughness) if (!(r >= 0 && r <= 1)) throw new Error(`${k} roughness ${r}`);
    }
  });

  test.each([...SURFACE_KINDS])("%s has emissive/roughness layers only where declared", (k) => {
    const p = painted.get(k)!;
    expect(p.emissive !== undefined).toBe(EMISSIVE.has(k));
    expect(p.roughness !== undefined).toBe(ROUGHNESS.has(k));
  });

  test.each([...EMISSIVE])("%s glows in places, not everywhere", (k) => {
    const e = painted.get(k)!.emissive!;
    let lit = 0;
    for (let i = 0; i < e.length; i += 4) if (e[i] + e[i + 1] + e[i + 2] > 30) lit++;
    expect(lit).toBeGreaterThan(0);
    // Accent, not a light panel: under a quarter of the texels glow.
    expect(lit / (TEX_SIZE * TEX_SIZE)).toBeLessThan(0.25);
  });

  test.each([...ROUGHNESS])("%s has glinting wet texels and dry ones", (k) => {
    const r = painted.get(k)!.roughness!;
    let wet = 0;
    let dry = 0;
    for (const v of r) {
      if (v < 0.25) wet++;
      if (v > 0.7) dry++;
    }
    expect(wet).toBeGreaterThan(TEX_SIZE * 2);
    expect(dry).toBeGreaterThan(TEX_SIZE * 2);
  });

  test("the catacombs set and props are byte-identical to the original painters", () => {
    // Regression guard: the split must not change the existing look. Hashes
    // taken from the pre-split textures.ts output.
    const expected: Record<string, [number, number]> = {
      stone: [0x79e52e15, 0x27aa2712],
      slab: [0x5ac66b44, 0x6b607880],
      dark: [0xc22263ad, 0x96ebd27c],
      planks: [0x0fb396c0, 0x4db65650],
      barrel: [0x21fd7e7f, 0xac39e4fe],
      ceramic: [0x6738fc13, 0x6ada1508],
      dirt: [0x5189f0dd, 0x4a226132],
    };
    for (const [k, [color, height]] of Object.entries(expected)) {
      const p = painted.get(k as SurfaceKind)!;
      expect(fnv(p.color)).toBe(color);
      expect(fnv(new Uint8Array(p.height.buffer))).toBe(height);
    }
  });
});

describe("normal map", () => {
  test.each([...SURFACE_KINDS])("%s encodes unit normals facing out", (k) => {
    const p = painted.get(k)!;
    const nm = heightToNormal(p.height, p.size, SURFACE_DEFS[k].normalStrength ?? 2.2);
    expect(nm.length).toBe(p.size * p.size * 4);
    for (let i = 0; i < p.size * p.size; i++) {
      const [x, y, z] = decodeNormal(nm, i);
      const len = Math.hypot(x, y, z);
      // 8-bit quantization allows a little slack.
      if (Math.abs(len - 1) > 0.02) throw new Error(`${k} normal ${i} length ${len}`);
      if (z <= 0) throw new Error(`${k} normal ${i} faces into the wall`);
      expect(nm[i * 4 + 3]).toBe(255);
    }
  });

  test("flat height gives a flat normal", () => {
    const S = 8;
    const nm = heightToNormal(new Float32Array(S * S).fill(0.5), S, 2.2);
    for (let i = 0; i < S * S; i++) {
      const [x, y, z] = decodeNormal(nm, i);
      expect(Math.abs(x)).toBeLessThan(0.01);
      expect(Math.abs(y)).toBeLessThan(0.01);
      expect(z).toBeGreaterThan(0.99);
    }
  });

  test("follows three.js's +Y-up convention (upper lip of a block lights from above)", () => {
    // A raised band on rows 6..9 of a 16×16 field. Row 5 sits just above
    // it (higher v): the slope there faces UP the texture → +G. Row 10
    // sits below → −G. Column-wise, a block's right edge faces +x → +R.
    const S = 16;
    const h = new Float32Array(S * S);
    for (let y = 6; y < 10; y++) for (let x = 4; x < 12; x++) h[y * S + x] = 1;
    const nm = heightToNormal(h, S, 2.2);
    expect(decodeNormal(nm, 5 * S + 8)[1]).toBeGreaterThan(0.2);
    expect(decodeNormal(nm, 10 * S + 8)[1]).toBeLessThan(-0.2);
    expect(decodeNormal(nm, 8 * S + 12)[0]).toBeGreaterThan(0.2);
    expect(decodeNormal(nm, 8 * S + 3)[0]).toBeLessThan(-0.2);
  });

  test("roughness packs into the green channel", () => {
    const rgba = packRoughness(new Float32Array([0, 0.5, 1]));
    expect([rgba[1], rgba[5], rgba[9]]).toEqual([0, 128, 255]);
    expect(rgba[3]).toBe(255);
  });
});

describe("paint toolkit", () => {
  test("splitSpan always sums to the total", () => {
    const rng = new Rng(7);
    for (let i = 0; i < 200; i++) {
      const runs = splitSpan(rng, 64, rng.int(3, 8), rng.int(9, 30));
      expect(runs.reduce((a, b) => a + b, 0)).toBe(64);
      for (const r of runs) expect(r).toBeGreaterThan(0);
    }
  });

  test("tileNoise tiles seamlessly and stays in 0..1", () => {
    const S = 64;
    const n = tileNoise(new Rng(3), 4, S);
    for (const v of n) expect(v >= 0 && v <= 1).toBe(true);
    // Neighbours across the wrap edge differ no more than neighbours inside.
    let maxInside = 0;
    let maxSeam = 0;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S - 1; x++) maxInside = Math.max(maxInside, Math.abs(n[y * S + x] - n[y * S + x + 1]));
      maxSeam = Math.max(maxSeam, Math.abs(n[y * S + S - 1] - n[y * S]));
    }
    expect(maxSeam).toBeLessThanOrEqual(maxInside + 1e-6);
  });

  test("blockField marks joints and bounds edge distance", () => {
    const f = blockField(new Rng(11), 64, [6, 9], [12, 22]);
    let joints = 0;
    for (const e of f.edge) {
      expect(e).toBeLessThanOrEqual(4);
      if (e === 0) joints++;
    }
    expect(joints).toBeGreaterThan(64 * 4);
    expect(joints).toBeLessThan(64 * 64 * 0.4);
  });
});

describe("runes", () => {
  test("a lore tablet is deterministic per seed and differs between seeds", () => {
    const a = paintRuneTablet("fragment-a");
    const b = paintRuneTablet("fragment-a");
    const c = paintRuneTablet("fragment-b");
    expect(a.size).toBe(RUNE_TABLET_SIZE);
    expect(a.emissive).toBeDefined();
    expect(a.roughness).toBeUndefined();
    expect(fnv(b.emissive!)).toBe(fnv(a.emissive!));
    expect(fnv(c.emissive!)).not.toBe(fnv(a.emissive!));
  });

  test("the tablet glyph glows and is grayscale (tinted by the model)", () => {
    const e = paintRuneTablet("x").emissive!;
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
});
