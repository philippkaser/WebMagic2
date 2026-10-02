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
 *  - `analyzeRoom` throws rays out from the listener and lets them bounce
 *    off the walls a few times (as Vercidium's raytraced audio does): how far
 *    they fly between walls is the room's size (its mean free path, and from
 *    it Sabine's reverb time), how many of the places they bounce can still
 *    see you is how much of the room's answer comes back, and the ones that
 *    fly off into the open (the sky, a hall longer than hearing) are lost.
 *    Where they bounced is kept: those points listen for sounds out of
 *    sight (see `hearing`);
 *  - `soundPath` finds how a sound reaches you: straight if nothing is in
 *    the way, else around the corners (a flood over the open cells, then
 *    pulled taut), so it seems to come from the doorway it came through,
 *    from as far away as it travelled — and how sharply it had to bend;
 *  - `hearing` turns that into one number, how clearly the sound gets
 *    through: 1 in plain sight, less the further round the corner it bent,
 *    a little more again where the listener's bounced rays can see it (a
 *    wide arch carries more than a crack), and almost nothing through rock;
 *  - the dungeon's rooms are **zones**: each rings with its own reverb,
 *    measured at its middle, and `zoneHearing` says how a room's ringing
 *    reaches a listener outside it — through the nearest way in, as clearly
 *    as a sound standing in that doorway would;
 *  - `impulseResponse` writes the room's reverb tail as a stereo impulse —
 *    noise whose lows hang on and whose highs die early, as stone rooms do. */

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
  /** Rooms that ring on their own (the dungeon's; none on the open green). */
  zones?: Zones;
}

/** The rooms of a grid, each with its own reverb. */
export interface Zones {
  /** The zone of each cell (-1: none — a corridor). */
  of: Int16Array;
  /** Each zone's open cells (cell indices). */
  cells: Int32Array[];
  /** Each zone's middle (x, z): where its reverb is measured. */
  centers: [number, number][];
}

/** How each depth band's stone sounds. The absorption is what a player
 * should hear, not what bare stone measures: it counts what lies about
 * (rubble, bones, crates, bodies) with the stone, so a mid-sized hall rings
 * for about a second — long enough to feel the size of the place, never so
 * long that a fight turns to mush. */
export const BIOME_SURFACES: Record<BiomeId, Surfaces> = {
  // Dry worked stone and bone dust.
  catacombs: { absorption: 0.25, brightness: 0.5 },
  // Wet stone and standing water: longer and bright.
  drowned: { absorption: 0.19, brightness: 0.7 },
  // Hot iron and slag: shorter, dark.
  forge: { absorption: 0.3, brightness: 0.4 },
  // Crystal: glassy, ringing.
  crystal: { absorption: 0.17, brightness: 0.85 },
  // The Hollow: vast and dark.
  hollow: { absorption: 0.16, brightness: 0.3 },
};

/** The village: timber and thatch under an open sky. */
export const VILLAGE_SURFACES: Surfaces = { absorption: 0.3, brightness: 0.6 };

