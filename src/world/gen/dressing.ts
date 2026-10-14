import { ARCHITECTURE, TILE, WALL_HEIGHT } from "../../core/config";
import { Rng } from "../../core/rng";
import { ROOM_EVENT_RULES } from "../../roomEvents/catalog";
import { DRESSING, type DecorDef, type DecorMount, getDecorDef } from "../decor";
import type {
  BiomeId,
  DecorSpawn,
  DoorwaySpawn,
  EnemySpawn,
  FloorArchitecture,
  LoreSpawn,
  PropSpawn,
  Rect,
  RoomEventSpawn,
  TrapSpawn,
  Vec3,
} from "../types";
import { doorwayLocal, frameExtent, inDoorLane, leafExtent, touchesDoorway } from "./doorways";
import { type Grid, SOLID, dist2World, toWorld } from "./grid";
import type { Pois } from "./pois";
import { STREAM_SALT, streamSeed } from "./seeds";

/** Stage 10 — dressing: what the centuries left lying about. Skulls and
 * bones in the corners, candle clusters, chains and bone chimes hanging
 * from the vault, webs in the upper corners, the Founders' banners gone to
 * rags, iron grates, fallen masonry, wall niches with urns — and each band's
 * own: barnacles and kelp below the tide line, anvils, braziers and slag in
 * the Forge, crystal spurs in the Deep, pale roots in the Hollow (the table
 * is world/decor.ts).
 *
 * Runs LAST, on its own stream, reading only finished layout data — rooms,
 * landmarks, torches, runes, props, enemies, traps and the architecture —
 * so dressing a floor can never move anything that matters. The same
 * (seed, floor) always dresses the same, so floor-mates see the same skull
 * in the same corner.
 *
 * Nothing snags a wizard: decor stands in true corners (dead ends), within
 * half a metre of a wall, on the walls, under the vault (bottoms well above
 * a jump), or lies flat. It keeps off the spawn sigil, the portals, the
 * treasure and the Warden's arena floor, off the lanes through doorways,
 * and clear of traps (a grate must never be mistaken for a pressure plate). */

export interface DressingInput {
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
  architecture: FloorArchitecture;
  /** Vaults, ward circles, shrines, fountains: decor keeps out of their way
   * (a ward's whole ring). */
  events: RoomEventSpawn[];
  /** The omen's torch multiplier: a lightless floor has fewer candles too. */
  lightMult: number;
}

/** How much floor a room event keeps clear round its centre (m): a ward
 * its whole ring of stones and a step beyond, the rest a little apron. */
function eventClearance(e: RoomEventSpawn): number {
  return e.kind === "ward" ? ROOM_EVENT_RULES.wardRadius + 0.7 : 1.9;
}

/** Floor decor keeps these distances (m, between centres, plus its own
 * radius) from the landmarks. The spawn's is the arrival sigil's. */
export const DECOR_CLEARANCE = {
  spawn: 2.6,
  portal: 2.9,
  treasure: 1.9,
  boss: 3.6,
  /** From trap plates, beyond the decor's own radius. */
  trap: 1.3,
  /** From props and enemies as they spawn, beyond the decor's radius. */
  body: 0.55,
  /** How far into a room a doorway's lane runs. */
  doorLane: 2.6,
} as const;

/** Hanging decor never reaches lower than this (m): above a wizard's
 * head even mid-jump. */
export const HANG_FLOOR = 3.3;

/** How far a corner piece sits from each of its corner's walls (m). */
const CORNER_INSET = 0.55;
/** Each attempt at a piece tries this many spots before giving up. */
const ATTEMPTS_PER_PIECE = 3;

/** Walls a room edge tile can stand against: the step toward the wall and
 * the yaw that faces back into the room (as lorePlacement). */
const WALLS: readonly { dx: number; dy: number; yaw: number }[] = [
  { dx: 0, dy: -1, yaw: 0 },
  { dx: 0, dy: 1, yaw: Math.PI },
  { dx: -1, dy: 0, yaw: Math.PI / 2 },
  { dx: 1, dy: 0, yaw: -Math.PI / 2 },
];

/** A stretch of wall face: which axis it runs along, where its face is,
 * and which way the room lies. */
interface WallRef {
  axis: "x" | "z";
  face: number;
  inward: 1 | -1;
  /** Centre of the tile's face along the wall. */
  along: number;
  yaw: number;
}

