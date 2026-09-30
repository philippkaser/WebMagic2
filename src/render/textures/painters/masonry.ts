import type { Rng } from "../../../core/rng";
import type { WallSurface } from "../kinds";
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
  walk,
  type SurfaceDef,
} from "../paint";

/** Wall painters — one per biome, all speaking one material language:
 *
 *  - ALBEDO is calm: big stones, a few percent of tone between them, soft
 *    low-frequency mottling, almost no per-texel noise. Busy albedo is what
 *    made the old forge and crystal walls read as clutter.
 *  - DETAIL lives in the height field (→ Sobel normal map) and the roughness
 *    map: chisel grain, bevels, recessed joints, glossy damp patches. That
 *    detail only shows where light rakes across it, so a torch "draws" the
 *    wall around itself and the dark stays quiet.
 *  - EMISSIVE is never painted into a tiling wall — a glow that repeats every
 *    4 m reads as wallpaper. Heat, crystal light and runes are geometry and
 *    pooled lights instead (render/models, world/gen/architecture.ts).
 *  - The biome's COLOUR comes mostly from its light and fog; the stone is a
 *    near-neutral canvas tinted just enough to agree with them.
 *
 * 128² at 4 m per repeat, mapped from world position (see kinds.ts), so
 * texels are square in the world: stones are painted in their true
 * proportions. Row 0 is the TOP (drips run toward higher rows). */

/** Shared dressed-stone height profile: recessed joint, a two-texel bevel,
 * then a gently domed face with chisel grain. The grain is height-only — it
 * catches light without speckling the albedo. */
function dressedHeight(f: AshlarField, i: number, grain: number, dome = 0.08): number {
  const e = f.edge[i];
  if (e === 0) return 0.1;
  if (e === 1) return 0.46;
  if (e === 2) return 0.6;
  const du = f.u[i] * 2 - 1;
  const dv = f.v[i] * 2 - 1;
  return clamp01(0.7 + dome * (1 - (du * du + dv * dv) * 0.5) + (grain - 0.5) * 0.1);
}

/** Seep streaks: short trails running DOWN the wall from random joints,
 * fading as they go. Returned as a 0..1 wetness field. */
function seeps(rng: Rng, f: AshlarField, count: number, len: [number, number]): Float32Array {
  const drip = new Float32Array(S * S);
  for (let k = 0; k < count; k++) {
    let x = rng.int(0, S - 1);
    // Start on the first joint below a random row, so streaks leave joints.
    let y = rng.int(0, S - 1);
    for (let s = 0; s < S && f.edge[y * S + x] !== 0; s++) y = (y + 1) % S;
    const n = rng.int(len[0], len[1]);
    for (let d = 0; d < n; d++) {
      const yy = (y + d) % S;
      const i = yy * S + x;
      drip[i] = Math.max(drip[i], 1 - (d / n) * 0.8);
      if (rng.chance(0.1)) x = (x + (rng.chance(0.5) ? 1 : S - 1)) % S;
    }
  }
  return drip;
}

/** Hairline cracks: height-only nicks that stay inside the stone they start
 * in (a crack jumping a mortar joint looks painted on). */
function hairlines(rng: Rng, p: Painted, f: AshlarField, count: number): void {
  for (let k = 0; k < count; k++) {
    const startX = rng.int(0, S - 1);
    const startY = rng.int(0, S - 1);
    const home = f.id[startY * S + startX];
    walk(
      rng,
      S,
      rng.int(8, 18),
      (x, y) => {
        const i = y * S + x;
        if (f.id[i] !== home || f.edge[i] < 2) return;
        p.height[i] = Math.min(p.height[i], 0.38);
        const c = i * 4;
        p.color[c] *= 0.86;
        p.color[c + 1] *= 0.86;
        p.color[c + 2] *= 0.86;
      },
      { x: startX, y: startY },
    );
  }
}

/** Catacombs: an ancient tomb wall of large, irregular dressed blocks in
 * warm grey-brown, with dark recessed joints. Damp blooms (low-frequency)
 * darken the stone and turn it glossy, so a torch picks out wet patches as
 * glints; seep streaks run down from a few joints. */
