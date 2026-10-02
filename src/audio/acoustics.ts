import { TILE, WALL_HEIGHT } from "../core/config";
import { COTTAGES } from "../scenes/village/layout";
import type { BiomeId, FloorLayout } from "../world/types";

/** Sound, traced through the place you're in. Pure (no WebAudio) and tested.
 *
 * The world is an acoustic grid — the dungeon's own tiles (walls run floor
 * to vault, so a plan view is the whole story), or the village's cottages on
 * open ground under the sky. On it:
 *
 *  - `traceRay` walks a ray cell by cell (Amanatides–Woo) to the first wall;
 *  - `analyzeRoom` fans rays out from the listener to measure the space —
 *    its floor area, walls, ceiling and how open it is — and from that its
 *    reverberation (Sabine: RT60 = 0.161 V / S·α), the reverb's level and
 *    pre-delay, and the nearest wall in each direction (early reflections);
 *  - `soundPath` finds how a sound reaches you: straight if nothing is in
 *    the way, else around the corners (A* over the open cells, then pulled
 *    taut), so it seems to come from the doorway it came through, from as
 *    far away as it travelled, muffled by every corner it bent round;
 *  - `impulseResponse` writes the room's reverb tail as a stereo impulse —
 *    decaying noise that darkens as it fades, as stone rooms do. */

export interface Surfaces {
  /** Mean absorption of the room's surfaces (Sabine α, 0…1). */
  absorption: number;
  /** How much top end the reflections keep (0 dull … 1 bright). */
  brightness: number;
}

export interface AcousticGrid {
  /** Metres per cell. */
  cell: number;
  /** Cells per side. */
  size: number;
  /** World x, z of the grid's corner. */
  x0: number;
  z0: number;
  /** 1 = sound can't pass (rock, a wall, a cottage). */
  solid: Uint8Array;
  /** Ceiling above the floor, m (Infinity: open sky). */
  ceiling: number;
  /** What lies past the grid's edge. */
  outside: "solid" | "open";
  surfaces: Surfaces;
}

/** How each depth band's stone sounds. Absorption counts what lies about
 * (rubble, bones, crates, bodies) as well as the stone, so the halls ring
 * long but never wash a fight out. */
export const BIOME_SURFACES: Record<BiomeId, Surfaces> = {
  // Dry worked stone and bone dust.
  catacombs: { absorption: 0.1, brightness: 0.55 },
  // Wet stone and standing water: long and bright.
  drowned: { absorption: 0.065, brightness: 0.75 },
  // Hot iron and slag: shorter, dark.
  forge: { absorption: 0.12, brightness: 0.45 },
  // Crystal: glassy, ringing.
  crystal: { absorption: 0.05, brightness: 0.95 },
  // The Hollow: vast and dark.
  hollow: { absorption: 0.055, brightness: 0.35 },
};

/** The village: timber and thatch under an open sky. */
export const VILLAGE_SURFACES: Surfaces = { absorption: 0.14, brightness: 0.6 };

export function gridFromLayout(layout: FloorLayout): AcousticGrid {
  const n = layout.size;
  const solid = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) solid[i] = layout.tiles[i] ? 0 : 1;
  return {
    cell: TILE,
    size: n,
    x0: (-n / 2) * TILE,
    z0: (-n / 2) * TILE,
    solid,
    ceiling: WALL_HEIGHT,
    outside: "solid",
    surfaces: BIOME_SURFACES[layout.biome],
  };
}

const VILLAGE_HALF = 48;
/** Village cells: 2 m, like a dungeon tile — sound needn't know the green
 * finer than that, and the path flood (see soundPath) stays cheap. */
const VILLAGE_CELL = 2;

/** The village green as 2 m cells: the cottages (their footprints as the
 * map draws them, a cell solid when the walls cover its middle) are solid;
 * the rest is open ground under the sky, and past the edge the air goes on.
 * (The well is too small to stop a sound.) */
