import { ARCHITECTURE, WALL_HEIGHT } from "../../core/config";
import { hashSeed } from "../../core/rng";
import type { DoorwaySpawn, FloorArchitecture, RibSpawn, Vec3, WallBox } from "../../world/types";
import { TRIM_BLOCK_H, TRIM_BLOCK_W, TRIM_SPAN, TRIM_TEX, trimBlocks } from "../textures/surfaces";
import { type MeshData, MeshBuilder } from "./architectureMesh";

/** The dungeon's dressed stonework as plain vertex buffers: pillars, the
 * arch ribs and the piers they spring from, and a frame round every
 * corridor mouth — jambs of alternating quoins on a plinth, an impost, an
 * arch of voussoirs round a keystone, and the header that closes the 6 m
 * slot above it. Pure (no three.js), unit-tested, and all of it one mesh in
 * the band's trim (render/textures/surfaces/trim.ts): one more draw call
 * for the whole floor, however many halls it has.
 *
 * Two ways of laying the trim on a face:
 *  - big faces (a pillar's shaft, a header, a rib's flanks) are mapped from
 *    world position, TRIM_SPAN metres per repeat, so courses run level at
 *    the same heights everywhere;
 *  - small stones (a voussoir, a quoin, a capital) are snapped onto ONE
 *    block of the texture, their edges on its joints — picked by a hash of
 *    where they stand — so every stone reads as its own cut block. Next to
 *    that, alternate stones stand a few centimetres prouder than their
 *    neighbours: the step is what the pixel-edge pass outlines, so the
 *    joints read even at a distance. */

const H = WALL_HEIGHT;
const UP: Vec3 = [0, 1, 0];
const DOWN: Vec3 = [0, -1, 0];

const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const neg = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];

/** A local frame: s along `r`, y up, d along `n` (both horizontal units). */
interface Frame {
  o: Vec3;
  r: Vec3;
  n: Vec3;
}

const at = (f: Frame, s: number, y: number, d: number): Vec3 => [
  f.o[0] + f.r[0] * s + f.n[0] * d,
  f.o[1] + y,
  f.o[2] + f.r[2] * s + f.n[2] * d,
];

/** The texture's snap blocks, as UV origins (top-left, image space). */
const BLOCKS = trimBlocks();
const TEX_PER_M = TRIM_TEX / TRIM_SPAN;

/** Per-corner UVs that lay a face of w × h metres (corners given as
 * bottom-left, bottom-right, top-right, top-left) on one block, its top
 * and left edges on the block's joints. Faces bigger than a block are
 * squeezed to fit (stones are cut to the block, not the other way). */
function blockUvs(key: number, w: number, h: number): number[] {
  const [bx, by] = BLOCKS[key % BLOCKS.length];
  const tw = Math.min(TRIM_BLOCK_W - 0.5, w * TEX_PER_M);
  const th = Math.min(TRIM_BLOCK_H - 0.5, h * TEX_PER_M);
  const u0 = bx / TRIM_TEX;
  const u1 = (bx + tw) / TRIM_TEX;
  const vTop = 1 - by / TRIM_TEX;
  const vBot = 1 - (by + th) / TRIM_TEX;
  return [u0, vBot, u1, vBot, u1, vTop, u0, vTop];
}

/** A stable small hash of a point (which block a stone gets). */
function keyOf(p: Vec3, salt: number): number {
  return hashSeed(`${p[0].toFixed(2)},${p[1].toFixed(2)},${p[2].toFixed(2)},${salt}`);
}

class StoneBuilder {
  readonly b = new MeshBuilder(TRIM_SPAN);

  /** A world-mapped quad (big faces). */
  world(a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3): void {
    this.b.quad(a, b, c, d, n);
  }

  /** A block-snapped quad: corners bottom-left, bottom-right, top-right,
   * top-left as the stone is seen, w × h its size in metres. */
  stone(bl: Vec3, br: Vec3, tr: Vec3, tl: Vec3, n: Vec3, w: number, h: number, salt: number): void {
    this.b.quad(bl, br, tr, tl, n, blockUvs(keyOf(bl, salt), w, h));
  }

