import { ARCHITECTURE, TILE } from "../../core/config";
import { Rng } from "../../core/rng";
import type {
  BiomeId,
  CrystalSpawn,
  EnemySpawn,
  FloorArchitecture,
  LightShaftSpawn,
  LoreSpawn,
  PillarSpawn,
  PropSpawn,
  Rect,
  RibSpawn,
  TrapSpawn,
  Vec3,
} from "../types";
import { type Grid, SOLID, dist2World, worldToTile } from "./grid";
import type { Pois } from "./pois";
import { STREAM_SALT, streamSeed } from "./seeds";

/** Stage 8 — architecture: what turns a carved box into a hall. Arch ribs
 * spanning each room under the vault on piers, colonnades in the big
 * rooms, shafts of light falling from cracks in the vault, and — in the
 * Crystal Deep — glowing crystal clusters in the corners.
 *
 * For now only the SHAFTS render (scenes/DungeonFloor.tsx): the dungeon is
 * kept to its basic painted look, so ribs, pillars and crystals are planned
 * (and tested) but drawn nowhere and collide with nothing, ready to return.
 *
 * Runs LAST, on its own stream, reading only finished layout data: adding or
 * retuning architecture can never move a room, prop, enemy, trap or rune.
 * Everything here is a pure function of (seed, floor) like the rest of the
 * layout, so floor-mates see the same columns and collide with them alike.
 *
 * Rhythm: ribs and pillar pairs share the same lines, 4 m apart and offset
 * 2 m from the room's centre, so the centre of every room — where spawns,
 * portals, the treasure and the Warden stand — stays open, and each pair
 * of pillars sits under a rib like a real arcade. */

export interface ArchitectureInput {
  grid: Grid;
  seed: number;
  floor: number;
  biome: BiomeId;
  rooms: Rect[];
  pois: Pois;
  torches: Vec3[];
  lore: LoreSpawn[];
  props: PropSpawn[];
  enemies: EnemySpawn[];
  traps: TrapSpawn[];
  /** The omen's torch multiplier: a floor robbed of light gets no shafts. */
  lightMult: number;
}

/** Pillars only in rooms at least this big on BOTH axes (tiles). */
export const PILLAR_MIN_ROOM = 7;
/** Pillar rows stand this many tiles in from the long walls. */
const PILLAR_INSET_TILES = 2;
/** Pillars keep at least this far (m) from the end walls of their room. */
const PILLAR_END_CLEARANCE = 3;
/** Ribs keep at least this far (m) from the end walls. */
const RIB_END_CLEARANCE = 2;

/** Horizontal clearances (m) from a pillar's centre. Landmarks get room to
 * breathe (and to walk round); spawned bodies just must not start inside
 * the collider (base half-size 0.52 + their own ~0.45). */
export const PILLAR_CLEARANCE = {
  spawn: 3.5,
  portal: 4,
  treasure: 3,
  lore: 2.5,
  torch: 2,
  prop: 1,
  enemy: 1.2,
  trap: 1.3,
} as const;

/** A pier (and its rib) keeps this far (m, along the wall) from torches and
 * lore runes mounted on the same wall. */
const PIER_WALL_CLEARANCE = 1.1;

/** Light shafts per floor: at least one, sometimes more on big floors. */
const SHAFT_MAX = 3;
/** Shafts keep off portals (their own glow) and ribs (a shaft pouring
 * through a rib would have nowhere to come from). */
const SHAFT_PORTAL_CLEARANCE = 3;
const SHAFT_RIB_CLEARANCE = 1.1;
const SHAFT_PILLAR_CLEARANCE = 2;

/** Crystal clusters per room and per floor (each is a pooled light). */
const CRYSTALS_PER_ROOM = 3;
const CRYSTAL_CAP = 14;
/** How far (m) a cluster sits from its corner tile's centre toward the
 * corner, so it grows out of the rock rather than out of the floor. */
const CRYSTAL_CORNER_PUSH = 0.35;