export function villageGrid(): AcousticGrid {
  const size = (VILLAGE_HALF * 2) / VILLAGE_CELL;
  const solid = new Uint8Array(size * size);
  const mark = (inside: (x: number, z: number) => boolean) => {
    for (let cz = 0; cz < size; cz++)
      for (let cx = 0; cx < size; cx++) {
        const x = (cx + 0.5) * VILLAGE_CELL - VILLAGE_HALF;
        const z = (cz + 0.5) * VILLAGE_CELL - VILLAGE_HALF;
        if (inside(x, z)) solid[cz * size + cx] = 1;
      }
  };
  for (const c of COTTAGES) {
    const cos = Math.cos(c.rot);
    const sin = Math.sin(c.rot);
    // A little grace, so a small cottage still fills the cells it stands in.
    const hx = c.size / 2 + 0.4;
    const hz = (c.size * 0.8) / 2 + 0.4;
    mark((x, z) => {
      const dx = x - c.pos[0];
      const dz = z - c.pos[2];
      // Into the cottage's own frame (its yaw undone).
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      return Math.abs(lx) <= hx && Math.abs(lz) <= hz;
    });
  }
  return {
    cell: VILLAGE_CELL,
    size,
    x0: -VILLAGE_HALF,
    z0: -VILLAGE_HALF,
    solid,
    ceiling: Infinity,
    outside: "open",
    surfaces: VILLAGE_SURFACES,
  };
}

function solidAt(g: AcousticGrid, cx: number, cz: number): boolean {
  if (cx < 0 || cz < 0 || cx >= g.size || cz >= g.size) return g.outside === "solid";
  return g.solid[cz * g.size + cx] === 1;
}

/** Whether the world point (x, z) is open air rather than rock or a wall. */
export function openAt(g: AcousticGrid, x: number, z: number): boolean {
  return !solidAt(g, Math.floor((x - g.x0) / g.cell), Math.floor((z - g.z0) / g.cell));
}

const inGrid = (g: AcousticGrid, cx: number, cz: number) => cx >= 0 && cz >= 0 && cx < g.size && cz < g.size;

/** Metres along the unit direction (dx, dz) from (x, z) to the first solid
 * cell — or Infinity if the ray runs out into open air or past `max`. */
export function traceRay(g: AcousticGrid, x: number, z: number, dx: number, dz: number, max: number): number {
  let cx = Math.floor((x - g.x0) / g.cell);
  let cz = Math.floor((z - g.z0) / g.cell);
  if (solidAt(g, cx, cz)) return 0;
  const stepX = dx > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const ax = Math.abs(dx);
  const az = Math.abs(dz);
  let tMaxX = ax > 1e-9 ? ((cx + (stepX > 0 ? 1 : 0)) * g.cell + g.x0 - x) / dx : Infinity;
  let tMaxZ = az > 1e-9 ? ((cz + (stepZ > 0 ? 1 : 0)) * g.cell + g.z0 - z) / dz : Infinity;
  const tDeltaX = ax > 1e-9 ? g.cell / ax : Infinity;
  const tDeltaZ = az > 1e-9 ? g.cell / az : Infinity;
  for (;;) {
    let t: number;
    if (tMaxX < tMaxZ) {
      cx += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
    } else {
      cz += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
    }
    if (t > max) return Infinity;
    if (!inGrid(g, cx, cz)) return g.outside === "solid" ? t : Infinity;
    if (g.solid[cz * g.size + cx]) return t;
  }
}

/** Whether nothing solid lies between two points. */
export function lineOfSight(g: AcousticGrid, ax: number, az: number, bx: number, bz: number): boolean {
  const d = Math.hypot(bx - ax, bz - az);
  if (d < 1e-6) return true;
  return traceRay(g, ax, az, (bx - ax) / d, (bz - az) / d, d) >= d - 1e-6;
}

// ── The room around the listener ─────────────────────────────────────────────

export interface Reflection {
  /** World direction of the wall (atan2(dz, dx)). */
  angle: number;
  /** Metres to it. */
  dist: number;
}

