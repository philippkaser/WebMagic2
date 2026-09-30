import type { Rng } from "../../../core/rng";
import type { FloorSurface } from "../kinds";
import {
  ARCH_SIZE as S,
  type AshlarField,
  type Painted,
  ashlarField,
  blank,
  blockTone,
  clamp01,
  layeredNoise,
  lerp,
  put,
  setRoughness,
  smooth,
  voronoi,
  walk,
  type SurfaceDef,
} from "../paint";

/** Floor painters — one per biome, in the same language as the walls
 * (masonry.ts): calm albedo, detail in height and roughness, no painted
 * glow. Floors are where that pays off most: the dungeon floor is a
 * reflector (render/models/DungeonGround.tsx), and the roughness map decides
 * where it mirrors the torches — puddles and polish flash, dust and ash stay
 * dull. 128² over 4 m, world-mapped, flagstones of 0.7–2 m in irregular
 * courses so there is no 2 m grid to spot. */

/** Worn flagstone height: recessed joint, rounded edges, and a face dished
 * slightly toward its middle by centuries of feet — which is also where
 * water would stand. */
function wornHeight(f: AshlarField, i: number, grain: number, dish = 0.06): number {
  const e = f.edge[i];
  if (e === 0) return 0.14;
  if (e === 1) return 0.44;
  if (e === 2) return 0.56;
  const du = f.u[i] * 2 - 1;
  const dv = f.v[i] * 2 - 1;
  const r2 = Math.min(1, (du * du + dv * dv) * 0.5);
  return clamp01(0.64 - dish * (1 - r2) + (grain - 0.5) * 0.07);
}

/** Catacombs: big worn flagstones, warm grey, with damp glossy blooms where
 * water seeps up — a torch across the room glints in them. */
function flagstone(rng: Rng): Painted {
  const p = blank(S, { roughness: true });
  const f = ashlarField(rng, S, [24, 42], [30, 64], 0.35);
  const mottle = layeredNoise(rng, S, [[4, 1], [8, 0.45]]);
  const damp = layeredNoise(rng, S, [[4, 1], [8, 0.5], [16, 0.25]]);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const n = rng.next();
      const grain = rng.next();
      const wet = smooth(0.6, 0.7, damp[i]);
      if (f.edge[i] === 0) {
        const v = 30 + n * 5;
        put(p, x, y, v * 1.08, v, v * 0.9, 0.14);
        setRoughness(p, x, y, lerp(0.95, 0.3, wet));
        continue;
      }
      const tone = blockTone(f.id[i], 2);
      let v = 1 + tone * 0.09 + (mottle[i] - 0.5) * 0.16 + (n - 0.5) * 0.04;
      if (f.edge[i] === 1) v *= 0.86;
      v *= 1 - 0.14 * wet;
      let h = wornHeight(f, i, grain);
      h = lerp(h, 0.6, wet * 0.6);
      put(p, x, y, 88 * v, 81 * v, 72 * v, h);
      setRoughness(p, x, y, lerp(0.78 + grain * 0.14, 0.12, wet));
    }
  }
  return p;
}

/** Drowned: cold blue-grey flagstones with shallow water standing in the
 * dished middles and in every seam. Puddles are FLAT (constant height →
 * flat normal) and near-mirror in the roughness map, so the reflector shows
 * clean torch reflections in them while the stone around stays soft. */
