import { DUNGEON, TILE, WALL_HEIGHT, floorScale } from "../core/config";
import { Rng } from "../core/rng";
import { TRAP_DEFS } from "./trapCatalog";
import type {
  EnemyKind,
  EnemySpawn,
  FloorLayout,
  PropSpawn,
  Rect,
  TrapSpawn,
  Vec3,
  WallBox,
} from "./types";

/** Procedural floor generator. Pure and deterministic: the same (seed, floor)
 * pair always yields an identical layout, which is what lets every player in
 * a shared floor instance generate the world locally from just a seed. */

const FLOOR = 1;
const SOLID = 0;

export function generateFloor(seed: number, floor: number): FloorLayout {
  const rng = new Rng(seed ^ (floor * 0x51ed270b));
  const size = Math.min(
    Math.floor(DUNGEON.baseSize + floor * DUNGEON.sizePerFloor),
    DUNGEON.maxSize,
  );
  const tiles = new Uint8Array(size * size);
  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size ? tiles[y * size + x] : SOLID;
  const carve = (x: number, y: number) => {
    if (x > 1 && y > 1 && x < size - 2 && y < size - 2) tiles[y * size + x] = FLOOR;
  };

  // ── Rooms ──────────────────────────────────────────────────────────────────
  const rooms: Rect[] = [];
  const targetRooms = Math.min(7 + Math.floor(floor / 3), 14);
  for (let tries = 0; tries < 90 && rooms.length < targetRooms; tries++) {
    const w = rng.int(5, 10);
    const h = rng.int(5, 10);
    const x = rng.int(2, size - w - 3);
    const y = rng.int(2, size - h - 3);
    const cand: Rect = { x, y, w, h };
    if (rooms.some((r) => overlaps(r, cand, 2))) continue;
    rooms.push(cand);
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) carve(tx, ty);
  }

  // ── Corridors: connect each room to its nearest already-connected room ────
  for (let i = 1; i < rooms.length; i++) {
    const from = center(rooms[i]);
    let best = 0;
    let bestDist = Infinity;
    for (let j = 0; j < i; j++) {
      const d = dist2(from, center(rooms[j]));
      if (d < bestDist) {
        bestDist = d;
        best = j;
      }
    }
    const to = center(rooms[best]);
    const wide = rng.chance(0.45);
    carveCorridor(carve, rng, from, to, wide);
  }

  // ── Walls: solid tiles that touch walkable space ───────────────────────────
  const wallInstances: Vec3[] = [];
  const isWallTile = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (at(x, y) !== SOLID) continue;
      let nearFloor = false;
      for (let dy = -1; dy <= 1 && !nearFloor; dy++)
        for (let dx = -1; dx <= 1 && !nearFloor; dx++)
          if (at(x + dx, y + dy) === FLOOR) nearFloor = true;
      if (nearFloor) {
        isWallTile[y * size + x] = 1;
        const [wx, , wz] = toWorld(x, y, size);
        wallInstances.push([wx, WALL_HEIGHT / 2, wz]);
      }
    }
  }
  const wallBoxes = mergeWallBoxes(isWallTile, size);

  // ── Points of interest ─────────────────────────────────────────────────────
  const spawnRoom = rooms[0];
  const spawnTile = center(spawnRoom);
  const byDistance = rooms
    .slice(1)
    .sort((a, b) => dist2(center(b), spawnTile) - dist2(center(a), spawnTile));
  const exitRoom = byDistance[0] ?? spawnRoom;
  const treasureRoom = byDistance[1] ?? exitRoom;

  const spawn = tileToWorld(spawnTile, size, 1.1);
  const isBossFloor = floor % 10 === 0;
  const exitCenter = center(exitRoom);
  // On boss floors the boss holds the room center and the portal retreats to
  // the room's edge.
  const exitTile: [number, number] = isBossFloor
    ? [exitCenter[0], Math.max(exitRoom.y + 1, exitCenter[1] - Math.floor(exitRoom.h / 2) + 1)]
    : exitCenter;
  const exit = tileToWorld(exitTile, size, 0);
  const boss: Vec3 | null = isBossFloor ? tileToWorld(exitCenter, size, 1.8) : null;
  const treasure = tileToWorld(center(treasureRoom), size, 0);
  const isCheckpoint = floor % DUNGEON.checkpointInterval === 0;
  let leave: Vec3 | null = null;
  if (isCheckpoint) {
    const lx = Math.min(exitTile[0] + 2, exitRoom.x + exitRoom.w - 2);
    leave = tileToWorld([lx, exitTile[1]], size, 0);
  }

  // ── Torches along room walls ───────────────────────────────────────────────
  const torches: Vec3[] = [];
  for (const room of rng.shuffle([...rooms])) {
    if (torches.length >= 16) break;
    for (let i = 0; i < 2; i++) {
      const onNorth = rng.chance(0.5);
      const tx = rng.int(room.x + 1, room.x + room.w - 2);
      const ty = onNorth ? room.y : room.y + room.h - 1;
      if (at(tx, ty) !== FLOOR) continue;
      const [wx, , wz] = toWorld(tx, ty, size);
      // Push toward the adjacent wall face.
      torches.push([wx, 2.6, wz + (onNorth ? -TILE * 0.42 : TILE * 0.42)]);
    }
  }

  // ── Props & enemies ────────────────────────────────────────────────────────
  const props: PropSpawn[] = [];
  const enemies: EnemySpawn[] = [];
  const scale = floorScale(floor);
  let enemyBudget = scale.enemyCount;

  for (const room of rooms) {
    const isSpawnRoom = room === spawnRoom;
    const propCount = rng.int(1, 4);
    for (let i = 0; i < propCount; i++) {
      const pos = randomInRoom(rng, room, size, 1);
      if (dist2World(pos, spawn) < 16) continue;
      const roll = rng.next();
      props.push({ kind: roll < 0.4 ? "pot" : roll < 0.75 ? "crate" : "barrel", pos });
    }
    if (isSpawnRoom || enemyBudget <= 0) continue;
    // Boss floors keep the arena clear of regular enemies.
    if (isBossFloor && room === exitRoom) continue;
    const share = Math.min(enemyBudget, rng.int(1, 3) + Math.floor(floor / 6));
    for (let i = 0; i < share; i++) {
      const pos = randomInRoom(rng, room, size, 1.6);
      if (dist2World(pos, spawn) < 100) continue;
      // One draw picks the kind: shadow (floor 3+) prowls, sentry (floor 2+)
      // holds an angle, slime hops, wisp fills the rest.
      const roll = rng.next();
      const kind: EnemyKind =
        floor >= 3 && roll < 0.15
          ? "shadow"
          : floor >= 2 && roll < 0.32
            ? "sentry"
            : roll < 0.62
              ? "slime"
              : "wisp";
      const y =
        kind === "sentry" ? 0.9 : kind === "shadow" ? 0.8 : kind === "slime" ? 0.6 : pos[1];
      enemies.push({ kind, pos: [pos[0], y, pos[2]] });
      enemyBudget--;
    }
  }

  // ── Traps ──────────────────────────────────────────────────────────────────
  // Placed LAST, after every other rng draw, so adding hazards never perturbs
  // the rooms/props/enemies rolled above — a given seed keeps its exact layout
  // and merely gains traps. The warp is filtered off checkpoint floors so it
  // can't yank a wizard away from a floor they came to bank on.
  const traps: TrapSpawn[] = [];
  const eligibleTraps = TRAP_DEFS.filter((t) => !(t.noCheckpoint && isCheckpoint));
  const trapWeight = eligibleTraps.reduce((s, t) => s + t.weight, 0);
  const trapBudget = Math.min(2 + Math.floor(floor / 3), 9);
  for (let tries = 0; tries < trapBudget * 5 && traps.length < trapBudget; tries++) {
    const room = rng.pick(rooms);
    if (room === spawnRoom || (isBossFloor && room === exitRoom)) continue;
    const pos = randomInRoom(rng, room, size, 0);
    if (dist2World(pos, spawn) < 64) continue; // never right on top of the entrance
    let r = rng.next() * trapWeight;
    let def = eligibleTraps[0];
    for (const t of eligibleTraps) {
      r -= t.weight;
      if (r <= 0) {
        def = t;
        break;
      }
    }
    traps.push({ kind: def.id, pos });
  }

  return {
    floor,
    seed,
    size,
    tiles,
    rooms,
    spawn,
    exit,
    leave,
    treasure,
    boss,
    torches,
    props,
    enemies,
    traps,
    wallInstances,
    wallBoxes,
    extent: (size * TILE) / 2,
  };
}

