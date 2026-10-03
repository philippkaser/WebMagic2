import { describe, expect, test } from "bun:test";
import { TILE } from "../../core/config";
import type { FloorLayout } from "../types";
import { generateFloor } from ".";
import { FLOOR, SOLID, worldToTile } from "./grid";

function floors(count: number, depth: (i: number) => number): FloorLayout[] {
  const out: FloorLayout[] = [];
  for (let i = 0; i < count; i++) out.push(generateFloor((i * 2246822519 + 3) >>> 0, depth(i)));
  return out;
}

const tileOf = (layout: FloorLayout, x: number, y: number) =>
  x < 0 || y < 0 || x >= layout.size || y >= layout.size ? SOLID : layout.tiles[y * layout.size + x];

describe("lore rune placement", () => {
  const sample = floors(300, (i) => 1 + (i % 100));
  const runes = sample.flatMap((layout) => layout.lore.map((rune) => ({ layout, rune })));

  test("appears on roughly half of all floors", () => {
    const withLore = sample.filter((l) => l.lore.length > 0).length / sample.length;
    expect(withLore).toBeGreaterThan(0.42);
    expect(withLore).toBeLessThan(0.68);
  });

  test("a second rune only turns up deeper down", () => {
    for (const layout of sample) {
      if (layout.lore.length > 1) expect(layout.floor).toBeGreaterThanOrEqual(25);
      expect(layout.lore.length).toBeLessThanOrEqual(2);
    }
    expect(sample.some((l) => l.lore.length === 2)).toBe(true);
  });

  test("sits on a walkable tile with a wall behind it, facing into open floor", () => {
    expect(runes.length).toBeGreaterThan(100);
    for (const { layout, rune } of runes) {
      const [tx, ty] = worldToTile(rune.pos, layout.size);
      expect(tileOf(layout, tx, ty)).toBe(FLOOR);
      // (sin, cos) of the yaw is the XZ direction the rune faces.
      const fx = Math.round(Math.sin(rune.facing));
      const fz = Math.round(Math.cos(rune.facing));
      expect(Math.abs(fx) + Math.abs(fz)).toBe(1);
      expect(tileOf(layout, tx + fx, ty + fz)).toBe(FLOOR);
      expect(tileOf(layout, tx - fx, ty - fz)).toBe(SOLID);
      // Mounted against that wall: offset from the tile centre toward it.
      const cx = (tx - layout.size / 2) * TILE + TILE / 2;
      const cz = (ty - layout.size / 2) * TILE + TILE / 2;
      expect(Math.sign(rune.pos[0] - cx)).toBe(fx === 0 ? 0 : -fx);
      expect(Math.sign(rune.pos[2] - cz)).toBe(fz === 0 ? 0 : -fz);
    }
  });

  test("keeps clear of torches, portals, the treasure and the boss", () => {
    for (const { layout, rune } of runes) {
      const [tx, ty] = worldToTile(rune.pos, layout.size);
      for (const torch of layout.torches) {
        expect(worldToTile(torch, layout.size)).not.toEqual([tx, ty]);
      }
      const landmarks = [layout.exit, layout.leave, layout.treasure, layout.spawn];
      if (layout.boss) landmarks.push(layout.boss);
      for (const p of landmarks) {
        const [lx, ly] = worldToTile(p, layout.size);
        expect(Math.max(Math.abs(lx - tx), Math.abs(ly - ty))).toBeGreaterThan(1);
      }
    }
  });

  test("two runes on one floor speak from different rooms", () => {
    for (const layout of sample) {
      if (layout.lore.length < 2) continue;
      const [a, b] = layout.lore.map((r) => worldToTile(r.pos, layout.size));
      const room = (t: [number, number]) =>
        layout.rooms.findIndex((r) => t[0] >= r.x && t[0] < r.x + r.w && t[1] >= r.y && t[1] < r.y + r.h);
      expect(room(a)).not.toBe(room(b));
    }
  });

  test("uses its own stream: the same floor always carves the same words", () => {
    for (const layout of sample.slice(0, 30)) {
      expect(generateFloor(layout.seed, layout.floor).lore).toEqual(layout.lore);
    }
  });
});
