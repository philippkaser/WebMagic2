import { describe, expect, test } from "bun:test";
import type { FloorLayout, Vec3 } from "../types";
import { generateFloor } from "./dungeonGen";
import { FLOOR, worldToTile } from "./grid";

const SOLID_KINDS = new Set(["pillar", "brazier"]);
const GROUND_KINDS = new Set(["pillar", "brazier", "rubble", "bones", "growth", "pool", "runeCircle"]);

const flat = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const walkable = (l: FloorLayout, tx: number, ty: number) => l.tiles[ty * l.size + tx] === FLOOR;

function sampleFloors(): FloorLayout[] {
  const out: FloorLayout[] = [];
  for (let i = 0; i < 30; i++) out.push(generateFloor((i * 2654435761) >>> 0, 1 + ((i * 7) % 100)));
  return out;
}

describe("placeDecor", () => {
  test("is deterministic for the same seed", () => {
    expect(generateFloor(99, 12).decor).toEqual(generateFloor(99, 12).decor);
  });

  test("dresses every biome", () => {
    for (const floor of [1, 15, 30, 50, 80]) {
      const decor = generateFloor(4242, floor).decor;
      expect(decor.length).toBeGreaterThan(20);
      expect(decor.some((d) => d.kind === "runeCircle" || d.kind === "growth")).toBe(true);
    }
  });

  test("solid pieces keep clear of spawn, portals, treasure, props and enemies", () => {
    for (const l of sampleFloors()) {
      const keepOut: [Vec3, number][] = [
        [l.spawn, 3],
        [l.exit, 2],
        [l.homeward, 2],
        [l.treasure, 2],
        ...l.remainsSlots.map((p): [Vec3, number] => [p, 1.5]),
        ...l.props.map((p): [Vec3, number] => [p.pos, 1.2]),
        ...l.enemies.map((e): [Vec3, number] => [e.pos, 1.2]),
      ];
      if (l.boss) keepOut.push([l.boss, 4]);
      for (const d of l.decor) {
        if (!SOLID_KINDS.has(d.kind)) continue;
        for (const [p, r] of keepOut) expect(flat(d.pos, p)).toBeGreaterThanOrEqual(r);
      }
    }
  });

  test("pillars never narrow a passage", () => {
    for (const l of sampleFloors()) {
      for (const d of l.decor) {
        if (d.kind !== "pillar") continue;
        const [tx, ty] = worldToTile(d.pos, l.size);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) expect(walkable(l, tx + dx, ty + dy)).toBe(true);
      }
    }
  });

  test("ground dressing stands on walkable tiles", () => {
    for (const l of sampleFloors()) {
      for (const d of l.decor) {
        if (!GROUND_KINDS.has(d.kind)) continue;
        const [tx, ty] = worldToTile(d.pos, l.size);
        expect(walkable(l, tx, ty)).toBe(true);
      }
    }
  });
});