export function planArchitecture(input: ArchitectureInput): FloorArchitecture {
  const rng = new Rng(streamSeed(input.seed, input.floor, STREAM_SALT.architecture));
  const ribs: RibSpawn[] = [];
  const pillars: PillarSpawn[] = [];
  for (const room of input.rooms) {
    const plan = roomPlan(input, room);
    ribs.push(...plan.ribs);
    pillars.push(...plan.pillars);
  }
  const shafts = placeShafts(rng, input, ribs, pillars);
  const crystals = input.biome === "crystal" ? placeCrystals(rng, input) : [];
  return { pillars, ribs, shafts, crystals };
}

// ── Room geometry ────────────────────────────────────────────────────────────

/** A room in world terms: its walls' coordinates and which way it runs. */
interface RoomFrame {
  room: Rect;
  /** The axis ribs span (the room's SHORT axis). */
  span: "x" | "z";
  /** Wall faces on the span axis (m). */
  spanMin: number;
  spanMax: number;
  /** Wall faces on the long axis (m). */
  longMin: number;
  longMax: number;
  /** Room size in tiles along each. */
  spanTiles: number;
  longTiles: number;
}

export function roomFrame(room: Rect, size: number): RoomFrame {
  const x0 = (room.x - size / 2) * TILE;
  const x1 = (room.x + room.w - size / 2) * TILE;
  const z0 = (room.y - size / 2) * TILE;
  const z1 = (room.y + room.h - size / 2) * TILE;
  // Ribs cross the short way, like the transverse arches of a nave.
  if (room.w <= room.h) {
    return { room, span: "x", spanMin: x0, spanMax: x1, longMin: z0, longMax: z1, spanTiles: room.w, longTiles: room.h };
  }
  return { room, span: "z", spanMin: z0, spanMax: z1, longMin: x0, longMax: x1, spanTiles: room.h, longTiles: room.w };
}

/** Positions along the long axis for ribs/pillar pairs: centre ± 2 m, then
 * every 4 m outward, within `clearance` of the end walls. */
export function bayLines(frame: RoomFrame, clearance: number): number[] {
  const c = (frame.longMin + frame.longMax) / 2;
  const half = (frame.longMax - frame.longMin) / 2 - clearance;
  const lines: number[] = [];
  const step = ARCHITECTURE.ribSpacing;
  for (let d = step / 2; d <= half + 1e-6; d += step) lines.push(c - d, c + d);
  return lines.sort((a, b) => a - b);
}

/** World point from (span-axis coordinate, long-axis coordinate). */
function point(frame: RoomFrame, s: number, l: number): Vec3 {
  return frame.span === "x" ? [s, 0, l] : [l, 0, s];
}

function roomPlan(input: ArchitectureInput, room: Rect): { ribs: RibSpawn[]; pillars: PillarSpawn[] } {
  const { grid } = input;
  const frame = roomFrame(room, grid.size);
  const ribs: RibSpawn[] = [];
  for (const at of bayLines(frame, RIB_END_CLEARANCE)) {
    if (!pierFits(input, frame, at, frame.spanMin, -1) || !pierFits(input, frame, at, frame.spanMax, 1)) continue;
    ribs.push({ axis: frame.span, at, from: frame.spanMin, to: frame.spanMax });
  }

  const pillars: PillarSpawn[] = [];
  const bossArena = input.pois.isBossFloor && room === input.pois.exitRoom;
  if (room.w >= PILLAR_MIN_ROOM && room.h >= PILLAR_MIN_ROOM && !bossArena) {
    // Two rows, PILLAR_INSET_TILES in from the long walls (tile centres).
    const inset = (PILLAR_INSET_TILES + 0.5) * TILE;
    const rows = [frame.spanMin + inset, frame.spanMax - inset];
    for (const at of bayLines(frame, PILLAR_END_CLEARANCE)) {
      const pair = rows.map((s) => point(frame, s, at));
      // Pairs stand or fall together: an arcade missing one leg looks like
      // a mistake, not a ruin.
      if (pair.every((p) => pillarFits(input, p))) pillars.push(...pair.map((pos) => ({ pos })));
    }
  }
  return { ribs, pillars };
}