/** BFS over walkable tiles — used by tests to prove every floor is traversable. */
export function isReachable(layout: FloorLayout, from: Vec3, to: Vec3): boolean {
  const { size, tiles } = layout;
  const start = worldToTile(from, size);
  const goal = worldToTile(to, size);
  const seen = new Uint8Array(size * size);
  const queue: number[] = [start[1] * size + start[0]];
  seen[queue[0]] = 1;
  while (queue.length) {
    const idx = queue.shift()!;
    const x = idx % size;
    const y = Math.floor(idx / size);
    if (x === goal[0] && y === goal[1]) return true;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const nidx = ny * size + nx;
      if (seen[nidx] || tiles[nidx] !== FLOOR) continue;
      seen[nidx] = 1;
      queue.push(nidx);
    }
  }
  return false;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function overlaps(a: Rect, b: Rect, pad: number): boolean {
  return (
    a.x - pad < b.x + b.w &&
    a.x + a.w + pad > b.x &&
    a.y - pad < b.y + b.h &&
    a.y + a.h + pad > b.y
  );
}

function center(r: Rect): [number, number] {
  return [Math.floor(r.x + r.w / 2), Math.floor(r.y + r.h / 2)];
}

function dist2(a: [number, number], b: [number, number]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

function dist2World(a: Vec3, b: Vec3): number {
  return (a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2;
}

function carveCorridor(
  carve: (x: number, y: number) => void,
  rng: Rng,
  from: [number, number],
  to: [number, number],
  wide: boolean,
): void {
  const horizontalFirst = rng.chance(0.5);
  const dig = (x: number, y: number) => {
    carve(x, y);
    if (wide) {
      carve(x + 1, y);
      carve(x, y + 1);
    }
  };
  let [x, y] = from;
  if (horizontalFirst) {
    for (; x !== to[0]; x += Math.sign(to[0] - x)) dig(x, y);
    for (; y !== to[1]; y += Math.sign(to[1] - y)) dig(x, y);
  } else {
    for (; y !== to[1]; y += Math.sign(to[1] - y)) dig(x, y);
    for (; x !== to[0]; x += Math.sign(to[0] - x)) dig(x, y);
  }
  dig(x, y);
}

function toWorld(tx: number, ty: number, size: number): Vec3 {
  return [(tx - size / 2) * TILE + TILE / 2, 0, (ty - size / 2) * TILE + TILE / 2];
}

function tileToWorld(t: [number, number], size: number, y: number): Vec3 {
  const [wx, , wz] = toWorld(t[0], t[1], size);
  return [wx, y, wz];
}

function worldToTile(p: Vec3, size: number): [number, number] {
  return [
    Math.floor(p[0] / TILE + size / 2),
    Math.floor(p[2] / TILE + size / 2),
  ];
}

function randomInRoom(rng: Rng, room: Rect, size: number, y: number): Vec3 {
  const tx = rng.int(room.x + 1, room.x + room.w - 2);
  const ty = rng.int(room.y + 1, room.y + room.h - 2);
  return tileToWorld([tx, ty], size, y);
}

/** Greedy rectangle merge: turns individual wall tiles into a much smaller
 * set of box colliders (important for physics cost as floors grow). */
function mergeWallBoxes(isWall: Uint8Array, size: number): WallBox[] {
  const used = new Uint8Array(size * size);
  const boxes: WallBox[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      if (!isWall[idx] || used[idx]) continue;
      let w = 1;
      while (x + w < size && isWall[idx + w] && !used[idx + w]) w++;
      let h = 1;
      outer: while (y + h < size) {
        for (let i = 0; i < w; i++) {
          const j = (y + h) * size + x + i;
          if (!isWall[j] || used[j]) break outer;
        }
        h++;
      }
      for (let dy = 0; dy < h; dy++)
        for (let dx = 0; dx < w; dx++) used[(y + dy) * size + x + dx] = 1;
      const [x0, , z0] = toWorld(x, y, size);
      const [x1, , z1] = toWorld(x + w - 1, y + h - 1, size);
      boxes.push({
        center: [(x0 + x1) / 2, WALL_HEIGHT / 2, (z0 + z1) / 2],
        half: [(w * TILE) / 2, WALL_HEIGHT / 2, (h * TILE) / 2],
      });
    }
  }
  return boxes;
}