export function gridFromLayout(layout: FloorLayout): AcousticGrid {
  const n = layout.size;
  const solid = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) solid[i] = layout.tiles[i] ? 0 : 1;
  const x0 = (-n / 2) * TILE;
  const z0 = (-n / 2) * TILE;
  // Every room the generator carved is a zone; the corridors between are not.
  const of = new Int16Array(n * n).fill(-1);
  const cells: Int32Array[] = [];
  const centers: [number, number][] = [];
  for (const r of layout.rooms) {
    const z = cells.length;
    const mine: number[] = [];
    for (let ty = r.y; ty < r.y + r.h; ty++)
      for (let tx = r.x; tx < r.x + r.w; tx++) {
        const k = ty * n + tx;
        if (tx < 0 || ty < 0 || tx >= n || ty >= n || solid[k] || of[k] !== -1) continue;
        of[k] = z;
        mine.push(k);
      }
    if (!mine.length) continue;
    cells.push(Int32Array.from(mine));
    centers.push([x0 + (r.x + r.w / 2) * TILE, z0 + (r.y + r.h / 2) * TILE]);
  }
  return {
    cell: TILE,
    size: n,
    x0,
    z0,
    solid,
    ceiling: WALL_HEIGHT,
    outside: "solid",
    surfaces: BIOME_SURFACES[layout.biome],
    zones: { of, cells, centers },
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

/** The zone (room) the world point (x, z) is in, or -1. */
export function zoneAt(g: AcousticGrid, x: number, z: number): number {
  if (!g.zones) return -1;
  const cx = Math.floor((x - g.x0) / g.cell);
  const cz = Math.floor((z - g.z0) / g.cell);
  if (!inGrid(g, cx, cz)) return -1;
  return g.zones.of[cz * g.size + cx]!;
}

/** (x, z) itself if it's open air, else the nearest point just inside an
 * open neighbouring cell — the camera brushing a wall, a torch on its
 * bracket, a cell the grace round a cottage marked solid. Null deep in rock.
 * (A ray started inside a solid cell sees nothing at all, so every query
 * goes through this first.) */
export function openPoint(g: AcousticGrid, x: number, z: number): [number, number] | null {
  const cx = Math.floor((x - g.x0) / g.cell);
  const cz = Math.floor((z - g.z0) / g.cell);
  if (!solidAt(g, cx, cz)) return [x, z];
  const m = g.cell * 0.02;
  let best: [number, number] | null = null;
  let bd = Infinity;
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (solidAt(g, nx, nz)) continue;
      const x0 = g.x0 + nx * g.cell;
      const z0 = g.z0 + nz * g.cell;
      const px = Math.min(x0 + g.cell - m, Math.max(x0 + m, x));
      const pz = Math.min(z0 + g.cell - m, Math.max(z0 + m, z));
      const d = Math.hypot(px - x, pz - z);
      if (d < bd) {
        bd = d;
        best = [px, pz];
      }
    }
  return best;
}

const inGrid = (g: AcousticGrid, cx: number, cz: number) => cx >= 0 && cz >= 0 && cx < g.size && cz < g.size;

/** Which way the last wall `traceRay` hit faces: 0 an x face (bounce flips
 * dx), 1 a z face (flips dz). */
