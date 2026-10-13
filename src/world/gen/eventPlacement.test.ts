import { describe, expect, test } from "bun:test";
import { TILE } from "../../core/config";
import { roomEventDef } from "../../roomEvents/catalog";
import { generateFloor } from "./index";
import { worldToTile } from "./grid";

describe("room event placement", () => {
  const floors = Array.from({ length: 60 }, (_, i) => generateFloor(1000 + i * 77, 1 + (i % 40)));

  test("most floors hold an event; none holds two of a kind", () => {
    const withAny = floors.filter((f) => f.events.length > 0).length;
    expect(withAny).toBeGreaterThan(floors.length * 0.6);
    for (const f of floors) {
      const kinds = f.events.map((e) => e.kind);
      expect(new Set(kinds).size).toBe(kinds.length);
      expect(f.events.length).toBeLessThanOrEqual(2);
    }
  });

  test("events stand on walkable floor inside their room, respecting depth and room size", () => {
    for (const f of floors) {
      for (const e of f.events) {
        const [tx, ty] = worldToTile(e.pos, f.size);
        expect(f.tiles[ty * f.size + tx]).toBe(1);
        const [minX, minZ, maxX, maxZ] = e.area;
        expect(e.pos[0]).toBeGreaterThan(minX);
        expect(e.pos[0]).toBeLessThan(maxX);
        expect(e.pos[2]).toBeGreaterThan(minZ);
        expect(e.pos[2]).toBeLessThan(maxZ);
        const def = roomEventDef(e.kind);
        expect(f.floor).toBeGreaterThanOrEqual(def.minFloor);
        expect(Math.min(maxX - minX, maxZ - minZ) / TILE).toBeGreaterThanOrEqual(def.minRoom);
      }
    }
  });

  test("never in the spawn, exit or treasure room, and clear of what's already there", () => {
    for (const f of floors) {
      for (const e of f.events) {
        const [minX, minZ, maxX, maxZ] = e.area;
        const inRoom = (p: readonly number[]) => p[0]! > minX && p[0]! < maxX && p[2]! > minZ && p[2]! < maxZ;
        expect(inRoom(f.spawn)).toBe(false);
        expect(inRoom(f.exit)).toBe(false);
        expect(inRoom(f.treasure)).toBe(false);
        for (const p of [...f.props.map((q) => q.pos), ...f.enemies.map((q) => q.pos), ...f.architecture.pillars.map((q) => q.pos)]) {
          expect(Math.hypot(p[0] - e.pos[0], p[2] - e.pos[2])).toBeGreaterThan(TILE * 0.99);
        }
      }
    }
  });

  test("deterministic per seed", () => {
    expect(generateFloor(4242, 17).events).toEqual(generateFloor(4242, 17).events);
  });
});
