import { Rng } from "../../core/rng";
import { blank, type Painted } from "./canvas";
import { fbm, hash2 } from "./noise";
import { hex, type Rgb } from "./palette";

/** The floor's marks, painted: what a blast burns into the stone and what a
 * dying thing leaves on it — one atlas of MARK_KINDS rows × MARK_VARIANTS
 * cells, each MARK_CELL px square, alpha-cut (every texel solid or absent)
 * so a mark is as crisp as the stone it lies on.
 *
 * Rows (fx/decals/decalPool.ts#DecalKind follows this order):
 *  - scorch — char black at the heart, soot browns out to a ragged rim,
 *    blast rays thrown out along the stone; glassy fused grit in the
 *    middle; embers scattered through it;
 *  - goo — a blob with flung droplets and the streaks between them, lit
 *    from above-left in four steps with a dark rim and wet highlights,
 *    painted grey so the creature's colour tints it;
 *  - ash — soul-ash: a powder heap dissolving into a dither at its edge,
 *    cinders in it, thick with specks of the soul's light;
 *  - shards — splinters of crystal, each facet its own tone with a lit
 *    edge, some still glowing inside.
 *
 * Channels: colour (sRGB, alpha = coverage), `rough` (roughness), the
 * emit channel's red = each glowing speck's LIFETIME (0 = never glows,
 * 255 = glows the longest), so the specks go out one by one as the mark
 * ages (the shader compares it with the mark's age), and `height` reused as
 * SHEEN (how much specular a texel keeps: soot and ash almost none, or a
 * black scorch would glint as bright as the stone at grazing angles).
 * Pure: tested with the other painters. */

export const MARK_CELL = 64;
export const MARK_KINDS = 4;
export const MARK_VARIANTS = 4;
export const MARK_ROWS = ["scorch", "goo", "ash", "shards"] as const;

const SOOT = ["#020101", "#050303", "#0a0706", "#130e0b", "#1e1611"].map(hex);
/** Share of the specular sheen a matte texel keeps. */
const MATTE_SHEEN = 0.12;
const GLASS: Rgb = hex("#3b3233");
const GOO = ["#2a2a2a", "#5a5a5a", "#8c8c8c", "#bcbcbc", "#f2f2f2"].map(hex);
const ASH = ["#1a181b", "#2a272b", "#3d393e", "#57525a", "#77717c"].map(hex);
const SHARD = ["#34343e", "#5c5c6c", "#8e8ea2", "#c8c8da", "#f4f4ff"].map(hex);