interface Spot {
  mount: DecorMount;
  /** Floor point (corner/floor/ceiling spots) — tile centre or pushed in. */
  pos: Vec3;
  yaw: number;
  wall?: WallRef;
  /** Corner key: each corner holds one floor piece and one web. */
  key?: string;
}

type RoomSpots = Record<DecorMount, Spot[]>;

export function planDressing(input: DressingInput): DecorSpawn[] {
  const rng = new Rng(streamSeed(input.seed, input.floor, STREAM_SALT.dressing));
  const ctx = new Context(input);
  const spots = new Map(input.rooms.map((r) => [r, roomSpots(input.grid, r)] as const));
  const placed: DecorSpawn[] = [];

  for (const recipe of DRESSING[input.biome]) {
    const def = getDecorDef(recipe.kind);
    const chance = recipe.kind === "candles" ? recipe.chance * Math.min(1, input.lightMult) : recipe.chance;
    let count = 0;
    for (const room of rng.shuffle([...input.rooms])) {
      if (count >= recipe.cap) break;
      if (!rng.chance(chance)) continue;
      const want = rng.int(1, recipe.perRoom);
      const roomSpots = spots.get(room)!;
      let got = 0;
      for (let attempt = 0; attempt < want * ATTEMPTS_PER_PIECE && got < want && count < recipe.cap; attempt++) {
        // A fixed number of draws per attempt, whatever happens next.
        const mount = rng.pick(def.mounts);
        const pick = rng.next();
        const j1 = rng.range(-1, 1);
        const j2 = rng.range(-1, 1);
        const turn = rng.range(-1, 1);
        const scale = rng.range(def.scale[0], def.scale[1]);
        const variant = rng.int(0, def.variants - 1);
        const list = roomSpots[mount];
        if (list.length === 0) continue;
        const spot = list[Math.floor(pick * list.length)];
        const decor = realize(def, spot, j1, j2, turn, scale, variant);
        if (!ctx.fits(def, spot, decor, room)) continue;
        ctx.claim(def, spot, decor);
        placed.push(decor);
        got++;
        count++;
      }
    }
  }
  return placed;
}

// ── Spots ────────────────────────────────────────────────────────────────────

/** Every place in a room decor could go, in a fixed order. */
function roomSpots(grid: Grid, room: Rect): RoomSpots {
  const out: RoomSpots = { corner: [], wallBase: [], floor: [], wall: [], upperCorner: [], ceiling: [] };
  const { size } = grid;
  const x1 = room.x + room.w - 1;
  const y1 = room.y + room.h - 1;

  // True corners: rock on both outward sides and diagonally — a dead end
  // that can never be a way through.
  for (const [x, y, ox, oy] of [
    [room.x, room.y, -1, -1],
    [x1, room.y, 1, -1],
    [room.x, y1, -1, 1],
    [x1, y1, 1, 1],
  ] as const) {
    if (!grid.isFloor(x, y)) continue;
    if (grid.at(x + ox, y) !== SOLID || grid.at(x, y + oy) !== SOLID || grid.at(x + ox, y + oy) !== SOLID) continue;
    const [cx, , cz] = toWorld(x, y, size);
    const push = TILE / 2 - CORNER_INSET;
    const yaw = Math.atan2(-ox, -oy);
    out.corner.push({ mount: "corner", pos: [cx + ox * push, 0, cz + oy * push], yaw, key: `c${x},${y}` });
    out.upperCorner.push({
      mount: "upperCorner",
      pos: [cx + (ox * TILE) / 2, WALL_HEIGHT, cz + (oy * TILE) / 2],
      yaw,
      key: `u${x},${y}`,
    });
  }

  // Room edges (corners excluded) with rock behind: the foot of the wall
  // and the wall face itself.
  for (const { dx, dy, yaw } of WALLS) {
    const tiles: [number, number][] = [];
    if (dy !== 0) for (let x = room.x + 1; x < x1; x++) tiles.push([x, dy < 0 ? room.y : y1]);
    else for (let y = room.y + 1; y < y1; y++) tiles.push([dx < 0 ? room.x : x1, y]);
    for (const [x, y] of tiles) {
      if (!grid.isFloor(x, y) || grid.at(x + dx, y + dy) !== SOLID) continue;
      const [cx, , cz] = toWorld(x, y, size);
      const axis = dy !== 0 ? "x" : "z";
      const wall: WallRef = {
        axis,
        face: axis === "x" ? cz + (dy * TILE) / 2 : cx + (dx * TILE) / 2,
        inward: (axis === "x" ? -dy : -dx) as 1 | -1,
        along: axis === "x" ? cx : cz,
        yaw,
      };
      out.wallBase.push({ mount: "wallBase", pos: [cx, 0, cz], yaw, wall });
      out.wall.push({ mount: "wall", pos: [cx, 0, cz], yaw, wall });
    }
  }

  // The open middle: flat floor decor and the vault above it.
  for (let y = room.y + 1; y < y1; y++) {
    for (let x = room.x + 1; x < x1; x++) {
      if (!grid.isFloor(x, y)) continue;
      const [cx, , cz] = toWorld(x, y, size);
      out.floor.push({ mount: "floor", pos: [cx, 0, cz], yaw: 0 });
      out.ceiling.push({ mount: "ceiling", pos: [cx, WALL_HEIGHT, cz], yaw: 0 });
    }
  }
  return out;
}