function tomb(rng: Rng): Painted {
  const p = blank(S, { roughness: true });
  const f = ashlarField(rng, S, [16, 28], [28, 62], 0.3);
  const mottle = layeredNoise(rng, S, [[4, 1], [8, 0.45]]);
  const damp = layeredNoise(rng, S, [[4, 1], [8, 0.5], [16, 0.2]]);
  const drip = seeps(rng, f, 7, [10, 26]);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const n = rng.next();
      const grain = rng.next();
      if (f.edge[i] === 0) {
        const v = 30 + n * 5;
        put(p, x, y, v * 1.1, v, v * 0.9, 0.1);
        setRoughness(p, x, y, 0.95);
        continue;
      }
      const tone = blockTone(f.id[i], 1);
      let v = 1 + tone * 0.07 + (mottle[i] - 0.5) * 0.18 + (n - 0.5) * 0.04;
      if (f.edge[i] === 1) v *= 0.84;
      let rough = 0.8 + grain * 0.12;
      const wet = Math.max(smooth(0.6, 0.72, damp[i]), drip[i] * 0.85);
      v *= 1 - 0.14 * wet;
      rough = lerp(rough, 0.26, wet);
      put(p, x, y, 98 * v, 88 * v, 76 * v, dressedHeight(f, i, grain));
      setRoughness(p, x, y, rough);
    }
  }
  hairlines(rng, p, f, 5);
  return p;
}

/** Drowned: cold teal/blue-grey ashlar, streaked where water seeps from the
 * joints, algae in the damp mortar. The roughness map is the point: wet
 * texels drop to ~0.12, so the teal torchlight glints off the streaks. */
function wetstone(rng: Rng): Painted {
  const p = blank(S, { roughness: true });
  const f = ashlarField(rng, S, [16, 28], [28, 60], 0.25);
  const damp = layeredNoise(rng, S, [[4, 1], [8, 0.5], [16, 0.25]]);
  const mottle = layeredNoise(rng, S, [[3, 1], [9, 0.4]]);
  const drip = seeps(rng, f, 22, [12, 40]);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const n = rng.next();
      const grain = rng.next();
      const w = Math.max(drip[i], smooth(0.62, 0.74, damp[i]));
      if (f.edge[i] === 0) {
        const v = 20 + n * 5;
        let [r, g, b] = [v * 0.85, v * 1.2, v * 1.3];
        // Algae in the damp joints.
        if (damp[i] > 0.5 && n > 0.4) [r, g, b] = [24, 46, 40];
        put(p, x, y, r, g, b, 0.12);
        setRoughness(p, x, y, lerp(0.9, 0.2, w));
        continue;
      }
      const tone = blockTone(f.id[i], 7);
      let v = 64 * (1 + tone * 0.08 + (mottle[i] - 0.5) * 0.16 + (n - 0.5) * 0.04);
      if (f.edge[i] === 1) v *= 0.84;
      v *= 1 - 0.3 * w;
      let h = dressedHeight(f, i, grain, 0.06);
      // Water fills the pores: the surface smooths toward its mean.
      h = lerp(h, 0.7, w * 0.5);
      put(p, x, y, v * 0.74, v * 0.93, v * 1.02, h);
      setRoughness(p, x, y, lerp(0.8 + grain * 0.12, 0.12, w));
    }
  }
  return p;
}

/** Forge: calm columnar basalt. Tall hexagonal-ish columns (vertical joints
 * every 0.6–1 m, the odd cross-joint) that make the 7 m walls read even
 * taller. Near-black and low-contrast; each column is rounded in the height
 * field and a little glossy along its crown, so the forge's deep orange
 * torchlight runs down the columns in bright vertical lines. The heat is in
 * the light — nothing here glows. */
function basalt(rng: Rng): Painted {
  const p = blank(S, { roughness: true });
  const f = ashlarField(rng, S, [18, 32], [44, 128], 0, true);
  const mottle = layeredNoise(rng, S, [[3, 1], [8, 0.4]]);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const n = rng.next();
      const grain = rng.next();
      if (f.edge[i] === 0) {
        const v = 11 + n * 4;
        put(p, x, y, v * 1.05, v, v, 0.06);
        setRoughness(p, x, y, 0.95);
        continue;
      }
      const tone = blockTone(f.id[i], 3);
      // Round the column: highest mid-column, falling toward the joints.
      const round = Math.sin(Math.PI * f.u[i]);
      let v = 40 * (0.8 + round * 0.26) * (1 + tone * 0.08 + (mottle[i] - 0.5) * 0.14 + (n - 0.5) * 0.04);
      if (f.edge[i] === 1) v *= 0.8;
      put(p, x, y, v * 1.04, v * 0.96, v * 0.94, clamp01(0.3 + round * 0.55 + (grain - 0.5) * 0.06));
      setRoughness(p, x, y, 0.36 + (1 - round) * 0.28 + grain * 0.1);
    }
  }
  return p;
}