export interface RoomAcoustics {
  /** Seconds for the reverb to fall 60 dB. */
  rt60: number;
  /** Seconds before the reverb tail begins. */
  preDelay: number;
  /** How much of a sound comes back as reverb (0 dry … 1). */
  wet: number;
  /** Share of the space that opens onto nothing (sky, far halls). */
  openness: number;
  /** Floor area the rays found, m². */
  area: number;
  /** The nearest wall in each of eight directions (early reflections). */
  reflections: Reflection[];
  /** Metres from the ear down to the floor, and up to the ceiling (null: sky). */
  floor: number;
  ceiling: number | null;
  brightness: number;
}

const SPEED_OF_SOUND = 343;

/** Measure the space around (x, z) with a fan of `rays`. */
export function analyzeRoom(g: AcousticGrid, x: number, z: number, earHeight = 1.6, rays = 48, max = 48): RoomAcoustics {
  const d: number[] = [];
  let escaped = 0;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const t = traceRay(g, x, z, Math.cos(a), Math.sin(a), max);
    if (!Number.isFinite(t)) escaped++;
    d.push(t);
  }
  // The floor plan as a polygon of the ray hits (escaped rays count at max).
  const step = (Math.PI * 2) / rays;
  let area = 0;
  let perimeter = 0;
  for (let i = 0; i < rays; i++) {
    const r0 = Math.min(d[i]!, max);
    const r1 = Math.min(d[(i + 1) % rays]!, max);
    area += 0.5 * r0 * r1 * Math.sin(step);
    if (Number.isFinite(d[i]!) && Number.isFinite(d[(i + 1) % rays]!)) perimeter += Math.sqrt(r0 * r0 + r1 * r1 - 2 * r0 * r1 * Math.cos(step));
  }
  const sky = !Number.isFinite(g.ceiling);
  const height = sky ? 12 : g.ceiling;
  const volume = area * height;
  const surface = 2 * area + perimeter * height;
  // Sound that escapes (to the sky, down a long hall) never comes back:
  // count the open share as perfectly absorbing.
  const openness = Math.min(1, escaped / rays + (sky ? 0.5 : 0));
  const alpha = g.surfaces.absorption + (1 - g.surfaces.absorption) * openness;
  const rt60 = Math.min(4.5, Math.max(0.15, (0.161 * volume) / Math.max(1, surface * alpha)));
  const meanFree = (4 * volume) / Math.max(1, surface);
  const preDelay = Math.min(0.08, Math.max(0.005, meanFree / SPEED_OF_SOUND));
  const wet = Math.min(0.7, Math.max(0.04, (1 - openness) * (0.18 + 0.42 * Math.min(1, rt60 / 3.5))));
  // Early reflections: the nearest wall in each eighth of the circle.
  const reflections: Reflection[] = [];
  const per = rays / 8;
  for (let s = 0; s < 8; s++) {
    let best = Infinity;
    let at = 0;
    for (let k = 0; k < per; k++) {
      const i = Math.floor(s * per + k) % rays;
      if (d[i]! < best) {
        best = d[i]!;
        at = i;
      }
    }
    if (best < 30) reflections.push({ angle: at * step, dist: best });
  }
  return {
    rt60,
    preDelay,
    wet,
    openness,
    area,
    reflections,
    floor: earHeight,
    ceiling: sky ? null : Math.max(0.5, g.ceiling - earHeight),
    brightness: g.surfaces.brightness,
  };
}

// ── How a sound reaches the listener ────────────────────────────────────────

export interface SoundPath {
  /** Metres the sound travels to reach you. */
  length: number;
  /** Where it seems to come from: as far away as it travelled, in the
   * direction of the last opening it came through. */
  apparent: [number, number];
  /** Corners it bent round on the way. */
  corners: number;
  /** No way round (or too far round): heard only through the rock. */
  blocked: boolean;
}

/** The open cell nearest (x, z) — a torch hangs on a wall, a sound may start
 * a hair inside one. */