/** Point on a wall: `along` it, `into` the room from its face. */
function wallPoint(w: WallRef, along: number, y: number, into: number): Vec3 {
  const across = w.face + w.inward * into;
  return w.axis === "x" ? [along, y, across] : [across, y, along];
}

/** Turn a spot and a handful of rolls into a placed piece. */
function realize(def: DecorDef, spot: Spot, j1: number, j2: number, turn: number, scale: number, variant: number): DecorSpawn {
  const base = { kind: def.kind, scale, variant };
  const r = def.radius * scale;
  switch (spot.mount) {
    case "corner":
      return { ...base, pos: [spot.pos[0] + j1 * 0.08, 0, spot.pos[2] + j2 * 0.08], yaw: spot.yaw + turn * 0.6 };
    case "wallBase": {
      const w = spot.wall!;
      return { ...base, pos: wallPoint(w, w.along + j1 * 0.45, 0, r * 0.8 + 0.1), yaw: w.yaw + turn * 0.6 };
    }
    case "wall": {
      const w = spot.wall!;
      return { ...base, pos: wallPoint(w, w.along + j1 * 0.3, 0, 0), yaw: w.yaw };
    }
    case "upperCorner":
      return { ...base, pos: [...spot.pos] as Vec3, yaw: spot.yaw };
    case "floor":
      return { ...base, pos: [spot.pos[0] + j1 * 0.45, 0, spot.pos[2] + j2 * 0.45], yaw: turn * Math.PI };
    case "ceiling":
      return { ...base, pos: [spot.pos[0] + j1 * 0.6, WALL_HEIGHT, spot.pos[2] + j2 * 0.6], yaw: turn * Math.PI };
  }
}

// ── What a piece must keep clear of ──────────────────────────────────────────

interface Pier {
  axis: "x" | "z";
  face: number;
  along: number;
}

class Context {
  private readonly piers: Pier[];
  private readonly claimed = new Set<string>();
  private readonly ground: { p: Vec3; r: number }[] = [];
  private readonly onWalls: { axis: "x" | "z"; face: number; lo: number; hi: number }[] = [];
  private readonly hanging: Vec3[] = [];
  private readonly arena: Rect | null;

  constructor(private readonly input: DressingInput) {
    // Piers stand under both ends of every rib, on the walls the rib
    // springs from (a rib spanning x rests on walls running along z).
    this.piers = input.architecture.ribs.flatMap((rib) => {
      const axis = rib.axis === "x" ? ("z" as const) : ("x" as const);
      return [rib.from, rib.to].map((face) => ({ axis, face, along: rib.at }));
    });
    this.arena = input.pois.isBossFloor ? input.pois.exitRoom : null;
  }

  claim(def: DecorDef, spot: Spot, d: DecorSpawn): void {
    if (spot.key) this.claimed.add(spot.key);
    const m = spot.mount;
    if (m === "corner" || m === "wallBase" || m === "floor") this.ground.push({ p: d.pos, r: def.radius * d.scale });
    if (m === "wall") {
      const w = spot.wall!;
      const along = w.axis === "x" ? d.pos[0] : d.pos[2];
      const hw = def.wall!.halfWidth * d.scale;
      this.onWalls.push({ axis: w.axis, face: w.face, lo: along - hw, hi: along + hw });
    }
    if (m === "ceiling") this.hanging.push(d.pos);
  }

