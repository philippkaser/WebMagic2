import { ARCHITECTURE, TILE } from "../../core/config";
import { Rng } from "../../core/rng";
import type { DoorwaySpawn, DoorwayStyle, LoreSpawn, Rect, Vec3 } from "../types";
import { type Grid, type Tile, SOLID, worldToTile } from "./grid";
import { STREAM_SALT, streamSeed } from "./seeds";

/** Stage — doorways: every place a corridor meets a room gets a frame of
 * dressed stone on the room's side — two jambs, an arch, and a header
 * closing the 6 m slot above it. It is the oldest cue a dungeon has: you
 * see the arch before you see the room.
 *
 * Finding the mouths is a pure function of the carved grid (no rng): a run
 * of open tiles just outside a room's edge, one or two tiles wide, with rock
 * on both sides of it along that wall and the corridor carrying on outward.
 * Wider gaps (a corridor running along a room, a bend right at its edge)
 * are not doorways and stay unframed. What hangs in each doorway — nothing,
 * a raised portcullis, a door on its last hinge — is rolled on its own
 * stream, so none of it can move a room, prop or enemy. */

/** Openings wider than this many tiles are not doorways. */
export const MAX_DOOR_TILES = 2;

/** Share of doorways with a raised portcullis, and with a broken door. */
const PORTCULLIS_SHARE = 0.2;
const DOOR_SHARE = 0.16;

/** A door leaf keeps this far (m) from the room's corner. */
const LEAF_CORNER_MARGIN = 0.3;
/** …and from torches and lore runes on its wall (m, along the wall). */
const LEAF_FIXTURE_CLEARANCE = 0.45;

/** The four ways out of a room through a wall ([dx, dy] in tiles). */
const OUTWARD: readonly Tile[] = [
  [0, -1], // north wall
  [0, 1], // south wall
  [-1, 0], // west wall
  [1, 0], // east wall
];

/** A corridor mouth as the grid shows it, before any styling. */
export interface Mouth {
  room: Rect;
  /** The slot through the wall line: the open tiles just outside the room. */
  slot: Tile[];
  /** One step from the room out through the wall. */
  out: Tile;
  axis: "x" | "z";
  face: number;
  from: number;
  to: number;
  inward: 1 | -1;
}

/** Every corridor mouth on the floor, in a fixed order (rooms in order,
 * then north, south, west, east, then along the wall). */
export function findMouths(grid: Grid, rooms: Rect[]): Mouth[] {
  const half = grid.size / 2;
  const mouths: Mouth[] = [];
  for (const room of rooms) {
    for (const out of OUTWARD) {
      const alongX = out[1] !== 0;
      const len = alongX ? room.w : room.h;
      const at = (i: number): Tile =>
        alongX
          ? [room.x + i, out[1] < 0 ? room.y - 1 : room.y + room.h]
          : [out[0] < 0 ? room.x - 1 : room.x + room.w, room.y + i];
      for (let i = 0; i < len; ) {
        if (!grid.isFloor(...at(i))) {
          i++;
          continue;
        }
        let j = i;
        while (j + 1 < len && grid.isFloor(...at(j + 1))) j++;
        const slot: Tile[] = [];
        for (let k = i; k <= j; k++) slot.push(at(k));
        // Rock on both sides along this room's own wall (runs are maximal,
        // so a run that doesn't touch a corner has rock either side), and
        // a real passage beyond rather than a one-tile pocket.
        const framed = j - i + 1 <= MAX_DOOR_TILES && i >= 1 && j <= len - 2;
        if (framed && slot.some(([x, y]) => grid.isFloor(x + out[0], y + out[1]))) {
          const inward = (alongX ? -out[1] : -out[0]) as 1 | -1;
          const start = alongX ? room.x : room.y;
          const faceTile = alongX ? (out[1] < 0 ? room.y : room.y + room.h) : out[0] < 0 ? room.x : room.x + room.w;
          mouths.push({
            room,
            slot,
            out,
            axis: alongX ? "x" : "z",
            face: (faceTile - half) * TILE,
            from: (start + i - half) * TILE,
            to: (start + j + 1 - half) * TILE,
            inward,
          });
        }
        i = j + 1;
      }
    }
  }
  return mouths;
}

export interface DoorwayInput {
  grid: Grid;
  seed: number;
  floor: number;
  rooms: Rect[];
  torches: Vec3[];
  lore: LoreSpawn[];
}

/** Find and dress every corridor mouth (two draws per mouth, whatever
 * fits, so the stream never depends on what the walls allow). */