/** 4×4 Bayer threshold in (0, 1). */
function bayer(x: number, y: number): number {
  const m = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  return (m[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
}

interface Cell {
  p: Painted;
  x0: number;
  y0: number;
}

function set(c: Cell, x: number, y: number, col: Rgb, rough: number, life = 0): void {
  if (x < 0 || y < 0 || x >= MARK_CELL || y >= MARK_CELL) return;
  const px = c.x0 + x;
  const py = c.y0 + y;
  const i = py * c.p.w + px;
  c.p.color[i * 4] = col[0];
  c.p.color[i * 4 + 1] = col[1];
  c.p.color[i * 4 + 2] = col[2];
  c.p.color[i * 4 + 3] = 255;
  c.p.rough![i] = rough;
  // Sheen: matte soot and ash drink it, wet and glassy texels keep it.
  c.p.height[i] = rough >= 0.9 ? MATTE_SHEEN : 1;
  const e = c.p.emit!;
  e[i * 4] = Math.round(Math.max(0, Math.min(1, life)) * 255);
  e[i * 4 + 3] = 255;
}

function covered(c: Cell, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= MARK_CELL || y >= MARK_CELL) return false;
  return c.p.color[((c.y0 + y) * c.p.w + c.x0 + x) * 4 + 3] === 255;
}

const C = MARK_CELL / 2;

function scorch(c: Cell, rng: Rng, seed: number): void {
  const R = 29;
  const rays = Array.from({ length: rng.int(7, 12) }, () => ({
    a: rng.range(-Math.PI, Math.PI),
    w: rng.range(0.05, 0.13),
    len: rng.range(0.82, 1.02),
  }));
  const phases = [rng.range(0, 6.3), rng.range(0, 6.3), rng.range(0, 6.3)];
  for (let y = 0; y < MARK_CELL; y++) {
    for (let x = 0; x < MARK_CELL; x++) {
      const dx = x + 0.5 - C;
      const dy = y + 0.5 - C;
      const d = Math.hypot(dx, dy) / R;
      const a = Math.atan2(dy, dx);
      let edge = 0.6 + 0.07 * Math.sin(a * 3 + phases[0]) + 0.05 * Math.sin(a * 5 + phases[1]) + 0.04 * Math.sin(a * 9 + phases[2]);
      for (const r of rays) {
        let da = Math.abs(a - r.a);
        if (da > Math.PI) da = Math.PI * 2 - da;
        if (da < r.w) edge = Math.max(edge, r.len * Math.sqrt(1 - da / r.w));
      }
      const n = hash2(x, y, seed);
      edge += (n - 0.5) * 0.08;
      if (d >= edge) {
        // Stray soot just past the rim.
        if (d < edge + 0.12 && n < 0.16) set(c, x, y, SOOT[4], 0.95);
        continue;
      }
      const t = d / edge;
      const grain = fbm(x, y, MARK_CELL, MARK_CELL, 4, seed + 7) - 0.5;
      const tone = Math.max(0, Math.min(0.999, t * 0.95 + grain * 0.3 + (bayer(x, y) - 0.5) * 0.16));
      let col = SOOT[Math.floor(tone * SOOT.length)];
      let rough = 0.95;
      // Fused grit: glassy texels near the heart.
      if (t < 0.4 && hash2(x, y, seed + 3) < 0.06) {
        col = GLASS;
        rough = 0.3;
      }
      const e = hash2(x, y, seed + 5);
      const life = t < 0.8 && e < 0.06 + 0.14 * (1 - t) ? (0.25 + 0.75 * hash2(x, y, seed + 9)) * (1 - 0.45 * t) : 0;
      set(c, x, y, col, rough, life);
    }
  }
}

function goo(c: Cell, rng: Rng, seed: number): void {
  // Height field: the blob, its droplets and the streaks flung between.
  const h = new Float32Array(MARK_CELL * MARK_CELL);
  // `peak`: how proud the goo stands (thin streaks lie flat, no gloss).
  const blob = (cx: number, cy: number, r: number, wob: number, peak = 1) => {
    const ph = rng.range(0, 6.3);
    for (let y = Math.floor(cy - r - 3); y <= cy + r + 3; y++)
      for (let x = Math.floor(cx - r - 3); x <= cx + r + 3; x++) {
        if (x < 0 || y < 0 || x >= MARK_CELL || y >= MARK_CELL) continue;
        const a = Math.atan2(y + 0.5 - cy, x + 0.5 - cx);
        const rr = r * (1 + wob * Math.sin(a * 3 + ph) + wob * 0.6 * Math.sin(a * 7 + ph * 2));
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / rr;
        if (d < 1) h[y * MARK_CELL + x] = Math.max(h[y * MARK_CELL + x], peak * (1 - d * d));
      }
  };
  const r0 = rng.range(12.5, 15.5);
  blob(C, C, r0, 0.14);
  // A second lobe, so the heart isn't a coin.
  const la = rng.range(-Math.PI, Math.PI);
  blob(C + Math.cos(la) * r0 * 0.6, C + Math.sin(la) * r0 * 0.6, r0 * 0.6, 0.12, 0.85);
  const drops = rng.int(5, 9);
  for (let i = 0; i < drops; i++) {
    const a = rng.range(-Math.PI, Math.PI);
    const dist = r0 + rng.range(2, 12);
    const rr = rng.range(1.6, 3.8) * (1 - (dist - r0) / 30);
    const dxu = Math.cos(a);
    const dyu = Math.sin(a);
    // The streak: a tapering line out to the droplet.
    for (let s = r0 * 0.7; s < dist; s += 0.5) {
      const w = 1.6 * (1 - (s - r0 * 0.7) / (dist - r0 * 0.7)) + 0.5;
      blob(C + dxu * s, C + dyu * s, w, 0, 0.45);
    }
    blob(C + dxu * dist, C + dyu * dist, rr, 0.1, 0.8);
  }
  for (let y = 0; y < MARK_CELL; y++) {
    for (let x = 0; x < MARK_CELL; x++) {
      const v = h[y * MARK_CELL + x];
      if (v <= 0) continue;
      const at = (xx: number, yy: number) =>
        xx < 0 || yy < 0 || xx >= MARK_CELL || yy >= MARK_CELL ? 0 : h[yy * MARK_CELL + xx];
      const rim = at(x - 1, y) <= 0 || at(x + 1, y) <= 0 || at(x, y - 1) <= 0 || at(x, y + 1) <= 0;
      // Lit from the upper left: the slope toward the light is brighter.
      const slope = (at(x - 1, y) - at(x + 1, y)) * 0.8 + (at(x, y - 1) - at(x, y + 1)) * 0.8;
      let tone = 0.35 + v * 0.35 + slope * 1.6 + (bayer(x, y) - 0.5) * 0.12;
      if (rim) tone = 0;
      const highlight = !rim && v > 0.6 && slope > 0.1;
      tone = Math.max(0, Math.min(0.999, tone));
      const col = highlight ? GOO[4] : GOO[Math.min(3, Math.floor(tone * 4))];
      const life = !rim && hash2(x, y, seed + 5) < 0.045 ? 0.3 + 0.7 * hash2(x, y, seed + 6) : 0;
      set(c, x, y, col, rim ? 0.45 : 0.16, life);
    }
  }
}

function ash(c: Cell, rng: Rng, seed: number): void {
  const R = rng.range(22, 27);
  const ph = rng.range(0, 6.3);
  for (let y = 0; y < MARK_CELL; y++) {
    for (let x = 0; x < MARK_CELL; x++) {
      const dx = x + 0.5 - C;
      const dy = y + 0.5 - C;
      const a = Math.atan2(dy, dx);
      const d = Math.hypot(dx, dy) / (R * (1 + 0.12 * Math.sin(a * 3 + ph) + 0.08 * Math.sin(a * 5 - ph)));
      const n = fbm(x, y, MARK_CELL, MARK_CELL, 5, seed);
      // Density falls off toward the edge; the powder dissolves in a dither.
      const density = 1.3 - d * 1.35 + (n - 0.5) * 0.5;
      if (bayer(x, y) * 0.6 + hash2(x, y, seed + 1) * 0.4 >= density) continue;
      const tone = Math.max(0, Math.min(0.999, (1 - d) * 0.55 + n * 0.5 + (hash2(x, y, seed + 2) - 0.5) * 0.25));
      const col = ASH[Math.floor(tone * ASH.length)];
      const life = hash2(x, y, seed + 3) < 0.16 * Math.max(0, 1 - d * 0.8) ? 0.2 + 0.8 * hash2(x, y, seed + 4) : 0;
      set(c, x, y, col, 1, life);
    }
  }
  // Cinders: 2×2 lumps.
  const lumps = rng.int(4, 8);
  for (let i = 0; i < lumps; i++) {
    const a = rng.range(-Math.PI, Math.PI);
    const r = Math.sqrt(rng.next()) * R * 0.7;
    const x = Math.round(C + Math.cos(a) * r);
    const y = Math.round(C + Math.sin(a) * r);
    const glow = rng.chance(0.5) ? rng.range(0.5, 1) : 0;
    set(c, x, y, ASH[4], 1, glow);
    set(c, x + 1, y, ASH[3], 1, glow);
    set(c, x, y + 1, ASH[2], 1, glow);
    set(c, x + 1, y + 1, ASH[1], 1, glow);
  }
}

function shards(c: Cell, rng: Rng, seed: number): void {
  const count = rng.int(20, 28);
  for (let s = 0; s < count; s++) {
    const a = rng.range(-Math.PI, Math.PI);
    const dist = Math.pow(rng.next(), 0.8) * 20;
    const cx = C + Math.cos(a) * dist;
    const cy = C + Math.sin(a) * dist;
    const size = rng.range(2.2, 5) * (1 - dist / 70);
    const spin = rng.range(0, Math.PI * 2);
    const tri = [0, 1, 2].map((k) => {
      const t = spin + (k * Math.PI * 2) / 3 + rng.range(-0.5, 0.5);
      const r = size * rng.range(0.6, 1.3) * (k === 0 ? 1.6 : 1);
      return [cx + Math.cos(t) * r, cy + Math.sin(t) * r] as const;
    });
    const base = rng.int(1, 3);
    const glows = rng.chance(0.4);
    const lx = Math.cos(spin + 2.4);
    const ly = Math.sin(spin + 2.4);
    for (let y = Math.floor(cy - size * 2.2); y <= cy + size * 2.2; y++) {
      for (let x = Math.floor(cx - size * 2.2); x <= cx + size * 2.2; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let inside = true;
        let sign = 0;
        for (let k = 0; k < 3; k++) {
          const [ax, ay] = tri[k];
          const [bx, by] = tri[(k + 1) % 3];
          const cr = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
          if (cr === 0) continue;
          if (sign === 0) sign = Math.sign(cr);
          else if (Math.sign(cr) !== sign) inside = false;
        }
        if (!inside) continue;
        // The facet toward the light is a step brighter.
        const lit = (px - cx) * lx + (py - cy) * ly > size * 0.35;
        const col = SHARD[Math.min(4, base + (lit ? 2 : 0))];
        const life = glows && !lit ? 0.35 + 0.65 * hash2(x, y, seed + s) : 0;
        set(c, x, y, col, 0.12, life);
      }
    }
  }
  // Glitter dust round them.
  for (let i = 0; i < 26; i++) {
    const a = rng.range(-Math.PI, Math.PI);
    const r = rng.range(4, 29);
    const x = Math.round(C + Math.cos(a) * r);
    const y = Math.round(C + Math.sin(a) * r);
    if (!covered(c, x, y)) set(c, x, y, SHARD[rng.int(1, 3)], 0.2, rng.chance(0.3) ? rng.range(0.2, 0.7) : 0);
  }
}

const PAINTERS = { scorch, goo, ash, shards } as const;

/** The whole atlas: row = kind (MARK_ROWS), column = variant. */
export function paintFloorMarks(seed = 0x5c0c4): Painted {
  const p = blank(MARK_CELL * MARK_VARIANTS, MARK_CELL * MARK_KINDS, { rough: true, emit: true });
  p.rough!.fill(1);
  MARK_ROWS.forEach((kind, row) => {
    for (let v = 0; v < MARK_VARIANTS; v++) {
      const s = (seed + row * 7919 + v * 104729) >>> 0;
      PAINTERS[kind]({ p, x0: v * MARK_CELL, y0: row * MARK_CELL }, new Rng(s), s);
    }
  });
  return p;
}

/** The data map the mark shader reads: R = roughness, G = speck lifetime,
 * B = sheen (the painter keeps it in the height channel — marks have no
 * relief of their own). */
export function marksDataRgba(p: Painted): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(p.w * p.h * 4);
  for (let i = 0; i < p.w * p.h; i++) {
    out[i * 4] = Math.round((p.rough ? p.rough[i] : 1) * 255);
    out[i * 4 + 1] = p.emit ? p.emit[i * 4] : 0;
    out[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, p.height[i])) * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}