  /** A box of stone in frame f: s0..s1 along it, y0..y1, d0..d1 out from
   * the wall. Faces as listed (the rest are against rock or hidden). */
  box(
    f: Frame,
    s0: number,
    s1: number,
    y0: number,
    y1: number,
    d0: number,
    d1: number,
    faces: { front?: boolean; left?: boolean; right?: boolean; top?: boolean; bottom?: boolean; back?: boolean },
    salt = 0,
  ): void {
    const p = (s: number, y: number, d: number) => at(f, s, y, d);
    const w = s1 - s0;
    const h = y1 - y0;
    const dd = d1 - d0;
    if (faces.front) this.stone(p(s0, y0, d1), p(s1, y0, d1), p(s1, y1, d1), p(s0, y1, d1), f.n, w, h, salt);
    if (faces.back) this.stone(p(s1, y0, d0), p(s0, y0, d0), p(s0, y1, d0), p(s1, y1, d0), neg(f.n), w, h, salt + 1);
    if (faces.left) this.stone(p(s0, y0, d0), p(s0, y0, d1), p(s0, y1, d1), p(s0, y1, d0), neg(f.r), dd, h, salt + 2);
    if (faces.right) this.stone(p(s1, y0, d1), p(s1, y0, d0), p(s1, y1, d0), p(s1, y1, d1), f.r, dd, h, salt + 3);
    if (faces.top) this.stone(p(s0, y1, d1), p(s1, y1, d1), p(s1, y1, d0), p(s0, y1, d0), UP, w, dd, salt + 4);
    if (faces.bottom) this.stone(p(s0, y0, d0), p(s1, y0, d0), p(s1, y0, d1), p(s0, y0, d1), DOWN, w, dd, salt + 5);
  }
}

// ── Pillars ──────────────────────────────────────────────────────────────────

const PILLAR_SIDES = 8;
const PLINTH_H = 0.42;
const BASE_STEP_H = 0.18;
const NECK_H = 0.16;
const ABACUS_H = 0.5;

function addPillar(sb: StoneBuilder, foot: Vec3): void {
  const B = ARCHITECTURE.pillarBase;
  const R = ARCHITECTURE.pillarRadius;
  const f: Frame = { o: [foot[0], 0, foot[2]], r: [1, 0, 0], n: [0, 0, 1] };
  const all = { front: true, back: true, left: true, right: true };
  // Plinth, a step, the octagonal shaft, a neck and a broad abacus.
  sb.box(f, -B, B, 0, PLINTH_H, -B, B, { ...all, top: true }, 11);
  const b2 = B * 0.84;
  sb.box(f, -b2, b2, PLINTH_H, PLINTH_H + BASE_STEP_H, -b2, b2, { ...all, top: true }, 13);
  const y0 = PLINTH_H + BASE_STEP_H;
  const y1 = H - ABACUS_H - NECK_H;
  sb.box(f, -b2, b2, y1, y1 + NECK_H, -b2, b2, { ...all, bottom: true }, 17);
  const b3 = B * 1.08;
  sb.box(f, -b3, b3, H - ABACUS_H, H, -b3, b3, { ...all, bottom: true }, 19);
  // The shaft: u is the arc length round it, so courses run level and the
  // drums' vertical joints wander round the pillar.
  const corner = (k: number): Vec3 => {
    const a = (k / PILLAR_SIDES) * Math.PI * 2 + Math.PI / PILLAR_SIDES;
    return [foot[0] + Math.cos(a) * R, 0, foot[2] - Math.sin(a) * R];
  };
  const faceW = 2 * R * Math.sin(Math.PI / PILLAR_SIDES);
  // Each pillar starts its drums at its own angle.
  const phase = (keyOf(foot, 23) % 97) / 97;
  for (let k = 0; k < PILLAR_SIDES; k++) {
    const c0 = corner(k);
    const c1 = corner(k + 1);
    const mid = (k + 0.5) / PILLAR_SIDES;
    const a = mid * Math.PI * 2 + Math.PI / PILLAR_SIDES;
    const n: Vec3 = [Math.cos(a), 0, -Math.sin(a)];
    // Going round, each face's left edge is the next one's right edge.
    const u0 = phase - ((k + 1) * faceW) / TRIM_SPAN;
    const u1 = phase - (k * faceW) / TRIM_SPAN;
    const v0 = y0 / TRIM_SPAN;
    const v1 = y1 / TRIM_SPAN;
    // Going from c1 to c0 is the outward face's "right".
    sb.b.quad([c1[0], y0, c1[2]], [c0[0], y0, c0[2]], [c0[0], y1, c0[2]], [c1[0], y1, c1[2]], n, [u0, v0, u1, v0, u1, v1, u0, v1]);
  }
}