function openCell(g: AcousticGrid, x: number, z: number): [number, number] | null {
  const cx = Math.floor((x - g.x0) / g.cell);
  const cz = Math.floor((z - g.z0) / g.cell);
  if (!solidAt(g, cx, cz)) return [cx, cz];
  let best: [number, number] | null = null;
  let bd = Infinity;
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (solidAt(g, nx, nz)) continue;
      const d = Math.hypot(g.x0 + (nx + 0.5) * g.cell - x, g.z0 + (nz + 0.5) * g.cell - z);
      if (d < bd) {
        bd = d;
        best = [nx, nz];
      }
    }
  return best;
}


/** Every way out from one cell: the cost (metres) to reach each open cell,
 * and the step it was reached from. Sounds all travel to the same ear, so
 * one flood from the listener's cell answers every source — rebuilt only
 * when the listener crosses into another cell. */
interface Flood {
  g: AcousticGrid;
  start: number;
  maxLength: number;
  cost: Float32Array;
  from: Int32Array;
}

let flood: Flood | null = null;

function floodFrom(g: AcousticGrid, start: number, maxLength: number): Flood {
  if (flood && flood.g === g && flood.start === start && flood.maxLength === maxLength) return flood;
  const n = g.size;
  const solid = g.solid;
  const cost = new Float32Array(n * n).fill(Infinity);
  const from = new Int32Array(n * n).fill(-1);
  // Dijkstra on a binary heap of (cost, cell); stale entries are skipped.
  // Each cell is pushed at most once per improvement — 8 per cell bounds it.
  const hc = new Float64Array(n * n * 4 + 8);
  const hk = new Int32Array(n * n * 4 + 8);
  let len = 0;
  const push = (c: number, k: number) => {
    if (len === hc.length) return; // (never, in practice)
    let i = len++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hc[p]! <= c) break;
      hc[i] = hc[p]!;
      hk[i] = hk[p]!;
      i = p;
    }
    hc[i] = c;
    hk[i] = k;
  };
  const diag = Math.SQRT2 * g.cell;
  cost[start] = 0;
  push(0, start);
  while (len) {
    const c = hc[0]!;
    const k = hk[0]!;
    // Pop: sift the last entry down from the root.
    const lc = hc[--len]!;
    const lk = hk[len]!;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      if (l >= len) break;
      const m = l + 1 < len && hc[l + 1]! < hc[l]! ? l + 1 : l;
      if (hc[m]! >= lc) break;
      hc[i] = hc[m]!;
      hk[i] = hk[m]!;
      i = m;
    }
    hc[i] = lc;
    hk[i] = lk;
    if (c > cost[k]! || c > maxLength) continue;
    const cx = k % n;
    const cz = (k - cx) / n;
    const w = cx > 0, e = cx < n - 1, nn = cz > 0, s = cz < n - 1;
    const sw = w && !solid[k - 1];
    const se = e && !solid[k + 1];
    const sn = nn && !solid[k - n];
    const ss = s && !solid[k + n];
    const step = g.cell;
    if (sw && c + step < cost[k - 1]!) { cost[k - 1] = c + step; from[k - 1] = k; push(c + step, k - 1); }
    if (se && c + step < cost[k + 1]!) { cost[k + 1] = c + step; from[k + 1] = k; push(c + step, k + 1); }
    if (sn && c + step < cost[k - n]!) { cost[k - n] = c + step; from[k - n] = k; push(c + step, k - n); }
    if (ss && c + step < cost[k + n]!) { cost[k + n] = c + step; from[k + n] = k; push(c + step, k + n); }
    // Diagonals only between two open sides (no cutting a corner).
    const cd = c + diag;
    if (sw && sn && !solid[k - n - 1] && cd < cost[k - n - 1]!) { cost[k - n - 1] = cd; from[k - n - 1] = k; push(cd, k - n - 1); }
    if (se && sn && !solid[k - n + 1] && cd < cost[k - n + 1]!) { cost[k - n + 1] = cd; from[k - n + 1] = k; push(cd, k - n + 1); }
    if (sw && ss && !solid[k + n - 1] && cd < cost[k + n - 1]!) { cost[k + n - 1] = cd; from[k + n - 1] = k; push(cd, k + n - 1); }
    if (se && ss && !solid[k + n + 1] && cd < cost[k + n + 1]!) { cost[k + n + 1] = cd; from[k + n + 1] = k; push(cd, k + n + 1); }
  }
  flood = { g, start, maxLength, cost, from };
  return flood;
}