/** Crystal Deep: dark cleft slate in thin, long strata, each stone a
 * slightly tilted plane so the layers step in and out like a quarried cliff
 * and catch the violet light edge by edge. Glossy, cool, quiet — the
 * crystal is in the 3D clusters, not painted here. A rare mica fleck glints
 * (albedo + a near-mirror texel, no glow). */
function slate(rng: Rng): Painted {
  const p = blank(S, { roughness: true });
  const f = ashlarField(rng, S, [7, 18], [30, 104], 0);
  const mottle = layeredNoise(rng, S, [[3, 1], [8, 0.4]]);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const n = rng.next();
      const grain = rng.next();
      if (f.edge[i] === 0) {
        const v = 14 + n * 4;
        put(p, x, y, v * 0.95, v * 0.9, v * 1.3, 0.08);
        setRoughness(p, x, y, 0.9);
        continue;
      }
      const tone = blockTone(f.id[i], 5);
      const tilt = blockTone(f.id[i], 13) * 0.22;
      let v = 48 * (1 + tone * 0.09 + (mottle[i] - 0.5) * 0.12 + (n - 0.5) * 0.03);
      if (f.edge[i] === 1) v *= 0.82;
      const h = f.edge[i] === 1 ? 0.45 : clamp01(0.62 + (f.v[i] - 0.5) * tilt + (grain - 0.5) * 0.05);
      let rough = 0.28 + grain * 0.18;
      if (n > 0.9965 && f.edge[i] > 2) {
        v *= 1.7;
        rough = 0.04;
      }
      put(p, x, y, v * 0.92, v * 0.9, v * 1.2, h);
      setRoughness(p, x, y, rough);
    }
  }
  return p;
}

/** The Hollow: pale bone-white ashlar, drained of colour — big blocks, grey
 * joints, the faintest grime. Matte: this is the one biome whose stone
 * doesn't shine; the cold silver light and deep shadow do the work. */
function palestone(rng: Rng): Painted {
  const p = blank(S, { roughness: true });
  const f = ashlarField(rng, S, [18, 30], [30, 64], 0.3);
  const grime = layeredNoise(rng, S, [[4, 1], [9, 0.5]]);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const n = rng.next();
      const grain = rng.next();
      if (f.edge[i] === 0) {
        const v = 96 + n * 8;
        put(p, x, y, v, v * 0.98, v * 0.96, 0.12);
        setRoughness(p, x, y, 1);
        continue;
      }
      const tone = blockTone(f.id[i], 6);
      let v = 1 + tone * 0.05 + (grime[i] - 0.5) * 0.14 + (n - 0.5) * 0.03;
      if (f.edge[i] === 1) v *= 0.86;
      put(p, x, y, 150 * v, 148 * v, 142 * v, dressedHeight(f, i, grain, 0.05));
      setRoughness(p, x, y, 0.86 + grain * 0.12);
    }
  }
  hairlines(rng, p, f, 7);
  return p;
}

export const MASONRY: Record<WallSurface, SurfaceDef> = {
  // Every wall ships a roughness map, so the hint is 1: three.js multiplies
  // the two, and the map must be free to speak.
  tomb: { paint: tomb, hints: { roughness: 1, metalness: 0.04, envMapIntensity: 0.35 }, mipmaps: true },
  wetstone: {
    paint: wetstone,
    hints: { roughness: 1, metalness: 0.08, envMapIntensity: 0.6 },
    mipmaps: true,
  },
  basalt: {
    paint: basalt,
    hints: { roughness: 1, metalness: 0.1, envMapIntensity: 0.12 },
    normalStrength: 2.6,
    mipmaps: true,
  },
  slate: {
    paint: slate,
    hints: { roughness: 1, metalness: 0.12, envMapIntensity: 0.15 },
    normalStrength: 2.8,
    mipmaps: true,
  },
  palestone: {
    paint: palestone,
    hints: { roughness: 1, metalness: 0, envMapIntensity: 0.2 },
    mipmaps: true,
  },
};