// ── Ribs and their piers ─────────────────────────────────────────────────────

/** Rib shape for a span: where it springs and where its underside peaks.
 * The rise grows with the span (a wide hall gets a proper arch, a narrow
 * one a shallow segment) but the underside stays well above head height. */
export function ribProfile(span: number): { springY: number; crownY: number; rise: number } {
  const crownY = H - ARCHITECTURE.ribDepth;
  const rise = Math.min(2.8, Math.max(1.2, span * 0.25));
  return { springY: crownY - rise, crownY, rise };
}

/** Voussoirs per arch: about one per `size` metres of arc, odd so a
 * keystone sits at the crown. */
function voussoirCount(arc: number, size: number): number {
  const n = Math.max(5, Math.round(arc / size));
  return n % 2 ? n : n + 1;
}

function addRib(sb: StoneBuilder, rib: RibSpawn): void {
  const span = rib.to - rib.from;
  const mid = (rib.from + rib.to) / 2;
  const half = span / 2;
  const { springY, rise } = ribProfile(span);
  const R = (half * half + rise * rise) / (2 * rise);
  const cy = springY + rise - R;
  const th0 = Math.acos(Math.min(1, half / R));
  const W = ARCHITECTURE.ribWidth / 2;
  // Frame: s along the span, d across it (the rib's width).
  const f: Frame =
    rib.axis === "x"
      ? { o: [mid, 0, rib.at], r: [1, 0, 0], n: [0, 0, 1] }
      : { o: [rib.at, 0, mid], r: [0, 0, 1], n: [-1, 0, 0] };
  const N = voussoirCount(R * (Math.PI - 2 * th0), 0.5);
  const pt = (th: number, rad: number, d: number) => at(f, Math.cos(th) * rad, cy + Math.sin(th) * rad, d);
  for (let k = 0; k < N; k++) {
    const ta = th0 + ((Math.PI - 2 * th0) * k) / N;
    const tb = th0 + ((Math.PI - 2 * th0) * (k + 1)) / N;
    const tm = (ta + tb) / 2;
    // Alternate stones hang a little lower and a touch wider: the joints.
    const proud = k % 2 === 0 ? 0.05 : 0;
    const key = k === (N - 1) / 2 ? 0.04 : 0;
    const r = R - proud - key;
    const w = W + proud * 0.6;
    const n: Vec3 = add(add([0, 0, 0], f.r, -Math.cos(tm)), UP, -Math.sin(tm));
    const chord = 2 * r * Math.sin((tb - ta) / 2);
    sb.stone(pt(ta, r, -w), pt(ta, r, w), pt(tb, r, w), pt(tb, r, -w), n, 2 * w, chord, 31 + k);
    // Flanks: from the underside up to the vault.
    for (const side of [-1, 1]) {
      const fn = side > 0 ? f.n : neg(f.n);
      const a = pt(ta, r, side * w);
      const b = pt(tb, r, side * w);
      sb.world(a, b, [b[0], H, b[2]], [a[0], H, a[2]], fn);
    }
    // The step where a prouder stone meets its neighbour.
    for (const [th, dir] of [
      [ta, -1],
      [tb, 1],
    ] as const) {
      if (!proud && !key) continue;
      const tangent: Vec3 = add(add([0, 0, 0], f.r, -Math.sin(th) * dir), UP, Math.cos(th) * dir);
      sb.world(pt(th, r, -w), pt(th, R, -w), pt(th, R, w), pt(th, r, w), tangent);
    }
  }
  // Piers under both ends, each with a capital the rib springs from.
  for (const [face, inward] of [
    [rib.from, 1],
    [rib.to, -1],
  ] as const) {
    const wallF: Frame =
      rib.axis === "x"
        ? { o: [face, 0, rib.at], r: [0, 0, -inward], n: [inward, 0, 0] }
        : { o: [rib.at, 0, face], r: [inward, 0, 0], n: [0, 0, inward] };
    addPier(sb, wallF, springY);
  }
}

/** Split [y0, y1] into courses about half a metre tall. */
function courses(y0: number, y1: number): [number, number][] {
  const n = Math.max(1, Math.round((y1 - y0) / 0.5));
  const h = (y1 - y0) / n;
  return Array.from({ length: n }, (_, c) => [y0 + c * h, y0 + (c + 1) * h] as [number, number]);
}