/** How a sound at (sx, sz) reaches a listener at (lx, lz), travelling at
 * most `maxLength` metres. */
export function soundPath(g: AcousticGrid, lx: number, lz: number, sx: number, sz: number, maxLength = 60): SoundPath {
  const direct = Math.hypot(sx - lx, sz - lz);
  if (lineOfSight(g, lx, lz, sx, sz)) return { length: direct, apparent: [sx, sz], corners: 0, blocked: false };
  const through: SoundPath = { length: direct, apparent: [sx, sz], corners: 0, blocked: true };
  const start = openCell(g, lx, lz);
  const goal = openCell(g, sx, sz);
  if (!start || !goal) return through;
  const n = g.size;
  const f = floodFrom(g, start[1] * n + start[0], maxLength);
  const gk = goal[1] * n + goal[0];
  if (!Number.isFinite(f.cost[gk]!)) return through;
  // The cell path, listener → source, then pulled taut through the openings.
  const cells: [number, number][] = [];
  for (let k = gk; k !== -1; k = f.from[k]!) {
    const cx = k % n;
    cells.push([g.x0 + (cx + 0.5) * g.cell, g.z0 + ((k - cx) / n + 0.5) * g.cell]);
  }
  cells.reverse();
  cells[0] = [lx, lz];
  cells[cells.length - 1] = [sx, sz];
  const taut: [number, number][] = [[lx, lz]];
  let i = 0;
  while (i < cells.length - 1) {
    let j = cells.length - 1;
    while (j > i + 1 && !lineOfSight(g, cells[i]![0], cells[i]![1], cells[j]![0], cells[j]![1])) j--;
    taut.push(cells[j]!);
    i = j;
  }
  let length = 0;
  for (let k = 1; k < taut.length; k++) length += Math.hypot(taut[k]![0] - taut[k - 1]![0], taut[k]![1] - taut[k - 1]![1]);
  if (length > maxLength) return through;
  const first = taut[1]!;
  const fd = Math.hypot(first[0] - lx, first[1] - lz) || 1;
  return {
    length,
    apparent: [lx + ((first[0] - lx) / fd) * length, lz + ((first[1] - lz) / fd) * length],
    corners: taut.length - 2,
    blocked: false,
  };
}

// ── The reverb tail ─────────────────────────────────────────────────────────

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stereo impulse response: `preDelay` of silence, then noise falling
 * 60 dB over `rt60` seconds, its top end fading faster than its body (the
 * tail darkens toward a few hundred hertz — brighter rooms keep more), each
 * side its own noise so the tail is wide. */
export function impulseResponse(
  sampleRate: number,
  rt60: number,
  brightness: number,
  preDelay: number,
  seed = 1,
): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const len = Math.max(1, Math.ceil((preDelay + rt60 * 1.1) * sampleRate));
  const out: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(len), new Float32Array(len)];
  const start = Math.floor(preDelay * sampleRate);
  const fc0 = 1800 + 9000 * brightness;
  const fcEnd = 250 + 400 * brightness;
  const k = Math.log(fc0 / fcEnd) / Math.max(0.05, rt60);
  for (let ch = 0; ch < 2; ch++) {
    const rand = mulberry(seed * 7919 + ch * 104729);
    const buf = out[ch]!;
    let lp = 0;
    for (let i = start; i < len; i++) {
      const t = (i - start) / sampleRate;
      const fc = fc0 * Math.exp(-k * t);
      const a = Math.exp((-2 * Math.PI * fc) / sampleRate);
      lp = (1 - a) * (rand() * 2 - 1) + a * lp;
      // A short fade-in: the direct sound and the early reflections are
      // played separately; the tail swells in under them.
      const swell = Math.min(1, t / 0.012);
      buf[i] = lp * Math.exp((-6.9 * t) / rt60) * swell;
    }
  }
  // (The ConvolverNode normalizes its level: rooms differ in length and
  // colour, the reverb send sets how much of it you hear.)
  return out;
}
