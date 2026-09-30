import { TILE, WALL_HEIGHT } from "../../core/config";
import { Rng } from "../../core/rng";
import type { DecorDensity } from "../biomes";
import type { DecorItem, DecorKind, FloorLayout, Rect, Vec3 } from "../types";
import { FLOOR, edgeToWorld, toWorld, worldToTile } from "./grid";

/** Set-dressing pass. Pure and deterministic like the rest of generation,
 * but on its own RNG stream so dressing never shifts gameplay placements.
 * Only *where* things go is decided here; what they look like is the
 * biome's business (world/decor). Solid pieces (pillars, braziers) keep
 * clear of every gameplay spot and never sit in a narrow passage. */

export interface RoomRoles {
  spawnRoom: Rect;
  exitRoom: Rect;
  treasureRoom: Rect;
}

type Dir = [number, number];
const CARDINALS: Dir[] = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

export function placeDecor(base: Omit<FloorLayout, "decor">, roles: RoomRoles, d: DecorDensity): DecorItem[] {
  const { size, tiles, rooms, seed, floor } = base;
  const rng = new Rng((seed ^ Math.imul(floor + 17, 0x2c1b3c6d) ^ 0xdec0de) >>> 0);
  const out: DecorItem[] = [];
  const add = (kind: DecorKind, pos: Vec3, rot = 0, scale: Vec3 = [1, 1, 1]) => out.push({ kind, pos, rot, scale });

  const walkable = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && tiles[y * size + x] === FLOOR;
  const inRoom = new Uint8Array(size * size);
  for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) inRoom[y * size + x] = 1;

  // Tiles that must stay clear of anything with a footprint.
  const reserved = new Uint8Array(size * size);
  const reserve = (p: Vec3, radius: number) => {
    const [tx, ty] = worldToTile(p, size);
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        if (x >= 0 && y >= 0 && x < size && y < size) reserved[y * size + x] = 1;
      }
  };
  reserve(base.spawn, 2);
  reserve(base.exit, 1);
  reserve(base.homeward, 1);
  reserve(base.treasure, 1);
  if (base.boss) reserve(base.boss, 2);
  for (const p of base.remainsSlots) reserve(p, 0);
  for (const p of base.props) reserve(p.pos, 0);
  for (const e of base.enemies) reserve(e.pos, 0);
  for (const t of base.torches) reserve(t, 0);
  const free = (x: number, y: number) => walkable(x, y) && !reserved[y * size + x];

  const arena = base.boss ? roles.exitRoom : null;

  for (const room of rooms) {
    const busy = room === roles.exitRoom || room === roles.treasureRoom || room === arena;
    colonnade(room);
    archways(room);
    wallClutter(room);
    cobwebs(room);
    floorDressing(room, busy);
  }
  corridorClutter();
  return out;

  // ── rooms ─────────────────────────────────────────────────────────────────

  /** Pillar rows along a big room's long axis with ceiling beams resting on
   * them; smaller rooms may still get bare beams. */
  function colonnade(room: Rect) {
    const alongX = room.w >= room.h;
    const L = alongX ? room.w : room.h;
    const S = alongX ? room.h : room.w;
    const tileAt = (a: number, b: number): [number, number] =>
      alongX ? [room.x + a, room.y + b] : [room.x + b, room.y + a];
    const withPillars = S >= 7 && L >= 7 && room !== arena && rng.chance(d.pillars);
    const withBeams = withPillars ? d.beams > 0 : rng.chance(d.beams);
    const inset = S >= 9 ? 2 : 1;
    const start = withPillars ? inset : 1;
    const shortCenter = alongX ? edgeToWorld(room.y, size) + (room.h * TILE) / 2 : edgeToWorld(room.x, size) + (room.w * TILE) / 2;
    for (let a = start; a <= L - 1 - start; a += 2) {
      if (withPillars) {
        for (const b of [inset, S - 1 - inset]) {
          const [tx, ty] = tileAt(a, b);
          if (!free(tx, ty) || !openAround(tx, ty)) continue;
          add("pillar", toWorld(tx, ty, size));
          reserved[ty * size + tx] = 1;
        }
      }
      if (withBeams) {
        const [tx, ty] = tileAt(a, 0);
        const [wx, , wz] = toWorld(tx, ty, size);
        const pos: Vec3 = alongX ? [wx, WALL_HEIGHT - 0.22, shortCenter] : [shortCenter, WALL_HEIGHT - 0.22, wz];
        add("beam", pos, alongX ? Math.PI / 2 : 0, [S * TILE, 1, 1]);
      }
    }
  }

  /** Stone arches framing corridor mouths (1–2 tiles wide). */
  function archways(room: Rect) {
    const sides = [
      { line: room.y - 1, from: room.x, len: room.w, horizontal: true, inward: 1 },
      { line: room.y + room.h, from: room.x, len: room.w, horizontal: true, inward: -1 },
      { line: room.x - 1, from: room.y, len: room.h, horizontal: false, inward: 1 },
      { line: room.x + room.w, from: room.y, len: room.h, horizontal: false, inward: -1 },
    ];
    for (const s of sides) {
      const open = (i: number) => (s.horizontal ? walkable(i, s.line) : walkable(s.line, i));
      for (let i = s.from; i < s.from + s.len; i++) {
        if (!open(i) || open(i - 1)) continue;
        let n = 1;
        while (open(i + n)) n++;
        const end = i + n; // exclusive
        if (n <= 2 && end <= s.from + s.len && rng.chance(d.arches)) {
          // Face plane between the corridor tile and the room.
          const face = edgeToWorld(s.inward > 0 ? s.line + 1 : s.line, size) + s.inward * 0.2;
          const a = edgeToWorld(i, size);
          const b = edgeToWorld(end, size);
          const mid = (a + b) / 2;
          const at = (along: number): Vec3 => (s.horizontal ? [along, 0, face] : [face, 0, along]);
          const rot = s.horizontal ? 0 : Math.PI / 2;
          const lintel = at(mid);
          lintel[1] = WALL_HEIGHT - 0.45;
          add("lintel", lintel, rot, [b - a + 1, 1, 1]);
          add("pilaster", at(a - 0.25), rot);
          add("pilaster", at(b + 0.25), rot);
        }
        i = end;
      }
    }
  }

  /** Rubble, bones, growths and braziers against the room's walls. */
  function wallClutter(room: Rect) {
    const spots: { tx: number; ty: number; dir: Dir }[] = [];
    for (let y = room.y; y < room.y + room.h; y++)
      for (let x = room.x; x < room.x + room.w; x++) {
        if (x !== room.x && y !== room.y && x !== room.x + room.w - 1 && y !== room.y + room.h - 1) continue;
        for (const dir of CARDINALS) if (!walkable(x + dir[0], y + dir[1])) spots.push({ tx: x, ty: y, dir });
      }
    const hug = (s: (typeof spots)[number], depth: number, jitter: number): Vec3 => {
      const [wx, , wz] = toWorld(s.tx, s.ty, size);
      const along = rng.range(-jitter, jitter);
      return [
        wx + s.dir[0] * (TILE / 2 - depth) + (s.dir[0] === 0 ? along : 0),
        0,
        wz + s.dir[1] * (TILE / 2 - depth) + (s.dir[1] === 0 ? along : 0),
      ];
    };
    let braziers = rng.chance(d.braziers) ? (room.w * room.h > 60 ? 2 : 1) : 0;
    for (const s of rng.shuffle(spots)) {
      if (!free(s.tx, s.ty)) continue;
      const roll = rng.next();
      if (braziers > 0 && isCornerish(room, s.tx, s.ty)) {
        add("brazier", hug(s, 0.6, 0), 0);
        reserved[s.ty * size + s.tx] = 1;
        braziers--;
      } else if (roll < 0.08 * d.rubble) add("rubble", hug(s, 0.5, 0.5), rng.range(0, 6.28), uniform(rng.range(0.7, 1.25)));
      else if (roll < 0.08 * (d.rubble + d.bones)) add("bones", hug(s, 0.5, 0.5), rng.range(0, 6.28), uniform(rng.range(0.8, 1.2)));
      else if (roll < 0.08 * (d.rubble + d.bones) + 0.14 * d.growth)
        add("growth", hug(s, 0.4, 0.6), rng.range(0, 6.28), uniform(rng.range(0.7, 1.4)));
    }
  }

  function cobwebs(room: Rect) {
    const corners: [number, number, number, number][] = [
      [room.x, room.y, 1, 1],
      [room.x + room.w - 1, room.y, -1, 1],
      [room.x, room.y + room.h - 1, 1, -1],
      [room.x + room.w - 1, room.y + room.h - 1, -1, -1],
    ];
    for (const [tx, ty, dx, dz] of corners) {
      if (walkable(tx - dx, ty) || walkable(tx, ty - dz) || !rng.chance(d.webs * 0.7)) continue;
      const cx = edgeToWorld(dx > 0 ? tx : tx + 1, size);
      const cz = edgeToWorld(dz > 0 ? ty : ty + 1, size);
      const s = rng.range(1.1, 1.8);
      add("web", [cx + dx * s * 0.36, WALL_HEIGHT - s * 0.36, cz + dz * s * 0.36], Math.atan2(dx, dz), uniform(s));
    }
  }

  function floorDressing(room: Rect, busy: boolean) {
    const cx = edgeToWorld(room.x, size) + (room.w * TILE) / 2;
    const cz = edgeToWorld(room.y, size) + (room.h * TILE) / 2;
    const maxR = Math.min(room.w, room.h) - 1.2;
    // The spawn room always wears its arrival sigil; quiet rooms sometimes do.
    if (d.runes > 0 && (room === roles.spawnRoom || (!busy && rng.chance(d.runes * 0.45)))) {
      const r = Math.min(2.4, maxR);
      if (r > 1) add("runeCircle", [cx, 0.02, cz], rng.range(0, 6.28), [r, 1, r]);
    }
    const randomTile = (): [number, number] => [rng.int(room.x, room.x + room.w - 1), rng.int(room.y, room.y + room.h - 1)];
    const jittered = ([tx, ty]: [number, number], y: number): Vec3 => {
      const [wx, , wz] = toWorld(tx, ty, size);
      return [wx + rng.range(-0.6, 0.6), y, wz + rng.range(-0.6, 0.6)];
    };
    if (rng.chance(d.pools)) {
      for (let i = rng.int(1, 3); i > 0; i--) {
        const t = randomTile();
        if (!free(...t)) continue;
        const r = rng.range(0.6, 1.5);
        add("pool", jittered(t, 0.012), rng.range(0, 6.28), [r, 1, r * rng.range(0.55, 0.9)]);
      }
    }
    if (rng.chance(d.chains)) {
      for (let i = rng.int(1, 3); i > 0; i--)
        add("chain", jittered(randomTile(), WALL_HEIGHT), rng.range(0, 6.28), [1, rng.range(0.9, 1.6), 1]);
    }
    const drips = Math.round((d.stalactites * room.w * room.h) / 7);
    for (let i = 0; i < drips; i++) {
      const s = rng.range(0.6, 1.3);
      add("stalactite", jittered(randomTile(), WALL_HEIGHT), rng.range(0, 6.28), [s, rng.range(0.5, 1.5), s]);
    }
  }

  // ── corridors ─────────────────────────────────────────────────────────────

  function corridorClutter() {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        if (!free(x, y) || inRoom[y * size + x]) continue;
        const [wx, , wz] = toWorld(x, y, size);
        const roll = rng.next();
        if (roll < 0.05 * d.pools) {
          const r = rng.range(0.5, 1);
          add("pool", [wx, 0.012, wz], rng.range(0, 6.28), [r, 1, r * 0.7]);
        } else if (roll < 0.05 * d.pools + 0.08 * d.stalactites) {
          const s = rng.range(0.5, 1);
          add("stalactite", [wx + rng.range(-0.6, 0.6), WALL_HEIGHT, wz + rng.range(-0.6, 0.6)], 0, [s, rng.range(0.4, 1.1), s]);
        } else if (roll < 0.05 * d.pools + 0.08 * d.stalactites + 0.04 * (d.rubble + d.bones + d.growth)) {
          const wall = CARDINALS.find(([dx, dy]) => !walkable(x + dx, y + dy));
          if (!wall) continue;
          const kind: DecorKind = rng.pick(["rubble", "bones", "growth"] as const);
          if (d[kind] <= 0) continue;
          add(kind, [wx + wall[0] * (TILE / 2 - 0.45), 0, wz + wall[1] * (TILE / 2 - 0.45)], rng.range(0, 6.28), uniform(rng.range(0.6, 1)));
        }
      }
  }

  /** All 8 neighbours walkable — a pillar here never narrows a passage. */
  function openAround(tx: number, ty: number) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!walkable(tx + dx, ty + dy)) return false;
    return true;
  }
}

function isCornerish(room: Rect, x: number, y: number): boolean {
  const nearX = x - room.x <= 1 || room.x + room.w - 1 - x <= 1;
  const nearY = y - room.y <= 1 || room.y + room.h - 1 - y <= 1;
  return nearX && nearY;
}

function uniform(s: number): Vec3 {
  return [s, s, s];
}