/** An engaged pier against a wall (frame: s along the wall, d out from
 * it): a plinth, courses of quoins, and a capital at `top`. */
function addPier(sb: StoneBuilder, f: Frame, top: number): void {
  const hw = ARCHITECTURE.pierWidth / 2;
  const D = ARCHITECTURE.pierDepth;
  const sides = { front: true, left: true, right: true };
  sb.box(f, -hw - 0.06, hw + 0.06, 0, 0.36, 0, D + 0.07, { ...sides, top: true }, 41);
  const capY = top - 0.32;
  courses(0.36, capY).forEach(([y0, y1], c) => {
    const w = c % 2 ? hw - 0.05 : hw;
    const d = c % 2 ? D - 0.04 : D;
    sb.box(f, -w, w, y0, y1, 0, d, { ...sides, top: c % 2 === 0 }, 43 + c);
  });
  sb.box(f, -hw - 0.1, hw + 0.1, capY, top, 0, D + 0.12, { ...sides, top: true, bottom: true }, 61);
}

// ── Doorways ─────────────────────────────────────────────────────────────────

/** The arch over a doorway of width `w`: a semicircle over a one-tile door,
 * a segment over a two-tile one. */
export function doorArch(w: number): { springY: number; crownY: number; R: number; cy: number; th0: number } {
  const springY = ARCHITECTURE.doorSpring;
  const half = w / 2;
  const rise = Math.min(half, 1.3);
  const R = (half * half + rise * rise) / (2 * rise);
  const cy = springY + rise - R;
  return { springY, crownY: springY + rise, R, cy, th0: Math.acos(Math.min(1, half / R)) };
}

/** The doorway's own frame: s along the wall from the opening's middle, d
 * into the room from the wall face. */
function doorFrame(d: DoorwaySpawn): Frame {
  const mid = (d.from + d.to) / 2;
  return d.axis === "x"
    ? { o: [mid, 0, d.face], r: [1, 0, 0], n: [0, 0, d.inward] }
    : { o: [d.face, 0, mid], r: [0, 0, 1], n: [d.inward, 0, 0] };
}