  fits(def: DecorDef, spot: Spot, d: DecorSpawn, room: Rect): boolean {
    if (spot.key && this.claimed.has(spot.key)) return false;
    const { input } = this;
    const { grid } = input;
    switch (spot.mount) {
      case "corner":
      case "wallBase":
      case "floor":
        return this.groundFits(def, spot, d, room);
      case "wall":
        return this.wallFits(def, spot, d);
      case "upperCorner": {
        // Webs keep off torches, door frames and rib piers on either wall
        // of their corner.
        const reach = 1.25 * d.scale + 0.35;
        if (!input.torches.every((t) => dist2World(t, d.pos) > (reach + 0.3) ** 2)) return false;
        for (const dw of input.architecture.doorways) {
          const { along, into } = doorwayLocal(dw, d.pos);
          const [lo, hi] = frameExtent(dw);
          if (Math.abs(into) < 0.05 && along > lo - reach && along < hi + reach) return false;
        }
        return this.piers.every((q) => {
          const along = q.axis === "x" ? d.pos[0] : d.pos[2];
          const across = q.axis === "x" ? d.pos[2] : d.pos[0];
          return Math.abs(across - q.face) > 0.05 || Math.abs(q.along - along) > reach + ARCHITECTURE.ribWidth;
        });
      }
      case "ceiling": {
        const bottom = WALL_HEIGHT - (def.hang ?? 0) * d.scale;
        if (bottom < HANG_FLOOR) return false;
        const [tx, ty] = [Math.floor(d.pos[0] / TILE + grid.size / 2), Math.floor(d.pos[2] / TILE + grid.size / 2)];
        if (!grid.isFloor(tx, ty)) return false;
        return this.hangFits(d);
      }
    }
  }

  private groundFits(def: DecorDef, spot: Spot, d: DecorSpawn, room: Rect): boolean {
    const { input } = this;
    const { pois, architecture } = input;
    const r = def.radius * d.scale;
    const p = d.pos;
    const far = (q: Vec3, dist: number) => dist2World(p, q) >= dist * dist;
    const c = DECOR_CLEARANCE;
    // The tile under it must be open floor.
    const tx = Math.floor(p[0] / TILE + input.grid.size / 2);
    const ty = Math.floor(p[2] / TILE + input.grid.size / 2);
    if (!input.grid.isFloor(tx, ty)) return false;
    if (room === this.arena && (spot.mount === "floor" || def.collider)) return false;
    // (The exit's rift is the floor's one way out — home or down.)
    if (!far(pois.spawn, c.spawn + r) || !far(pois.exit, c.portal + r)) return false;
    if (!far(pois.treasure, c.treasure + r)) return false;
    if (pois.boss && !far(pois.boss, c.boss + r)) return false;
    if (!input.events.every((e) => far(e.pos, eventClearance(e) + r))) return false;
    if (!input.traps.every((t) => far(t.pos, c.trap + r))) return false;
    const body = c.body + r + (def.collider ? 0.45 : 0);
    if (!input.props.every((q) => far(q.pos, body)) || !input.enemies.every((q) => far(q.pos, body))) return false;
    if (!architecture.pillars.every((q) => far(q.pos, ARCHITECTURE.pillarBase + r + 0.15))) return false;
    if (!architecture.crystals.every((q) => far(q.pos, 1.5 + r))) return false;
    if (!this.ground.every((g) => far(g.p, g.r + r + 0.25))) return false;
    for (const dw of architecture.doorways) {
      // Out of the lane through every doorway (flat pieces may lie in it).
      if (spot.mount !== "floor" && inDoorLane(dw, p, c.doorLane, 0.45 + r)) return false;
      if (nearDoorFixtures(dw, p, r)) return false;
    }
    // At the foot of a wall: clear of the piers standing on it.
    if (spot.wall) {
      const w = spot.wall;
      const along = w.axis === "x" ? p[0] : p[2];
      const pierHalf = ARCHITECTURE.pierWidth / 2 + 0.1;
      if (this.piers.some((q) => q.axis === w.axis && Math.abs(q.face - w.face) < 0.01 && Math.abs(q.along - along) < pierHalf + r + 0.05))
        return false;
    } else if (spot.mount === "corner") {
      // A corner's two walls may carry piers too, a rib-spacing in from it.
      const pierHalf = ARCHITECTURE.pierWidth / 2 + 0.1;
      for (const q of this.piers) {
        const along = q.axis === "x" ? p[0] : p[2];
        const across = q.axis === "x" ? p[2] : p[0];
        if (Math.abs(across - q.face) < CORNER_INSET + r + 0.3 && Math.abs(q.along - along) < pierHalf + r + 0.05) return false;
      }
    }
    return true;
  }

