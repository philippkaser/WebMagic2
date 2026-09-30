import { describe, expect, test } from "bun:test";
import { ARCHITECTURE, PLAYER, TILE } from "../../core/config";
import type { FloorLayout, Rect, Vec3 } from "../types";
import { generateFloor } from ".";
import { PILLAR_CLEARANCE, PILLAR_MIN_ROOM, bayLines, roomFrame } from "./architecture";
import { FLOOR, SOLID, floodFill, worldToTile } from "./grid";

/** The architecture stage must dress floors without ever getting in the
 * way: pillars have colliders, so the promise that matters most is "no
 * path is ever blocked and no landmark is crowded". */

function sampleFloors(count: number): FloorLayout[] {
  const out: FloorLayout[] = [];
  for (let i = 0; i < count; i++) {
    const seed = (i * 2654435761 + 424242) >>> 0;
    out.push(generateFloor(seed, 1 + ((i * 11) % 100)));
  }
  return out;
}

const FLOORS = sampleFloors(220);

function roomAt(layout: FloorLayout, p: Vec3): Rect | undefined {
  const [x, y] = worldToTile(p, layout.size);
  return layout.rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
}

/** Tiles a pillar's footprint (inflated by the player's radius) touches. */
function pillarTiles(layout: FloorLayout): Set<number> {
  const blocked = new Set<number>();
  const half = ARCHITECTURE.pillarBase + PLAYER.radius;
  for (const { pos } of layout.architecture.pillars) {
    const [x0, y0] = worldToTile([pos[0] - half, 0, pos[2] - half], layout.size);
    const [x1, y1] = worldToTile([pos[0] + half - 1e-6, 0, pos[2] + half - 1e-6], layout.size);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) blocked.add(y * layout.size + x);
  }
  return blocked;
}

