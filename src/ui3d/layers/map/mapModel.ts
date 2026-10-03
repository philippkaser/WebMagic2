import { TILE } from "../../../core/config";
import { CAMPFIRE, CHEST, LANE, MERCHANT, PILLAR, PLAZA_R, STONE_RING, STRUCTURES } from "../../../scenes/village/layout";
import type { FloorLayout, Vec3 } from "../../../world/types";
import { ink } from "../../theme";

/** What the cast map draws, as pure data in WORLD units (the miniature
 * scales it): floor pieces (flat tiles, `bright` > 1 for paths), raised
 * pieces (walls, houses, standing stones) and markers. One shape for the
 * dungeon (only what you have explored) and for the village (all of it). */

export interface MapPiece {
  /** Stable id: a piece keeps its birth time across rebuilds. */
  key: number;
  x: number;
  z: number;
  sx: number;
  sz: number;
  /** Height (raised pieces), m. */
  h: number;
  /** Yaw, radians. */
  rot: number;
  bright: number;
}

export interface MapMarker {
  key: string;
  at: Vec3;
  color: string;
  size: number;
}

export interface MapBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface MapModel {
  floor: MapPiece[];
  raised: MapPiece[];
  markers: MapMarker[];
  /** What the miniature frames (null: nothing to show yet). */
  bounds: MapBounds | null;
}

/** The map never frames fewer metres than this across (a first room isn't
 * blown up to fill the table). */
export const MIN_SPAN = 14 * TILE;

/** The explored part of a floor: every seen floor tile, every wall that
 * touches one, and the places worth knowing once they've been seen. */
export function dungeonModel(layout: FloorLayout, seen: (tx: number, tz: number) => boolean): MapModel {
  const n = layout.size;
  const floor: MapPiece[] = [];
  const raised: MapPiece[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      const i = z * n + x;
      const wx = (x - n / 2 + 0.5) * TILE;
      const wz = (z - n / 2 + 0.5) * TILE;
      if (layout.tiles[i]) {
        if (!seen(x, z)) continue;
        floor.push({ key: i, x: wx, z: wz, sx: TILE * 0.9, sz: TILE * 0.9, h: 0, rot: 0, bright: 1 });
        minX = Math.min(minX, wx);
        maxX = Math.max(maxX, wx);
        minZ = Math.min(minZ, wz);
        maxZ = Math.max(maxZ, wz);
      } else if (seen(x + 1, z) || seen(x - 1, z) || seen(x, z + 1) || seen(x, z - 1)) {
        raised.push({ key: n * n + i, x: wx, z: wz, sx: TILE * 0.96, sz: TILE * 0.96, h: TILE * 0.6, rot: 0, bright: 1 });
      }
    }
  const tileOf = (p: Vec3) => [Math.floor(p[0] / TILE + n / 2), Math.floor(p[2] / TILE + n / 2)] as const;
  const known = (p: Vec3) => {
    const [tx, tz] = tileOf(p);
    return seen(tx, tz);
  };
  const markers: MapMarker[] = [];
  if (known(layout.exit)) markers.push({ key: "exit", at: layout.exit, color: ink.arcane, size: 1.2 });
  if (known(layout.leave)) markers.push({ key: "leave", at: layout.leave, color: ink.gold, size: 1.2 });
  if (known(layout.treasure)) markers.push({ key: "treasure", at: layout.treasure, color: ink.gold, size: 0.75 });
  if (layout.boss && known(layout.boss)) markers.push({ key: "boss", at: layout.boss, color: "#ff5a48", size: 1.4 });
  const bounds = floor.length ? padBounds({ minX: minX - TILE, maxX: maxX + TILE, minZ: minZ - TILE, maxZ: maxZ + TILE }, MIN_SPAN) : null;
  return { floor, raised, markers, bounds };
}

/** Village radius drawn on the map, m. */
const VILLAGE_R = 16;

/** The camp, whole: the green in 1 m cells (the cobbled plaza and the lane
 * brighter), the tents, pavilion, tower and wagon, the standing stones round
 * the gate, the depth stone and the fire — and the gate, the chest and
 * Maro's stall marked. */