  private wallFits(def: DecorDef, spot: Spot, d: DecorSpawn): boolean {
    const { input } = this;
    const w = spot.wall!;
    const hw = def.wall!.halfWidth * d.scale;
    const along = w.axis === "x" ? d.pos[0] : d.pos[2];
    const lo = along - hw;
    const hi = along + hw;
    // Fixtures on the same wall, by along-wall distance.
    const sameWall = (p: Vec3) => {
      const across = w.axis === "x" ? p[2] : p[0];
      return Math.abs(across - w.face) < 1.05;
    };
    const alongOf = (p: Vec3) => (w.axis === "x" ? p[0] : p[2]);
    // A torch's flame licks up past 3 m: banners keep well off it.
    const torchGap = def.wall!.y1 > 3 ? 1.05 : 0.6;
    if (input.torches.some((t) => sameWall(t) && Math.abs(alongOf(t) - along) < hw + torchGap)) return false;
    if (input.lore.some((rune) => sameWall(rune.pos) && Math.abs(alongOf(rune.pos) - along) < hw + 0.65)) return false;
    const pierHalf = ARCHITECTURE.pierWidth / 2 + 0.1;
    if (this.piers.some((q) => q.axis === w.axis && Math.abs(q.face - w.face) < 0.01 && Math.abs(q.along - along) < pierHalf + hw + 0.1))
      return false;
    if (input.architecture.doorways.some((dw) => touchesDoorway(dw, w.axis, w.face, lo, hi, 0.2))) return false;
    if (this.onWalls.some((o) => o.axis === w.axis && Math.abs(o.face - w.face) < 0.01 && lo < o.hi + 0.6 && hi > o.lo - 0.6))
      return false;
    // Nothing hung behind a portal or the treasure (they read best clean).
    const front = wallPoint(w, along, 0, 1);
    const { pois } = input;
    for (const q of [pois.exit, pois.treasure]) if (dist2World(front, q) < 2.4 * 2.4) return false;
    return true;
  }

  private hangFits(d: DecorSpawn): boolean {
    const { input } = this;
    const { pois, architecture } = input;
    const p = d.pos;
    const far = (q: Vec3, dist: number) => dist2World(p, q) >= dist * dist;
    if (!far(pois.exit, 2.6) || !far(pois.treasure, 1.6)) return false;
    if (pois.boss && !far(pois.boss, 3)) return false;
    if (!architecture.pillars.every((q) => far(q.pos, 1.1))) return false;
    if (!architecture.shafts.every((s) => far(s.pos, s.radius + 0.35))) return false;
    for (const rib of architecture.ribs) {
      const s = rib.axis === "x" ? p[0] : p[2];
      const l = rib.axis === "x" ? p[2] : p[0];
      if (s > rib.from && s < rib.to && Math.abs(l - rib.at) < ARCHITECTURE.ribWidth / 2 + 0.55) return false;
    }
    return this.hanging.every((q) => far(q, 1.5));
  }
}

/** Would a floor piece at `p` (radius r) bump a doorway's frame or the
 * broken door leaning beside it? */
function nearDoorFixtures(d: DoorwaySpawn, p: Vec3, r: number): boolean {
  const { along, into } = doorwayLocal(d, p);
  if (into < -0.01) return false;
  // Jambs and their plinths stand ~0.3 m proud.
  const reach = ARCHITECTURE.jambWidth + 0.1;
  if (into < ARCHITECTURE.jambDepth + 0.12 + r && along > d.from - reach - r && along < d.to + reach + r) return true;
  const leaf = leafExtent(d);
  return !!leaf && into < 0.9 + r && along > leaf[0] - r - 0.1 && along < leaf[1] + r + 0.1;
}