function wetslab(rng: Rng): Painted {
  const p = blank(S, { roughness: true });
  const f = ashlarField(rng, S, [24, 42], [28, 60], 0.3);
  const pool = layeredNoise(rng, S, [[4, 1], [8, 0.5], [16, 0.25]]);
  const mottle = layeredNoise(rng, S, [[4, 1], [9, 0.4]]);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const n = rng.next();
      const grain = rng.next();
      // Water gathers where the pool noise is high AND the stone dips.
      const du = f.u[i] * 2 - 1;
      const dv = f.v[i] * 2 - 1;
      const dip = 1 - Math.min(1, (du * du + dv * dv) * 0.5);
      const wet = pool[i] * 0.7 + dip * 0.3;
      if (wet > 0.66 && f.edge[i] > 0) {
        // Standing water: dark teal, dead flat, mirror-smooth.
        const v = 1 + (n - 0.5) * 0.04;
        put(p, x, y, 17 * v, 30 * v, 36 * v, 0.5);
        setRoughness(p, x, y, 0.02);
        continue;
      }
      if (f.edge[i] === 0) {
        // Seams hold water too.
        const v = 16 + n * 4;
        put(p, x, y, v * 0.9, v * 1.3, v * 1.5, 0.3);
        setRoughness(p, x, y, 0.08);
        continue;
      }
      const tone = blockTone(f.id[i], 2);
      let v = 58 * (1 + tone * 0.09 + (mottle[i] - 0.5) * 0.14 + (n - 0.5) * 0.04);
      if (f.edge[i] === 1) v *= 0.86;
      let h = wornHeight(f, i, grain, 0.05);
      let rough = 0.72 + grain * 0.16;
      // Damp ring around each puddle: darker, slicker, pores filled.
      const t = smooth(0.56, 0.66, wet);
      v *= 1 - 0.3 * t;
      h = lerp(h, 0.54, t * 0.6);
      rough = lerp(rough, 0.18, t);
      put(p, x, y, v * 0.8, v * 0.93, v * 1.04, h);
      setRoughness(p, x, y, rough);
    }
  }
  return p;
}

/** Ember Forge: flags of dark volcanic glass. Irregular polygons (it was
 * poured and cracked, not cut), glossy black with faint conchoidal ripples
 * in the height field, dull ash packed into the joints and drifted over a
 * few flags. The glass is what the orange torchlight mirrors in. */
function obsidian(rng: Rng): Painted {
  const p = blank(S, { roughness: true });
  const vor = voronoi(rng, 26, S);
  const ash = layeredNoise(rng, S, [[4, 1], [8, 0.5], [16, 0.25]]);
  const warp = layeredNoise(rng, S, [[8, 1], [16, 0.5]]);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const n = rng.next();
      const grain = rng.next();
      const gap = vor.d2[i] - vor.d1[i];
      const drift = smooth(0.64, 0.76, ash[i]);
      if (gap < 1.1) {
        // Ash packed into the joint: dull, only a little paler than the glass.
        const v = 30 + n * 6;
        put(p, x, y, v * 1.06, v, v * 0.94, 0.16);
        setRoughness(p, x, y, 0.96);
        continue;
      }
      const c = vor.cell[i];
      const tone = blockTone(c, 4);
      // Conchoidal ripples: rings around each flag's seed point.
      const ripple = Math.sin(vor.d1[i] * 0.7 + warp[i] * 9 + tone * 6);
      let v = 25 * (1 + tone * 0.1 + ripple * 0.03 + (n - 0.5) * 0.04);
      if (gap < 2.1) v *= 0.8;
      let h = gap < 2.1 ? 0.46 : 0.62 + ripple * 0.03 + (grain - 0.5) * 0.02;
      let rough = 0.08 + grain * 0.1;
      // Ash drifts dull the glass and fill its ripples.
      v = lerp(v, 46 + n * 5, drift * 0.7);
      h = lerp(h, 0.66, drift * 0.5);
      rough = lerp(rough, 0.9, drift);
      put(p, x, y, v * 1.05, v * 0.97, v * 0.95, h);
      setRoughness(p, x, y, rough);
    }
  }
  return p;
}

/** Crystal Deep: great slabs of polished dark stone, near-mirror, with faint
 * pale veins (albedo only — no glow). Dead flat faces so the reflection of
 * the crystal clusters and violet light stays clean; only the joints and
 * bevels break it up. */