/** Can a pier stand against the wall face at span coordinate `face` (side
 * −1 = the min wall, +1 = the max wall) on long-axis line `at`? The rock
 * behind must be solid across the pier's whole width (no doorway), and no
 * torch or lore rune may hang on that stretch of wall. */
function pierFits(input: ArchitectureInput, frame: RoomFrame, at: number, face: number, side: -1 | 1): boolean {
  const { grid } = input;
  const half = ARCHITECTURE.pierWidth / 2 + 0.1;
  // A point just inside the rock behind the face.
  const behind = face + side * 0.5;
  for (const l of [at - half, at, at + half]) {
    const [tx, ty] = worldToTile(point(frame, behind, l), grid.size);
    if (grid.at(tx, ty) !== SOLID) return false;
  }
  const onThisWall = (p: Vec3) => {
    const s = frame.span === "x" ? p[0] : p[2];
    const l = frame.span === "x" ? p[2] : p[0];
    return Math.abs(s - face) < 1 && Math.abs(l - at) < PIER_WALL_CLEARANCE;
  };
  if (input.torches.some(onThisWall)) return false;
  if (input.lore.some((r) => onThisWall(r.pos))) return false;
  return true;
}

function pillarFits(input: ArchitectureInput, p: Vec3): boolean {
  const { pois } = input;
  const c = PILLAR_CLEARANCE;
  const far = (q: Vec3, d: number) => dist2World(p, q) >= d * d;
  if (!far(pois.spawn, c.spawn)) return false;
  if (!far(pois.exit, c.portal) || !far(pois.leave, c.portal)) return false;
  if (!far(pois.treasure, c.treasure)) return false;
  if (!input.lore.every((r) => far(r.pos, c.lore))) return false;
  if (!input.torches.every((t) => far(t, c.torch))) return false;
  if (!input.props.every((q) => far(q.pos, c.prop))) return false;
  if (!input.enemies.every((q) => far(q.pos, c.enemy))) return false;
  if (!input.traps.every((q) => far(q.pos, c.trap))) return false;
  // Belt and braces: the footprint must stand on open floor.
  const [tx, ty] = worldToTile(p, input.grid.size);
  return input.grid.isFloor(tx, ty);
}

// ── Light shafts ─────────────────────────────────────────────────────────────

function placeShafts(rng: Rng, input: ArchitectureInput, ribs: RibSpawn[], pillars: PillarSpawn[]): LightShaftSpawn[] {
  // A floor the omen robbed of light keeps the vault sealed too.
  if (input.lightMult < 1) return [];
  const { pois, grid } = input;
  const target = Math.min(SHAFT_MAX, 1 + (rng.chance(0.6) ? 1 : 0) + (input.rooms.length >= 10 && rng.chance(0.4) ? 1 : 0));

  const clear = (p: Vec3, radius: number) => {
    const [tx, ty] = worldToTile(p, grid.size);
    if (!grid.isFloor(tx, ty)) return false;
    if (dist2World(p, pois.exit) < SHAFT_PORTAL_CLEARANCE ** 2) return false;
    if (dist2World(p, pois.leave) < SHAFT_PORTAL_CLEARANCE ** 2) return false;
    if (pillars.some((q) => dist2World(p, q.pos) < SHAFT_PILLAR_CLEARANCE ** 2)) return false;
    const topRadius = radius * 0.45;
    return !ribs.some((r) => {
      const s = r.axis === "x" ? p[0] : p[2];
      const l = r.axis === "x" ? p[2] : p[0];
      return s > r.from && s < r.to && Math.abs(l - r.at) < SHAFT_RIB_CLEARANCE + topRadius;
    });
  };

  const shafts: LightShaftSpawn[] = [];
  const used = new Set<Rect>();
  // The first shaft usually finds the treasure: loot in a pool of light is
  // the dungeon's oldest lure.
  if (rng.chance(0.7)) {
    const radius = rng.range(1.1, 1.5);
    const pos: Vec3 = [pois.treasure[0], 0, pois.treasure[2]];
    if (clear(pos, radius)) {
      shafts.push({ pos, radius });
      used.add(pois.treasureRoom);
    }
  }
  for (const room of rng.shuffle([...input.rooms])) {
    if (shafts.length >= target) break;
    if (used.has(room)) continue;
    const frame = roomFrame(room, grid.size);
    const c = (frame.longMin + frame.longMax) / 2;
    const cs = (frame.spanMin + frame.spanMax) / 2;
    // Between the ribs: on the centre line or a whole bay out, a little
    // off-axis so it doesn't look placed with a ruler.
    const l = c + rng.pick([0, 0, -ARCHITECTURE.ribSpacing, ARCHITECTURE.ribSpacing]);
    const s = cs + rng.range(-1, 1);
    const radius = rng.range(1.1, 1.7);
    const pos = point(frame, s, l);
    if (l <= frame.longMin + radius || l >= frame.longMax - radius) continue;
    if (!clear(pos, radius)) continue;
    shafts.push({ pos, radius });
    used.add(room);
  }
  return shafts;
}