export function placeDoorways(input: DoorwayInput): DoorwaySpawn[] {
  const rng = new Rng(streamSeed(input.seed, input.floor, STREAM_SALT.doorways));
  const mouths = findMouths(input.grid, input.rooms);
  const doorways: DoorwaySpawn[] = [];
  for (const m of mouths) {
    const roll = rng.next();
    const hinge: -1 | 1 = rng.next() < 0.5 ? -1 : 1;
    let style: DoorwayStyle = roll < PORTCULLIS_SHARE ? "portcullis" : roll < PORTCULLIS_SHARE + DOOR_SHARE ? "door" : "open";
    const d: DoorwaySpawn = { axis: m.axis, face: m.face, from: m.from, to: m.to, inward: m.inward, style, hinge };
    if (style === "door" && !leafFits(input, m, d, mouths)) style = "open";
    doorways.push({ ...d, style });
  }
  return doorways;
}

// ── Geometry shared with the planners and the renderer ───────────────────────

/** Along-wall coordinate and distance into the room of a point, in a
 * doorway's own frame. */
export function doorwayLocal(d: DoorwaySpawn, p: Vec3): { along: number; into: number } {
  const along = d.axis === "x" ? p[0] : p[2];
  const across = d.axis === "x" ? p[2] : p[0];
  return { along, into: (across - d.face) * d.inward };
}

/** World point from a doorway's own frame (along the wall, height, into
 * the room). */
export function doorwayPoint(d: DoorwaySpawn, along: number, y: number, into: number): Vec3 {
  const across = d.face + d.inward * into;
  return d.axis === "x" ? [along, y, across] : [across, y, along];
}

/** The stretch of wall (along it, m) the frame covers: jambs and the arch
 * ring that springs from them. */
export function frameExtent(d: DoorwaySpawn): [number, number] {
  const reach = ARCHITECTURE.jambWidth + ARCHITECTURE.archRing * 0.5 + 0.06;
  return [d.from - reach, d.to + reach];
}

/** The stretch of wall a broken door's leaf lies against, or null. */
export function leafExtent(d: DoorwaySpawn): [number, number] | null {
  if (d.style !== "door") return null;
  const j = ARCHITECTURE.jambWidth;
  const l = ARCHITECTURE.doorLeaf;
  return d.hinge < 0 ? [d.from - j - l, d.from - j] : [d.to + j, d.to + j + l];
}

/** Does a stretch of wall [lo, hi] (along it) on the same wall face as
 * this doorway overlap its frame or door leaf, with `pad` to spare? */
export function touchesDoorway(d: DoorwaySpawn, axis: "x" | "z", face: number, lo: number, hi: number, pad = 0): boolean {
  if (axis !== d.axis || Math.abs(face - d.face) > 0.01) return false;
  const spans = [frameExtent(d)];
  const leaf = leafExtent(d);
  if (leaf) spans.push(leaf);
  return spans.some(([a, b]) => lo < b + pad && hi > a - pad);
}

/** Is a floor point in a doorway's walking lane — straight in front of the
 * opening, `reach` metres into the room, widened by `pad` either side? */
export function inDoorLane(d: DoorwaySpawn, p: Vec3, reach: number, pad: number): boolean {
  const { along, into } = doorwayLocal(d, p);
  return into > -0.01 && into < reach && along > d.from - pad && along < d.to + pad;
}

/** A broken leaf needs unbroken wall behind it inside the room's own side,
 * no torch or rune on that stretch, and no other doorway's frame. */
function leafFits(input: DoorwayInput, m: Mouth, d: DoorwaySpawn, mouths: Mouth[]): boolean {
  const { grid } = input;
  const [lo, hi] = leafExtent({ ...d, style: "door" })!;
  const half = grid.size / 2;
  const roomLo = ((m.axis === "x" ? m.room.x : m.room.y) - half) * TILE;
  const roomHi = roomLo + (m.axis === "x" ? m.room.w : m.room.h) * TILE;
  if (lo < roomLo + LEAF_CORNER_MARGIN || hi > roomHi - LEAF_CORNER_MARGIN) return false;
  // Rock behind the whole stretch.
  for (let a = lo; a <= hi + 1e-6; a += 0.4) {
    const [tx, ty] = worldToTile(doorwayPoint(d, a, 0, -0.5), grid.size);
    if (grid.at(tx, ty) !== SOLID) return false;
  }
  const onWall = (p: Vec3) => {
    const { along, into } = doorwayLocal(d, p);
    return into > -0.2 && into < 1 && along > lo - LEAF_FIXTURE_CLEARANCE && along < hi + LEAF_FIXTURE_CLEARANCE;
  };
  if (input.torches.some(onWall) || input.lore.some((r) => onWall(r.pos))) return false;
  for (const o of mouths) {
    if (o === m) continue;
    if (touchesDoorway({ ...o, style: "open", hinge: 1 }, d.axis, d.face, lo, hi, 0.1)) return false;
  }
  return true;
}