describe("architecture", () => {
  test("is deterministic", () => {
    for (const [seed, floor] of [
      [4242, 3],
      [4242, 40],
      [99, 12],
      [31337, 70],
    ]) {
      expect(generateFloor(seed, floor).architecture).toEqual(generateFloor(seed, floor).architecture);
    }
  });

  test("dresses floors: ribs everywhere, colonnades and shafts often, crystals only in the Deep", () => {
    let ribs = 0;
    let pillars = 0;
    let shafts = 0;
    for (const l of FLOORS) {
      ribs += l.architecture.ribs.length;
      pillars += l.architecture.pillars.length;
      shafts += l.architecture.shafts.length;
      if (l.biome !== "crystal") expect(l.architecture.crystals).toEqual([]);
    }
    expect(ribs / FLOORS.length).toBeGreaterThan(4);
    expect(pillars).toBeGreaterThan(FLOORS.length);
    expect(shafts).toBeGreaterThan(FLOORS.length * 0.8);
    const deep = FLOORS.filter((l) => l.biome === "crystal");
    expect(deep.length).toBeGreaterThan(10);
    expect(deep.reduce((n, l) => n + l.architecture.crystals.length, 0)).toBeGreaterThan(deep.length * 2);
  });

  test("pillars never block a path — treating their footprints as rock, everything stays reachable", () => {
    for (const l of FLOORS) {
      const blocked = pillarTiles(l);
      if (blocked.size === 0) continue;
      const before = floodFill(l.tiles, l.size, worldToTile(l.spawn, l.size));
      const tiles = l.tiles.slice();
      for (const i of blocked) {
        expect(l.tiles[i]).toBe(FLOOR);
        tiles[i] = SOLID;
      }
      const after = floodFill(tiles, l.size, worldToTile(l.spawn, l.size));
      for (let i = 0; i < tiles.length; i++) {
        if (before[i] && !blocked.has(i)) expect(after[i]).toBe(1);
      }
      // No landmark tile is under a pillar.
      const landmarks: Vec3[] = [l.spawn, l.exit, l.leave, l.treasure, ...l.lore.map((r) => r.pos)];
      if (l.boss) landmarks.push(l.boss);
      for (const p of landmarks) {
        const [x, y] = worldToTile(p, l.size);
        expect(blocked.has(y * l.size + x)).toBe(false);
      }
    }
  });

  test("pillars stand only in big rooms, off the boss arena, clear of landmarks and spawned bodies", () => {
    const c = PILLAR_CLEARANCE;
    const d = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);
    for (const l of FLOORS) {
      for (const { pos } of l.architecture.pillars) {
        const room = roomAt(l, pos);
        expect(room).toBeDefined();
        expect(room!.w).toBeGreaterThanOrEqual(PILLAR_MIN_ROOM);
        expect(room!.h).toBeGreaterThanOrEqual(PILLAR_MIN_ROOM);
        if (l.boss) expect(room).not.toBe(roomAt(l, l.exit));
        expect(d(pos, l.spawn)).toBeGreaterThanOrEqual(c.spawn);
        expect(d(pos, l.exit)).toBeGreaterThanOrEqual(c.portal);
        expect(d(pos, l.leave)).toBeGreaterThanOrEqual(c.portal);
        expect(d(pos, l.treasure)).toBeGreaterThanOrEqual(c.treasure);
        for (const r of l.lore) expect(d(pos, r.pos)).toBeGreaterThanOrEqual(c.lore);
        for (const t of l.torches) expect(d(pos, t)).toBeGreaterThanOrEqual(c.torch);
        for (const p of l.props) expect(d(pos, p.pos)).toBeGreaterThanOrEqual(c.prop);
        for (const e of l.enemies) expect(d(pos, e.pos)).toBeGreaterThanOrEqual(c.enemy);
        for (const t of l.traps) expect(d(pos, t.pos)).toBeGreaterThanOrEqual(c.trap);
      }
      // Pillars come in pairs (one per row under each rib line).
      expect(l.architecture.pillars.length % 2).toBe(0);
    }
  });

  test("ribs span a room wall to wall with solid rock behind both piers", () => {
    for (const l of FLOORS) {
      for (const rib of l.architecture.ribs) {
        expect(rib.to).toBeGreaterThan(rib.from);
        for (const [face, side] of [
          [rib.from, -1],
          [rib.to, 1],
        ] as const) {
          for (const off of [-ARCHITECTURE.pierWidth / 2, 0, ARCHITECTURE.pierWidth / 2]) {
            const s = face + side * 0.5;
            const p: Vec3 = rib.axis === "x" ? [s, 0, rib.at + off] : [rib.at + off, 0, s];
            const [x, y] = worldToTile(p, l.size);
            expect(l.tiles[y * l.size + x]).toBe(SOLID);
          }
        }
        // No torch hangs on the stretch of wall a pier covers.
        for (const t of l.torches) {
          const s = rib.axis === "x" ? t[0] : t[2];
          const along = rib.axis === "x" ? t[2] : t[0];
          const onFace = Math.abs(s - rib.from) < 1 || Math.abs(s - rib.to) < 1;
          if (onFace) expect(Math.abs(along - rib.at)).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  test("bay lines keep every room's centre open", () => {
    for (const l of FLOORS.slice(0, 40)) {
      for (const room of l.rooms) {
        const frame = roomFrame(room, l.size);
        const c = (frame.longMin + frame.longMax) / 2;
        for (const at of bayLines(frame, 2)) {
          expect(Math.abs(at - c)).toBeGreaterThanOrEqual(ARCHITECTURE.ribSpacing / 2 - 1e-6);
          expect(at).toBeGreaterThan(frame.longMin);
          expect(at).toBeLessThan(frame.longMax);
        }
      }
    }
  });

  test("light shafts land on open floor, away from portals, and never on a lightless floor", () => {
    for (const l of FLOORS) {
      if (l.omen === "lightless") expect(l.architecture.shafts).toEqual([]);
      for (const s of l.architecture.shafts) {
        const [x, y] = worldToTile(s.pos, l.size);
        expect(l.tiles[y * l.size + x]).toBe(FLOOR);
        expect(Math.hypot(s.pos[0] - l.exit[0], s.pos[2] - l.exit[2])).toBeGreaterThanOrEqual(3);
        expect(Math.hypot(s.pos[0] - l.leave[0], s.pos[2] - l.leave[2])).toBeGreaterThanOrEqual(3);
        expect(s.radius).toBeGreaterThan(0.5);
        expect(s.radius).toBeLessThan(TILE);
      }
    }
  });

  test("crystal clusters grow in true room corners, which can never be through-ways", () => {
    for (const l of FLOORS.filter((f) => f.biome === "crystal")) {
      expect(l.architecture.crystals.length).toBeLessThanOrEqual(14);
      for (const c of l.architecture.crystals) {
        const [x, y] = worldToTile(c.pos, l.size);
        expect(l.tiles[y * l.size + x]).toBe(FLOOR);
        // Exactly two open 4-neighbours: a dead-end corner.
        let open = 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          if (l.tiles[(y + dy) * l.size + x + dx] === FLOOR) open++;
        }
        expect(open).toBe(2);
        expect(c.scale).toBeGreaterThan(0.5);
        expect([0, 1]).toContain(c.hue);
      }
    }
  });
});