// ── Crystal clusters ─────────────────────────────────────────────────────────

function placeCrystals(rng: Rng, input: ArchitectureInput): CrystalSpawn[] {
  const { grid, pois } = input;
  const crystals: CrystalSpawn[] = [];
  const landmarks = [pois.spawn, pois.exit, pois.leave, pois.treasure];
  for (const room of input.rooms) {
    if (crystals.length >= CRYSTAL_CAP) break;
    const corners: { tile: [number, number]; out: [number, number] }[] = [
      { tile: [room.x, room.y], out: [-1, -1] },
      { tile: [room.x + room.w - 1, room.y], out: [1, -1] },
      { tile: [room.x, room.y + room.h - 1], out: [-1, 1] },
      { tile: [room.x + room.w - 1, room.y + room.h - 1], out: [1, 1] },
    ];
    const cx = (room.x + room.w / 2 - grid.size / 2) * TILE;
    const cz = (room.y + room.h / 2 - grid.size / 2) * TILE;
    const hue: 0 | 1 = rng.chance(0.5) ? 0 : 1;
    let placed = 0;
    for (const { tile, out } of rng.shuffle(corners)) {
      if (placed >= CRYSTALS_PER_ROOM || crystals.length >= CRYSTAL_CAP) break;
      const [x, y] = tile;
      // A true corner: rock on both outward sides and diagonally. A corner
      // tile boxed in like that is a dead end, so a cluster there can never
      // block a path.
      if (!grid.isFloor(x, y)) continue;
      if (grid.at(x + out[0], y) !== SOLID || grid.at(x, y + out[1]) !== SOLID) continue;
      if (grid.at(x + out[0], y + out[1]) !== SOLID) continue;
      const wx = (x + 0.5 - grid.size / 2) * TILE + out[0] * CRYSTAL_CORNER_PUSH;
      const wz = (y + 0.5 - grid.size / 2) * TILE + out[1] * CRYSTAL_CORNER_PUSH;
      const pos: Vec3 = [wx, 0, wz];
      const far = (q: Vec3, d: number) => dist2World(pos, q) >= d * d;
      if (!landmarks.every((q) => far(q, 3))) continue;
      if (!input.torches.every((t) => far(t, 2))) continue;
      if (!input.lore.every((r) => far(r.pos, 2))) continue;
      if (!input.props.every((q) => far(q.pos, 1.2))) continue;
      if (!input.enemies.every((q) => far(q.pos, 1.2))) continue;
      if (!input.traps.every((q) => far(q.pos, 1.3))) continue;
      crystals.push({
        pos,
        // Lean out of the corner, toward the room.
        facing: Math.atan2(cx - wx, cz - wz),
        scale: rng.range(0.8, 1.3),
        hue: rng.chance(0.75) ? hue : ((1 - hue) as 0 | 1),
      });
      placed++;
    }
  }
  return crystals;
}