export function villageModel(): MapModel {
  const floor: MapPiece[] = [];
  const raised: MapPiece[] = [];
  let key = 0;
  for (let z = -VILLAGE_R; z < VILLAGE_R; z++)
    for (let x = -VILLAGE_R; x < VILLAGE_R; x++) {
      const cx = x + 0.5;
      const cz = z + 0.5;
      const r = Math.hypot(cx, cz);
      if (r > VILLAGE_R) continue;
      const path = r < PLAZA_R || (Math.abs(cx) < LANE.width / 2 && cz > LANE.z0 && cz < LANE.z1);
      floor.push({ key: key++, x: cx, z: cz, sx: 0.86, sz: 0.86, h: 0, rot: 0, bright: path ? 1.9 : 1 });
    }
  for (const c of STRUCTURES) {
    raised.push({ key: key++, x: c.pos[0], z: c.pos[2], sx: c.w, sz: c.d, h: Math.min(c.h, 3), rot: c.rot, bright: 1 });
  }
  raised.push({ key: key++, x: PILLAR.pos[0], z: PILLAR.pos[2], sx: 0.6, sz: 0.6, h: 2.4, rot: PILLAR.rot, bright: 1.6 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.2;
    raised.push({ key: key++, x: Math.cos(a) * STONE_RING, z: Math.sin(a) * STONE_RING, sx: 0.5, sz: 0.4, h: 1.5, rot: a, bright: 1 });
  }
  raised.push({ key: key++, x: CAMPFIRE[0], z: CAMPFIRE[2], sx: 0.9, sz: 0.9, h: 0.3, rot: 0.4, bright: 1.8 });
  const markers: MapMarker[] = [
    { key: "gate", at: [0, 0, 0], color: ink.arcane, size: 1.4 },
    { key: "chest", at: CHEST.pos, color: ink.gold, size: 0.9 },
    { key: "merchant", at: MERCHANT.pos, color: ink.gold, size: 0.9 },
  ];
  return { floor, raised, markers, bounds: { minX: -VILLAGE_R, maxX: VILLAGE_R, minZ: -VILLAGE_R, maxZ: VILLAGE_R } };
}

/** Grow bounds to at least `min` across on both axes, square, about their
 * centre. */
export function padBounds(b: MapBounds, min: number): MapBounds {
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const half = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, min) / 2;
  return { minX: cx - half, maxX: cx + half, minZ: cz - half, maxZ: cz + half };
}

/** The map's width on the floor, m: big enough to walk around and read
 * from where you stand; a narrow dead end gets a smaller one. */
export const MAP_WIDTH = { dungeon: 3, village: 3.6, min: 1.6 } as const;
/** The gap between the caster's feet and the map's near edge, m. */
export const MAP_GAP = 0.35;

/** Free floor ahead of (x, z) along (fx, fz) before the first solid tile,
 * m, looking no further than `max`. */
export function freeAhead(layout: FloorLayout, x: number, z: number, fx: number, fz: number, max: number): number {
  const n = layout.size;
  for (let w = 0.1; w <= max; w += 0.1) {
    const tx = Math.floor((x + fx * w) / TILE + n / 2);
    const tz = Math.floor((z + fz * w) / TILE + n / 2);
    if (tx < 0 || tz < 0 || tx >= n || tz >= n || !layout.tiles[tz * n + tx]) return w - 0.1;
  }
  return max;
}

/** Where a map cast from (x, z) facing (fx, fz) lies: its centre `dist`
 * ahead and its `width`. It lies on the floor a short step ahead, as wide
 * as MAP_WIDTH unless a wall comes first — then it shrinks to fit (never
 * below MAP_WIDTH.min). Off to the sides it may run under the walls; they
 * hide that part. */
export function castSpot(
  layout: FloorLayout | null,
  x: number,
  z: number,
  fx: number,
  fz: number,
): { dist: number; width: number } {
  const want = layout ? MAP_WIDTH.dungeon : MAP_WIDTH.village;
  if (!layout) return { dist: MAP_GAP + want / 2, width: want };
  const free = freeAhead(layout, x, z, fx, fz, MAP_GAP + want + 0.2);
  const width = Math.max(MAP_WIDTH.min, Math.min(want, free - MAP_GAP - 0.1));
  return { dist: MAP_GAP + width / 2, width };
}