function addDoorway(sb: StoneBuilder, d: DoorwaySpawn): void {
  const f = doorFrame(d);
  const half = (d.to - d.from) / 2;
  const J = ARCHITECTURE.jambWidth;
  const JD = ARCHITECTURE.jambDepth;
  const T = ARCHITECTURE.archRing;
  const HD = ARCHITECTURE.headerDepth;
  const { springY, R, cy, th0 } = doorArch(d.to - d.from);
  const all = { front: true, left: true, right: true };

  // Jambs: a plinth, quoins alternating long and short, an impost.
  for (const side of [-1, 1]) {
    // From the opening's edge outward by w, as [s0, s1].
    const span = (w: number): [number, number] => (side < 0 ? [-half - w, -half] : [half, half + w]);
    const [p0, p1] = span(J + 0.08);
    sb.box(f, p0, p1, 0, 0.32, 0, JD + 0.07, { ...all, top: true }, 71);
    courses(0.32, springY - 0.24).forEach(([y0, y1], c) => {
      const [s0, s1] = span(c % 2 ? J * 0.68 : J);
      sb.box(f, s0, s1, y0, y1, 0, c % 2 ? JD - 0.04 : JD, { ...all, top: c % 2 === 0 }, 73 + c);
    });
    const [i0, i1] = span(J + 0.12);
    sb.box(f, i0, i1, springY - 0.24, springY, 0, JD + 0.1, { ...all, top: true, bottom: true }, 89);
  }

  // The arch: voussoirs round a taller, prouder keystone.
  const N = voussoirCount(R * (Math.PI - 2 * th0), 0.46);
  const key = (N - 1) / 2;
  const depth = (k: number) => (k === key ? 0.36 : k % 2 ? 0.22 : 0.27);
  const outer = (k: number) => R + T + (k === key ? 0.14 : 0);
  const angle = (k: number) => th0 + ((Math.PI - 2 * th0) * k) / N;
  const pt = (th: number, rad: number, dd: number) => at(f, Math.cos(th) * rad, cy + Math.sin(th) * rad, dd);
  /** Unit tangent at `th`, toward larger angles, in world space. */
  const tangent = (th: number, sign: number): Vec3 => add(add([0, 0, 0], f.r, -Math.sin(th) * sign), UP, Math.cos(th) * sign);
  for (let k = 0; k < N; k++) {
    const ta = angle(k);
    const tb = angle(k + 1);
    const tm = (ta + tb) / 2;
    const dk = depth(k);
    const ro = outer(k);
    const chord = 2 * R * Math.sin((tb - ta) / 2);
    // Its face, standing proud of the wall.
    sb.stone(pt(ta, R, dk), pt(tb, R, dk), pt(tb, ro, dk), pt(ta, ro, dk), f.n, chord, ro - R, 101 + k);
    // Its soffit, carried on back through the header.
    const down: Vec3 = add(add([0, 0, 0], f.r, -Math.cos(tm)), UP, -Math.sin(tm));
    sb.stone(pt(ta, R, -HD), pt(ta, R, dk), pt(tb, R, dk), pt(tb, R, -HD), down, dk + HD, chord, 131 + k);
    // Its back, round the outside of the ring.
    sb.stone(pt(ta, ro, 0), pt(tb, ro, 0), pt(tb, ro, dk), pt(ta, ro, dk), neg(down), chord, dk, 161 + k);
  }
  // Joints: where one stone stands prouder (or taller) than its
  // neighbour, its side shows; the two springers show their feet.
  for (let b = 0; b <= N; b++) {
    const th = angle(b);
    const lo = b - 1;
    const hi = b;
    const dLo = lo >= 0 ? depth(lo) : 0;
    const dHi = hi < N ? depth(hi) : 0;
    const rLo = lo >= 0 ? outer(lo) : R;
    const rHi = hi < N ? outer(hi) : R;
    // The prouder stone, facing toward the other one.
    const [dP, dO, rP, rO, sign] = dLo >= dHi ? [dLo, dHi, rLo, rHi, 1] : [dHi, dLo, rHi, rLo, -1];
    const n = tangent(th, sign);
    if (dP > dO) sb.stone(pt(th, R, dO), pt(th, R, dP), pt(th, rP, dP), pt(th, rP, dO), n, dP - dO, rP - R, 191 + b);
    if (rP > rO && rO > R) sb.stone(pt(th, rO, 0), pt(th, rO, dO), pt(th, rP, dO), pt(th, rP, 0), n, dO, rP - rO, 211 + b);
  }

  // The header closing the slot above the arch, room side and corridor side.
  const strips = N * 2;
  for (let k = 0; k < strips; k++) {
    const ta = th0 + ((Math.PI - 2 * th0) * k) / strips;
    const tb = th0 + ((Math.PI - 2 * th0) * (k + 1)) / strips;
    for (const [dd, n] of [
      [0, f.n],
      [-HD, neg(f.n)],
    ] as const) {
      const a = pt(ta, R, dd);
      const b = pt(tb, R, dd);
      sb.world(a, b, [b[0], H, b[2]], [a[0], H, a[2]], n);
    }
  }
}

/** The header's collider: the slot above the arch's crown, so blasts and
 * high jumps meet stone where stone is drawn. */
export function doorwayCollider(d: DoorwaySpawn): WallBox {
  const { crownY } = doorArch(d.to - d.from);
  const y0 = crownY - 0.05;
  const HD = ARCHITECTURE.headerDepth;
  const mid = (d.from + d.to) / 2;
  const across = d.face - (d.inward * HD) / 2;
  const halfAlong = (d.to - d.from) / 2;
  const center: Vec3 = d.axis === "x" ? [mid, (y0 + H) / 2, across] : [across, (y0 + H) / 2, mid];
  const half: Vec3 = d.axis === "x" ? [halfAlong, (H - y0) / 2, HD / 2] : [HD / 2, (H - y0) / 2, halfAlong];
  return { center, half };
}

/** A pillar's collider: its base block, floor to vault. */
export function pillarCollider(foot: Vec3): WallBox {
  const B = ARCHITECTURE.pillarBase;
  return { center: [foot[0], H / 2, foot[2]], half: [B, H / 2, B] };
}

/** All the floor's dressed stone in one mesh. */
export function buildArchStone(arch: FloorArchitecture): MeshData {
  const sb = new StoneBuilder();
  for (const p of arch.pillars) addPillar(sb, p.pos);
  for (const rib of arch.ribs) addRib(sb, rib);
  for (const d of arch.doorways) addDoorway(sb, d);
  return sb.b.build();
}
