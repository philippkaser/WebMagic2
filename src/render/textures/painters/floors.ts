import type { Rng } from "../../../core/rng";
import type { FloorSurface } from "../kinds";
import {
  TEX_SIZE as S,
  blank,
  blockField,
  blockTone,
  clamp01,
  glow,
  haloAround,
  lerp,
  put,
  setRoughness,
  shade,
  tileNoise,
  walk,
  wrap,
  type SurfaceDef,
} from "../paint";
import { carveGlyph, glyphMask } from "./glyphs";

/** Floor painters — one per biome. Floors repeat every 2 tiles (4 m), so a
 * 64-texel tile is 16 texels per metre and features are painted square. */

/** Catacombs: big worn slabs in a grid. (Unchanged — the original floor.) */
function slab(rng: Rng) {
  const p = blank();
  const cell = 16;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const gap = x % cell === 0 || y % cell === 0;
      const n = rng.next();
      if (gap) {
        const v = 20 + n * 10;
        put(p, x, y, v, v, v * 1.1, 0.15);
      } else {
        const slabTint = ((Math.floor(x / cell) * 3 + Math.floor(y / cell) * 5) % 4) * 6;
        const stain = n > 0.93 ? 0.6 : 1;
        const v = (52 + n * 26 + slabTint) * stain;
        put(p, x, y, v * 0.9, v * 0.92, v, 0.55 + n * 0.35);
      }
    }
  }
  return p;
}

/** Drowned: cold blue-grey flagstones with water standing in the seams and
 * pooling in puddles. Puddles are FLAT (constant height → flat normal) and
 * near-mirror in the roughness map, recessed below the stone so their rims
 * catch light — the wet-floor glint the art style promises. */
function wetslab(rng: Rng) {
  const p = blank(S, { roughness: true });
  const f = blockField(rng, S, [13, 19], [13, 22]);
  const pool = tileNoise(rng, 4);
  const fine = tileNoise(rng, 8);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const n = rng.next();
      const wet = pool[i] * 0.72 + fine[i] * 0.28;
      const puddle = wet > 0.64;
      const damp = wet > 0.54;
      if (puddle) {
        // Standing water: dark teal, a few pale sky-glints.
        const glint = n > 0.975 ? 1.8 : 1;
        put(p, x, y, (16 + n * 6) * glint, (28 + n * 6) * glint, (36 + n * 8) * glint, 0.42);
        setRoughness(p, x, y, 0.05);
        continue;
      }
      if (f.edge[i] === 0) {
        // Seams hold water too.
        const v = 14 + n * 8;
        put(p, x, y, v * 0.9, v * 1.3, v * 1.5, 0.3);
        setRoughness(p, x, y, 0.12);
        continue;
      }
      const tone = blockTone(f.id[i], 2);
      const stain = n > 0.95 ? 0.65 : 1;
      const v = (52 + tone * 9 + n * 20) * stain;
      let h = f.edge[i] === 1 ? 0.5 : 0.56 + n * 0.3;
      let rough = 0.74 + n * 0.16;
      put(p, x, y, v * 0.8, v * 0.92, v * 1.04, h);
      if (damp) {
        // Damp ring around a puddle: darker, slicker, pores filled.
        const t = clamp01((wet - 0.54) * 10);
        shade(p, x, y, 1 - 0.3 * t, 1 - 0.26 * t, 1 - 0.22 * t);
        h = lerp(h, 0.55, t * 0.6);
        p.height[i] = h;
        rough = lerp(rough, 0.3, t);
      }
      setRoughness(p, x, y, rough);
    }
  }
  return p;
}

/** Forge: near-black slabs under ash, split by cracks glowing with the heat
 * beneath; a few embers smoulder in the dust. Emissive painted in color. */
function ashslab(rng: Rng) {
  const p = blank(S, { emissive: true });
  const f = blockField(rng, S, [15, 17], [14, 20]);
  const ash = tileNoise(rng, 8);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const n = rng.next();
      if (f.edge[i] === 0) {
        const v = 8 + n * 6;
        put(p, x, y, v, v * 0.92, v * 0.9, 0.12);
        continue;
      }
      const tone = blockTone(f.id[i], 4);
      let v = 27 + tone * 6 + n * 11;
      let h = f.edge[i] === 1 ? 0.5 : 0.56 + n * 0.28;
      if (ash[i] > 0.56 && n > 0.35) {
        // Ash drift: grey powder, slightly proud.
        v = 58 + n * 22;
        h += 0.05;
      }
      put(p, x, y, v * 1.04, v * 0.98, v * 0.94, h);
    }
  }
  // Glowing cracks: hottest mid-crack, cooling to dark tips.
  const hot = new Uint8Array(S * S);
  for (let k = 0; k < 5; k++) {
    walk(rng, S, rng.int(14, 30), (x, y, t) => {
      const heat = Math.sin(Math.PI * t);
      hot[y * S + x] = 1;
      put(p, x, y, 40 + heat * 40, 14 + heat * 10, 8, 0.1);
      glow(p, x, y, lerp(120, 255, heat), lerp(26, 130, heat), lerp(4, 40, heat));
    });
  }
  haloAround(p, hot, [1.5, 1.05, 0.9], [60, 14, 2]);
  // Embers in the dust.
  for (let k = 0; k < 9; k++) {
    const x = rng.int(0, S - 1);
    const y = rng.int(0, S - 1);
    put(p, x, y, 96, 40, 16, 0.6);
    glow(p, x, y, 190, 64, 10);
  }
  return p;
}

