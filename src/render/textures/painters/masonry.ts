import type { Rng } from "../../../core/rng";
import type { WallSurface } from "../kinds";
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
  tileNoise,
  torusDelta,
  voronoi,
  walk,
  type SurfaceDef,
} from "../paint";
import { carveGlyph, glyphMask } from "./glyphs";

/** Wall painters — one per biome. Wall texels are twice as tall in the world
 * as they are wide (see kinds.ts), so bricks are painted 2:1 wide and
 * Voronoi facets use aspect 2. */

/** Catacombs: rough grey-violet brick with rare cracks. (Unchanged — the
 * original dungeon wall.) */
function stone(rng: Rng) {
  const p = blank();
  const brickH = 8;
  const brickW = 16;
  for (let y = 0; y < S; y++) {
    const row = Math.floor(y / brickH);
    const offset = (row % 2) * (brickW / 2);
    for (let x = 0; x < S; x++) {
      const bx = (x + offset) % brickW;
      const mortar = y % brickH === 0 || bx === 0;
      const n = rng.next();
      if (mortar) {
        const v = 26 + n * 14;
        put(p, x, y, v, v * 0.95, v * 1.05, 0.18);
      } else {
        const base = 68 + n * 34 + (((row * 7 + Math.floor((x + offset) / brickW)) % 5) - 2) * 9;
        const crack = n > 0.965;
        const v = crack ? base * 0.45 : base;
        put(p, x, y, v * 0.92, v * 0.9, v, crack ? 0.4 : 0.65 + rng.next() * 0.3);
      }
    }
  }
  return p;
}

/** Drowned: cold teal/blue-grey ashlar, streaked where water seeps from the
 * joints and dark-glossy below an old waterline. The roughness map is the
 * point: wet texels drop to ~0.15, so torchlight glints off the streaks. */
function wetstone(rng: Rng) {
  const p = blank(S, { roughness: true });
  const f = blockField(rng, S, [6, 9], [12, 22]);
  const damp = tileNoise(rng, 4);
  // Seep streaks run DOWN from joints (no vertical wrap: walls don't stack).
  const drip = new Float32Array(S * S);
  for (let k = 0; k < 16; k++) {
    let x = rng.int(0, S - 1);
    const y0 = rng.int(0, S - 16);
    const len = rng.int(6, 22);
    for (let d = 0; d < len && y0 + d < S; d++) {
      const i = (y0 + d) * S + x;
      drip[i] = Math.max(drip[i], 1 - (d / len) * 0.7);
      if (rng.chance(0.12)) x = (x + (rng.chance(0.5) ? 1 : S - 1)) % S;
    }
  }
  // Old waterline, ~0.75 m up the wall, ragged by a texel or two.
  const waterline = new Int32Array(S);
  const lineBase = S - 12;
  for (let x = 0; x < S; x++) waterline[x] = lineBase + Math.round(Math.sin(x * 0.55) * 0.8 + rng.next() * 1.2);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const n = rng.next();
      const below = y > waterline[x];
      const atLine = y === waterline[x];
      const e = f.edge[i];
      let r: number, g: number, b: number, h: number, rough: number;
      if (e === 0) {
        const v = 18 + n * 10;
        [r, g, b] = [v * 0.85, v * 1.25, v * 1.35];
        h = 0.2;
        rough = 0.95;
        // Algae in damp joints.
        if (damp[i] > 0.5 && n > 0.45) [r, g, b] = [26, 52, 44];
      } else {
        const tone = blockTone(f.id[i], 7);
        const v = 62 + tone * 12 + n * 14;
        [r, g, b] = [v * 0.74, v * 0.92, v * 1.02];
        h = e === 1 ? 0.52 : 0.66 + n * 0.26;
        rough = 0.82 + n * 0.12;
      }
      // Wetness: streaks, damp patches, everything below the waterline.
      const w = Math.max(drip[i], below ? 0.85 : 0, clamp01((damp[i] - 0.66) * 3));
      if (w > 0) {
        const k = 1 - 0.32 * w;
        r *= k * (below ? 0.85 : 1);
        g *= k * (below ? 1.06 : 1);
        b *= k;
        rough = lerp(rough, 0.14, w);
        // Water fills the pores: the surface smooths toward its mean.
        h = lerp(h, 0.66, w * 0.5);
      }
      if (atLine) {
        // Tide mark: a thin pale-green crust.
        [r, g, b] = [56 + n * 16, 84 + n * 16, 72 + n * 12];
        h = 0.74;
        rough = 0.7;
      }
      put(p, x, y, r, g, b, h);
      setRoughness(p, x, y, rough);
    }
  }
  return p;
}

/** Forge: near-black basalt columns (columnar jointing), rounded so each
 * column catches a highlight, split by jagged magma cracks that rise from
 * the floor and cool as they climb. Emissive is painted in color (white
 * tint in the hints). */