function polished(rng: Rng): Painted {
  const p = blank(S, { roughness: true });
  const f = ashlarField(rng, S, [32, 48], [40, 72], 0.2);
  const mottle = layeredNoise(rng, S, [[3, 1], [7, 0.4]]);
  const vein = new Float32Array(S * S);
  for (let k = 0; k < 5; k++) {
    walk(rng, S, rng.int(30, 70), (x, y, t) => {
      vein[y * S + x] = Math.max(vein[y * S + x], 0.6 + 0.4 * Math.sin(Math.PI * t));
    });
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const n = rng.next();
      const grain = rng.next();
      if (f.edge[i] === 0) {
        const v = 12 + n * 3;
        put(p, x, y, v * 0.95, v * 0.85, v * 1.3, 0.2);
        setRoughness(p, x, y, 0.7);
        continue;
      }
      const tone = blockTone(f.id[i], 9);
      let v = 34 * (1 + tone * 0.1 + (mottle[i] - 0.5) * 0.12 + (n - 0.5) * 0.02);
      v *= 1 + vein[i] * 0.45;
      const edge = f.edge[i] === 1;
      if (edge) v *= 0.8;
      put(p, x, y, v * 0.92, v * 0.84, v * 1.22, edge ? 0.5 : 0.62);
      setRoughness(p, x, y, edge ? 0.4 : 0.05 + grain * 0.08);
    }
  }
  return p;
}

/** The Hollow: pale flags dusted with ash. Matte — the one floor that
 * doesn't shine — and nearly colourless; the drifts are a touch lighter and
 * greyer, the joints ash-filled. */
function ashflag(rng: Rng): Painted {
  const p = blank(S, { roughness: true });
  const f = ashlarField(rng, S, [24, 42], [30, 64], 0.3);
  const dust = layeredNoise(rng, S, [[3, 1], [7, 0.5], [15, 0.25]]);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const n = rng.next();
      const grain = rng.next();
      const drift = smooth(0.5, 0.7, dust[i]);
      if (f.edge[i] === 0) {
        const v = lerp(84, 118, drift) + n * 6;
        put(p, x, y, v, v * 0.99, v * 0.97, 0.3);
        setRoughness(p, x, y, 1);
        continue;
      }
      const tone = blockTone(f.id[i], 6);
      let v = 1 + tone * 0.05 + (n - 0.5) * 0.03;
      if (f.edge[i] === 1) v *= 0.88;
      const r = lerp(148 * v, 166, drift * 0.6);
      const g = lerp(145 * v, 164, drift * 0.6);
      const b = lerp(138 * v, 160, drift * 0.6);
      put(p, x, y, r, g, b, lerp(wornHeight(f, i, grain, 0.04), 0.6, drift * 0.4));
      setRoughness(p, x, y, 0.9 + grain * 0.1);
    }
  }
  return p;
}

export const FLOORS: Record<FloorSurface, SurfaceDef> = {
  // Roughness maps everywhere → hint 1 (three.js multiplies the two). The
  // env hints are kept low for a material given its own envMap; with the
  // scene's environment, three uses scene.environmentIntensity instead,
  // which each biome sets (world/biomes.ts envIntensity).
  flagstone: {
    paint: flagstone,
    hints: { roughness: 1, metalness: 0.06, envMapIntensity: 0.12 },
    mipmaps: true,
  },
  wetslab: {
    paint: wetslab,
    hints: { roughness: 1, metalness: 0.12, envMapIntensity: 0.2 },
    mipmaps: true,
  },
  obsidian: {
    paint: obsidian,
    hints: { roughness: 1, metalness: 0.18, envMapIntensity: 0.08 },
    normalStrength: 2.6,
    mipmaps: true,
  },
  polished: {
    paint: polished,
    hints: { roughness: 1, metalness: 0.2, envMapIntensity: 0.06 },
    mipmaps: true,
  },
  ashflag: {
    paint: ashflag,
    hints: { roughness: 1, metalness: 0, envMapIntensity: 0.15 },
    mipmaps: true,
  },
};