/** Crystal: polished violet-black slabs threaded with faintly glowing veins,
 * with small faceted crystal clusters pushing up through the floor. */
function crystalslab(rng: Rng) {
  const p = blank(S, { emissive: true });
  const f = blockField(rng, S, [15, 17], [14, 18]);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const n = rng.next();
      if (f.edge[i] === 0) {
        const v = 10 + n * 6;
        put(p, x, y, v * 0.9, v * 0.8, v * 1.3, 0.14);
        continue;
      }
      const tone = blockTone(f.id[i], 9);
      const v = 30 + tone * 7 + n * 12;
      put(p, x, y, v * 0.92, v * 0.8, v * 1.3, f.edge[i] === 1 ? 0.5 : 0.58 + n * 0.22);
    }
  }
  // Veins: thin glowing seams, cyan or violet.
  for (let k = 0; k < 4; k++) {
    const cyan = rng.chance(0.5);
    walk(rng, S, rng.int(18, 40), (x, y) => {
      put(p, x, y, cyan ? 44 : 78, cyan ? 96 : 52, cyan ? 118 : 128, 0.34);
      glow(p, x, y, cyan ? 36 : 84, cyan ? 118 : 40, cyan ? 140 : 160);
    });
  }
  // Crystal clusters: little faceted diamonds, lit from the upper left.
  for (let k = 0; k < 5; k++) {
    const cx = rng.int(0, S - 1);
    const cy = rng.int(0, S - 1);
    const r = rng.int(2, 3);
    const cyan = rng.chance(0.5);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d > r) continue;
        const x = wrap(cx + dx, S);
        const y = wrap(cy + dy, S);
        const lit = dx <= 0 && dy <= 0 ? 1.35 : dx > 0 && dy > 0 ? 0.6 : 0.95;
        put(p, x, y, (cyan ? 70 : 120) * lit, (cyan ? 160 : 80) * lit, (cyan ? 180 : 190) * lit, 0.95 - d * 0.12);
        if (d === 0) glow(p, x, y, cyan ? 60 : 110, cyan ? 170 : 60, cyan ? 190 : 200);
      }
    }
  }
  return p;
}

/** Hollow: pale ash-grey flagstones, scattered bone fragments, and one faint
 * carved rune per tile — dim, so the repeat reads as "every few steps a
 * ward" rather than a lit grid. */
function boneslab(rng: Rng) {
  const p = blank(S, { emissive: true });
  const f = blockField(rng, S, [12, 18], [12, 22]);
  const drift = tileNoise(rng, 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const n = rng.next();
      if (f.edge[i] === 0) {
        const v = 36 + n * 10;
        put(p, x, y, v, v * 0.96, v * 0.9, 0.15);
        continue;
      }
      const tone = blockTone(f.id[i], 6);
      const v = 88 + tone * 12 + n * 16 + drift[i] * 18;
      put(p, x, y, v, v * 0.97, v * 0.9, f.edge[i] === 1 ? 0.5 : 0.56 + n * 0.26);
    }
  }
  // Bone fragments: short, raised, lit on top.
  for (let k = 0; k < 7; k++) {
    const x0 = rng.int(0, S - 1);
    const y0 = rng.int(0, S - 1);
    const len = rng.int(4, 7);
    const vertical = rng.chance(0.5);
    for (let s = 0; s < len; s++) {
      const knob = s === 0 || s === len - 1;
      const x = vertical ? x0 : wrap(x0 + s, S);
      const y = vertical ? wrap(y0 + s, S) : y0;
      put(p, x, y, 210, 200, 172, 0.85);
      if (knob) {
        // Knobs stick out one texel either side of the shaft.
        const ox = vertical ? 1 : 0;
        const oy = vertical ? 0 : 1;
        put(p, wrap(x + ox, S), wrap(y + oy, S), 176, 166, 140, 0.78);
        put(p, wrap(x - ox, S), wrap(y - oy, S), 214, 204, 178, 0.8);
      }
    }
  }
  const gx = rng.int(0, S - 8);
  const gy = rng.int(0, S - 8);
  carveGlyph(p, glyphMask(rng, 7, 7, 1), 7, 7, gx, gy, [96, 124, 132], 0.3);
  return p;
}

export const FLOORS: Record<FloorSurface, SurfaceDef> = {
  slab: { paint: slab, hints: { roughness: 0.6, metalness: 0.18, envMapIntensity: 0.75 } },
  wetslab: {
    paint: wetslab,
    // roughness 1: the map carries it. Extra env so puddles mirror the room.
    hints: { roughness: 1, metalness: 0.22, envMapIntensity: 1.25 },
  },
  ashslab: {
    paint: ashslab,
    hints: {
      roughness: 0.86,
      metalness: 0.08,
      envMapIntensity: 0.35,
      emissive: "#ffffff",
      emissiveIntensity: 1.4,
    },
  },
  crystalslab: {
    paint: crystalslab,
    hints: {
      roughness: 0.38,
      metalness: 0.22,
      envMapIntensity: 1,
      emissive: "#ffffff",
      emissiveIntensity: 0.8,
    },
  },
  boneslab: {
    paint: boneslab,
    hints: {
      roughness: 0.85,
      metalness: 0,
      envMapIntensity: 0.3,
      emissive: "#ffffff",
      emissiveIntensity: 0.8,
    },
  },
};