function basalt(rng: Rng) {
  const p = blank(S, { emissive: true });
  const f = blockField(rng, S, [7, 12], [10, 28], true);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const n = rng.next();
      if (f.edge[i] === 0) {
        const v = 9 + n * 6;
        put(p, x, y, v, v * 0.9, v * 0.9, 0.08);
      } else {
        const tone = blockTone(f.id[i], 3);
        // Round the column: highest mid-column, falling to the joints.
        const round = Math.sin(Math.PI * f.across[i]);
        const v = (30 + tone * 7 + n * 10) * (0.72 + round * 0.4);
        put(p, x, y, v * 1.02, v * 0.94, v * 0.95, 0.35 + round * 0.5 + n * 0.08);
      }
    }
  }
  // Magma cracks: start low, climb (heading 5/6/7 = up-left/up/up-right),
  // brightest near the floor. Rows near the top stay dark so nothing wraps
  // round to glow at the ceiling seam.
  const hot = new Uint8Array(S * S);
  for (let k = 0; k < 6; k++) {
    walk(
      rng,
      S,
      rng.int(12, 30),
      (x, y, t) => {
        if (y < 10) return;
        const heat = clamp01((y - 10) / (S - 10)) * (1 - t * 0.35);
        hot[y * S + x] = 1;
        put(p, x, y, 60 + heat * 40, 18 + heat * 12, 8, 0.06);
        glow(p, x, y, lerp(150, 255, heat), lerp(30, 165, heat), lerp(6, 56, heat));
      },
      { y: rng.int(S - 22, S - 1), heading: rng.int(5, 7) },
    );
  }
  // A few embers caught in the lower rock.
  for (let k = 0; k < 6; k++) {
    const x = rng.int(0, S - 1);
    const y = rng.int(Math.floor(S * 0.6), S - 1);
    put(p, x, y, 90, 34, 14, 0.5);
    glow(p, x, y, 200, 70, 12);
  }
  haloAround(p, hot, [1.6, 1.05, 0.9], [70, 18, 4]);
  return p;
}

/** Crystal: violet/cyan facets. Each Voronoi cell is a flat tilted plane, so
 * the normal map turns the wall into a field of gem faces that flash as the
 * light moves; a few seams carry a faint glowing vein. */
function crystal(rng: Rng) {
  const p = blank(S, { emissive: true });
  const vor = voronoi(rng, 16, S, 2);
  const facets = vor.points.map(() => ({
    sx: rng.range(-0.06, 0.06),
    sy: rng.range(-0.06, 0.06),
    base: rng.range(0.55, 0.78),
    hue: rng.next(),
  }));
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const n = rng.next();
      const c = vor.cell[i];
      const seam = vor.d2[i] - vor.d1[i] < 1.1;
      if (seam) {
        const a = Math.min(c, vor.cell2[i]);
        const b = Math.max(c, vor.cell2[i]);
        const veined = blockTone(a * 31 + b, 11) > 0.3;
        if (veined) {
          const cyan = blockTone(a + b * 7, 5) > 0;
          put(p, x, y, cyan ? 60 : 96, cyan ? 120 : 64, cyan ? 140 : 150, 0.3);
          glow(p, x, y, cyan ? 40 : 90, cyan ? 130 : 44, cyan ? 150 : 170);
        } else {
          put(p, x, y, 18, 12, 30, 0.2);
        }
        continue;
      }
      const fc = facets[c];
      const dx = torusDelta(x + 0.5, vor.points[c].x, S);
      const dy = torusDelta(y + 0.5, vor.points[c].y, S);
      const h = Math.min(0.98, Math.max(0.25, fc.base + fc.sx * dx + fc.sy * dy));
      // Pixel-art facet shading: a fixed key light from the upper left.
      const lit = Math.min(1.3, Math.max(0.55, 0.9 + (fc.sx - fc.sy) * 6));
      const v = lit * (0.9 + n * 0.16);
      let r = lerp(92, 52, fc.hue) * v;
      let g = lerp(58, 138, fc.hue) * v;
      let b = lerp(152, 168, fc.hue) * v;
      if (n > 0.986) [r, g, b] = [220, 225, 255]; // inner sparkle
      put(p, x, y, r, g, b, h);
    }
  }
  return p;
}

/** Hollow: an ossuary wall — rows of stacked long bones and skulls in ash,
 * pale and dry. One carved plaque per tile bears a rune that glows a faint
 * spectral white (kept small and dim so the repeat doesn't read as a grid). */