let lastSide: 0 | 1 = 0;

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
      lastSide = 0;
    } else {
      cz += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      lastSide = 1;
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

export interface RoomAcoustics {
  /** Seconds for the reverb to fall 60 dB. */
  rt60: number;
  /** Seconds before the reverb tail begins. */
  preDelay: number;
  /** How much of the room's answer comes back to you (0 … 1): the share of
   * the rays' bounces that can still see you, less what flies off. */
  wet: number;
  /** Share of the sound that flies off and never returns (sky, far halls). */
  openness: number;
  /** Mean direction the lost rays flew off in (world x, z); its length (0…1)
   * is how one-sided the open air is. */
  escape: [number, number];
  /** The room's mean free path (m): its size, as sound sees it. */
  size: number;
  brightness: number;
  /** Where the rays bounced (x, z pairs) — the places that listen for you
   * for sounds out of sight (see `hearing`). */
  probes: Float32Array;
}

const SPEED_OF_SOUND = 343;
/** Rays per measurement, and the bounces each makes. */
const RAYS = 48;
const BOUNCES = 4;
/** Bounces per ray kept as probes. */
const PROBE_BOUNCES = 2;

/** Measure the space around (x, z): `rays` rays, each bouncing `bounces`
 * times off the walls (mirror-like) or flying off into the open past `max`. */
export function analyzeRoom(g: AcousticGrid, x: number, z: number, rays = RAYS, bounces = BOUNCES, max = 64): RoomAcoustics {
  const at = openPoint(g, x, z) ?? [x, z];
  const lx = at[0];
  const lz = at[1];
  const probes = new Float32Array(rays * PROBE_BOUNCES * 2);
  let np = 0;
  let segSum = 0;
  let segs = 0;
  let points = 0;
  let returns = 0;
  let lost = 0;
  let ex = 0;
  let ez = 0;
  for (let i = 0; i < rays; i++) {
    // Half a step off the axes, so no ray runs straight into a corner.
    const a = ((i + 0.5) / rays) * Math.PI * 2;
    let dx = Math.cos(a);
    let dz = Math.sin(a);
    let px = lx;
    let pz = lz;
    for (let b = 0; b < bounces; b++) {
      const t = traceRay(g, px, pz, dx, dz, max);
      if (!Number.isFinite(t)) {
        // Off into the open: what it carried never comes back. Escaping
        // straight away loses the most (the first answer of the room).
        const w = 1 / (b + 1);
        lost += w;
        ex += dx * w;
        ez += dz * w;
        break;
      }
      segSum += t;
      segs++;
      const hx = px + dx * t;
      const hz = pz + dz * t;
      if (lastSide === 0) dx = -dx;
      else dz = -dz;
      px = hx + dx * 1e-3;
      pz = hz + dz * 1e-3;
      points++;
      // The first bounce always sees you (it flew straight from you).
      if (b === 0 || lineOfSight(g, px, pz, lx, lz)) returns++;
      if (b < PROBE_BOUNCES) {
        probes[np++] = px;
        probes[np++] = pz;
      }
    }
  }
  const sky = !Number.isFinite(g.ceiling);
  const openness = Math.min(1, lost / rays);
  // The mean free path in plan (the mean flight between walls) is π·A/P for
  // a floor of area A and wall length P; with the vault, the room's own
  // 4V/S = 4·(A/P)·H / (2·A/P + H). Under the sky only the plan counts.
  const plan = segs ? segSum / segs : max;
  const ap = plan / Math.PI;
  const size = sky ? 4 * ap : (4 * ap * g.ceiling) / (2 * ap + g.ceiling);
  // Sabine (RT60 = 0.161·V / S·α = 0.04·mfp / α), the open share — and,
  // under the sky, the half of everything that goes straight up — counted as
  // perfectly absorbing.
  const a0 = g.surfaces.absorption;
  const open = Math.min(1, openness + (sky ? 0.5 : 0));
  const alpha = a0 + (1 - a0) * open;
  const rt60 = Math.min(2.4, Math.max(0.15, (0.04 * size) / alpha));
  const preDelay = Math.min(0.045, Math.max(0.005, size / SPEED_OF_SOUND));
  const returned = points ? returns / points : 0;
  const wet = Math.min(1, Math.max(0.03, (0.3 + 0.7 * returned) * (1 - openness) * (sky ? 0.45 : 1)));
  return {
    rt60,
    preDelay,
    wet,
    openness,
    escape: [ex / rays, ez / rays],
    size,
    brightness: g.surfaces.brightness,
    probes: probes.subarray(0, np),
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
  /** How far it bent round them, all told (radians). */
  bend: number;
  /** No way round (or too far round): heard only through the rock. */
  blocked: boolean;
}

/** Every way out from one cell: the cost (metres) to reach each open cell,
 * and the step it was reached from. Sounds all travel to the same ear, so
 * one flood from the listener's cell answers every source — rebuilt only
 * when the listener crosses into another cell. */
interface Flood {
  g: AcousticGrid;
  start: number;
  maxLength: number;
  cost: Float64Array;
  from: Int32Array;
}

let flood: Flood | null = null;

function floodFrom(g: AcousticGrid, start: number, maxLength: number): Flood {
  if (flood && flood.g === g && flood.start === start && flood.maxLength === maxLength) return flood;
  const n = g.size;
  const solid = g.solid;
  // (Float64, as the heap's keys: a float32 cost rounds a diagonal step
  // below the key it was pushed with, and the entry looks stale.)
  const cost = new Float64Array(n * n).fill(Infinity);
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

const cellOf = (g: AcousticGrid, x: number, z: number) => Math.floor((z - g.z0) / g.cell) * g.size + Math.floor((x - g.x0) / g.cell);

/** How a sound at (sx, sz) reaches a listener at (lx, lz), travelling at
 * most `maxLength` metres. */
export function soundPath(g: AcousticGrid, lx: number, lz: number, sx: number, sz: number, maxLength = 60): SoundPath {
  const direct = Math.hypot(sx - lx, sz - lz);
  const through: SoundPath = { length: direct, apparent: [sx, sz], corners: 0, bend: 0, blocked: true };
  const l = openPoint(g, lx, lz);
  const s = openPoint(g, sx, sz);
  if (!l || !s) return through;
  if (lineOfSight(g, l[0], l[1], s[0], s[1])) return { length: direct, apparent: [sx, sz], corners: 0, bend: 0, blocked: false };
  // Off the grid (open air past the village's edge) there are no cells to
  // flood: a sound out there comes over the top, as if round one corner.
  const lc = [Math.floor((l[0] - g.x0) / g.cell), Math.floor((l[1] - g.z0) / g.cell)] as const;
  const sc = [Math.floor((s[0] - g.x0) / g.cell), Math.floor((s[1] - g.z0) / g.cell)] as const;
  if (!inGrid(g, lc[0], lc[1]) || !inGrid(g, sc[0], sc[1])) return { ...through, corners: 1, bend: Math.PI / 2, blocked: false };
  const n = g.size;
  const f = floodFrom(g, cellOf(g, l[0], l[1]), maxLength);
  const gk = cellOf(g, s[0], s[1]);
  if (!Number.isFinite(f.cost[gk]!)) return through;
  // The cell path, listener → source, then pulled taut through the openings.
  const cells: [number, number][] = [];
  for (let k = gk; k !== -1; k = f.from[k]!) {
    const cx = k % n;
    cells.push([g.x0 + (cx + 0.5) * g.cell, g.z0 + ((k - cx) / n + 0.5) * g.cell]);
  }
  cells.reverse();
  cells[0] = l;
  cells[cells.length - 1] = s;
  const taut: [number, number][] = [l];
  let i = 0;
  while (i < cells.length - 1) {
    let j = cells.length - 1;
    while (j > i + 1 && !lineOfSight(g, cells[i]![0], cells[i]![1], cells[j]![0], cells[j]![1])) j--;
    taut.push(cells[j]!);
    i = j;
  }
  let length = 0;
  let bend = 0;
  for (let k = 1; k < taut.length; k++) {
    const ax = taut[k]![0] - taut[k - 1]![0];
    const az = taut[k]![1] - taut[k - 1]![1];
    length += Math.hypot(ax, az);
    if (k + 1 < taut.length) {
      const bx = taut[k + 1]![0] - taut[k]![0];
      const bz = taut[k + 1]![1] - taut[k]![1];
      bend += Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
    }
  }
  if (length > maxLength) return through;
  const first = taut[1]!;
  const fd = Math.hypot(first[0] - lx, first[1] - lz) || 1;
  return {
    length,
    apparent: [lx + ((first[0] - lx) / fd) * length, lz + ((first[1] - lz) / fd) * length],
    corners: taut.length - 2,
    bend,
    blocked: false,
  };
}

export interface Hearing {
  /** Metres the sound travels to reach you. */
  length: number;
  /** Where it seems to come from (x, z). */
  apparent: [number, number];
  /** How clearly it gets through: 1 in plain sight … 0, a thud through rock. */
  clarity: number;
  /** No way round: heard only through the rock. */
  blocked: boolean;
}

/** Share of the probes (x, z pairs) with a clear line to (sx, sz). */
export function visibleShare(g: AcousticGrid, probes: Float32Array, sx: number, sz: number): number {
  const n = probes.length / 2;
  if (!n) return 0;
  const s = openPoint(g, sx, sz);
  if (!s) return 0;
  let seen = 0;
  for (let i = 0; i < n; i++) if (lineOfSight(g, probes[i * 2]!, probes[i * 2 + 1]!, s[0], s[1])) seen++;
  return seen / n;
}

/** How a sound at (sx, sz) is heard by a listener at (lx, lz) in `room`.
 *
 * Out of sight, a sound loses its highs the further round the corners it
 * bends (edge diffraction: a quarter turn leaves it at under half clarity),
 * but the room you're in may still catch it: if many of the places your
 * rays bounced can see it, it's coming in through something wide, off the
 * walls as well as round the edge. */
export function hearing(g: AcousticGrid, room: RoomAcoustics | null, lx: number, lz: number, sx: number, sz: number, maxLength = 60): Hearing {
  const p = soundPath(g, lx, lz, sx, sz, maxLength);
  if (!p.blocked && p.corners === 0) return { length: p.length, apparent: p.apparent, clarity: 1, blocked: false };
  const seen = room ? visibleShare(g, room.probes, sx, sz) : 0;
  const around = p.blocked ? 0 : 0.85 * Math.exp(-p.bend / 2.2);
  // It gets through round the corner, or by the walls the rays found — or
  // both: the clearer of the two, and some more for the other.
  const clarity = 1 - (1 - around) * (1 - 0.5 * Math.sqrt(seen));
  return { length: p.length, apparent: p.apparent, clarity, blocked: p.blocked };
}

/** How room `zone`'s ringing reaches a listener at (lx, lz): from inside it,
 * all round you; from outside, as a sound standing in the nearest way in
 * would — from that doorway, as clearly as the way to it allows, from as far
 * away as it is. */
export function zoneHearing(g: AcousticGrid, room: RoomAcoustics | null, lx: number, lz: number, zone: number, maxLength = 60): Hearing {
  const zs = g.zones;
  const cells = zs?.cells[zone];
  const none: Hearing = { length: Infinity, apparent: [lx, lz], clarity: 0, blocked: true };
  if (!zs || !cells) return none;
  if (zoneAt(g, lx, lz) === zone) return { length: 0, apparent: [lx, lz], clarity: 1, blocked: false };
  const l = openPoint(g, lx, lz);
  if (!l) return none;
  const f = floodFrom(g, cellOf(g, l[0], l[1]), maxLength);
  let best = -1;
  let bc = Infinity;
  for (const k of cells) {
    if (f.cost[k]! < bc) {
      bc = f.cost[k]!;
      best = k;
    }
  }
  if (best < 0) return none;
  const cx = best % g.size;
  const cz = (best - cx) / g.size;
  return hearing(g, room, lx, lz, g.x0 + (cx + 0.5) * g.cell, g.z0 + (cz + 0.5) * g.cell, maxLength);
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

/** A stereo impulse response: `preDelay` of silence, then a diffuse tail
 * falling 60 dB over `rt60` seconds — split in three bands that each decay
 * at their own rate (the lows a little longer, the highs much sooner, and
 * sooner still in a dark room), each side its own noise so the tail is wide.
 * The echoes thicken in over the first few tens of milliseconds.
 *
 * Normalized to unit energy per side: the reverb is exactly as loud as the
 * send into it, whatever the room — the send and return set the level. */
export function impulseResponse(
  sampleRate: number,
  rt60: number,
  brightness: number,
  preDelay: number,
  seed = 1,
): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const len = Math.max(1, Math.ceil((preDelay + rt60) * sampleRate));
  const out: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(len), new Float32Array(len)];
  const start = Math.floor(preDelay * sampleRate);
  // One-pole crossovers (low < 350 Hz < mid < 3.2 kHz < high).
  const aLow = Math.exp((-2 * Math.PI * 350) / sampleRate);
  const aMid = Math.exp((-2 * Math.PI * 3200) / sampleRate);
  // Per-sample decay of each band (60 dB = ln 1000 = 6.91 nepers).
  const kLow = Math.exp(-6.91 / (rt60 * 1.15 * sampleRate));
  const kMid = Math.exp(-6.91 / (rt60 * sampleRate));
  const kHigh = Math.exp(-6.91 / (rt60 * (0.3 + 0.45 * brightness) * sampleRate));
  const build = 0.02 + Math.min(0.03, rt60 * 0.02);
  for (let ch = 0; ch < 2; ch++) {
    const rand = mulberry(seed * 7919 + ch * 104729);
    const buf = out[ch]!;
    let low = 0;
    let lowMid = 0;
    let eLow = 1;
    let eMid = 1;
    let eHigh = 1;
    let energy = 0;
    for (let i = start; i < len; i++) {
      // Roughly Gaussian (sum of two uniforms): smoother than flat noise.
      const x = rand() + rand() - 1;
      low = (1 - aLow) * x + aLow * low;
      lowMid = (1 - aMid) * x + aMid * lowMid;
      const t = (i - start) / sampleRate;
      const swell = t < build ? Math.sin((t / build) * Math.PI * 0.5) ** 2 : 1;
      const v = (low * eLow + (lowMid - low) * eMid + (x - lowMid) * eHigh) * swell;
      buf[i] = v;
      energy += v * v;
      eLow *= kLow;
      eMid *= kMid;
      eHigh *= kHigh;
    }
    const g = energy > 0 ? 1 / Math.sqrt(energy) : 0;
    for (let i = start; i < len; i++) buf[i]! *= g;
  }
  return out;
}