function bone(rng: Rng) {
  const p = blank(S, { emissive: true });
  // Ash backdrop.
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = rng.next();
      const v = 30 + n * 12;
      put(p, x, y, v * 1.05, v, v * 0.92, 0.08 + n * 0.06);
    }
  }
  const boneAt = (x: number, y: number, lit: number, h: number, warm = 1) => {
    const n = rng.next();
    const v = (170 + n * 34) * lit;
    put(p, x % S, y, v, v * 0.95 * warm, v * 0.8 * warm, h);
  };
  // Ten rows, exactly 64 texels: bones need 6-7 texel rows to fit a knob.
  const rows = rng.shuffle([7, 7, 7, 7, 6, 6, 6, 6, 6, 6]);
  let y0 = 0;
  for (const rh of rows) {
    const yc = y0 + 3;
    let x = rng.int(0, S - 1);
    const end = x + S;
    while (x < end) {
      const room = end - x;
      if (room < 6) break;
      if (rng.chance(0.22) && room >= 8) {
        // Skull, 7 wide, domed; eye sockets, nose, a row of teeth.
        for (let dy = 1; dy < rh; dy++) {
          for (let dx = 0; dx < 7; dx++) {
            if (dy === 1 && (dx === 0 || dx === 6)) continue;
            const lit = dy <= 2 ? 1.05 : dy >= rh - 1 ? 0.72 : 0.9;
            const dome = 1 - Math.abs(dx - 3) / 5;
            boneAt(x + dx, y0 + dy, lit, 0.55 + dome * 0.35, 1.03);
          }
        }
        for (const ex of [1, 2, 4, 5]) put(p, (x + ex) % S, y0 + 2, 22, 18, 16, 0.12);
        for (const ex of [1, 5]) put(p, (x + ex) % S, y0 + 3, 22, 18, 16, 0.12);
        put(p, (x + 3) % S, y0 + 4, 30, 24, 20, 0.2);
        if (rh >= 6) for (const tx of [1, 3, 5]) put(p, (x + tx) % S, y0 + rh - 1, 40, 34, 28, 0.3);
        x += 8;
      } else {
        // Long bone: 3-texel shaft, notched knobs at both ends.
        const len = Math.min(room, rng.int(9, 18));
        for (let dx = 0; dx < len; dx++) {
          const knob = dx < 2 || dx >= len - 2;
          for (let dy = -2; dy <= 2; dy++) {
            if (!knob && Math.abs(dy) > 1) continue;
            if (knob && dy === 0 && (dx === 0 || dx === len - 1)) continue; // notch
            const lit = dy < 0 ? 1.08 : dy > 0 ? 0.74 : 0.95;
            const h = knob ? 0.9 - Math.abs(dy) * 0.08 : 0.8 - Math.abs(dy) * 0.14;
            boneAt(x + dx, yc + dy, lit, h, knob ? 1.04 : 1);
          }
        }
        x += len + rng.int(0, 1);
      }
    }
    y0 += rh;
  }
  // The plaque: a flat ash-stone slab set into the bones, rune carved in.
  const pw = 9;
  const ph = 9;
  const px = rng.int(0, S - pw);
  const py = rng.int(8, S - ph - 8);
  for (let dy = 0; dy < ph; dy++) {
    for (let dx = 0; dx < pw; dx++) {
      const n = rng.next();
      const border = dx === 0 || dy === 0 || dx === pw - 1 || dy === ph - 1;
      const v = border ? 70 + n * 10 : 118 + n * 16;
      put(p, px + dx, py + dy, v, v * 0.97, v * 0.92, border ? 0.5 : 0.72);
    }
  }
  carveGlyph(p, glyphMask(rng, 5, 5, 1), 5, 5, px + 2, py + 2, [150, 196, 210], 0.3);
  return p;
}

export const MASONRY: Record<WallSurface, SurfaceDef> = {
  stone: { paint: stone, hints: { roughness: 0.88, metalness: 0.06, envMapIntensity: 0.4 } },
  wetstone: {
    paint: wetstone,
    // roughness 1: the map carries it (three multiplies the two).
    hints: { roughness: 1, metalness: 0.08, envMapIntensity: 0.95 },
  },
  basalt: {
    paint: basalt,
    hints: {
      roughness: 0.9,
      metalness: 0.1,
      envMapIntensity: 0.3,
      emissive: "#ffffff",
      emissiveIntensity: 1.6,
    },
    normalStrength: 2.6,
  },
  crystal: {
    paint: crystal,
    hints: {
      roughness: 0.32,
      metalness: 0.25,
      envMapIntensity: 1.2,
      emissive: "#ffffff",
      emissiveIntensity: 0.9,
    },
    normalStrength: 3,
  },
  bone: {
    paint: bone,
    hints: {
      roughness: 0.82,
      metalness: 0,
      envMapIntensity: 0.3,
      emissive: "#ffffff",
      emissiveIntensity: 0.9,
    },
  },
};
