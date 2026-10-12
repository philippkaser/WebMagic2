import { describe, expect, test } from "bun:test";
import {
  BANNERS,
  BOUNDS,
  CAMPFIRE,
  CHEST,
  DEV_SLAB,
  GATE_TORCHES,
  groundHeight,
  inStructure,
  LANE,
  LANTERNS,
  MERCHANT,
  PILLAR,
  PLAZA_R,
  SPAWN,
  STRUCTURES,
  WORKTABLE,
} from "./layout";

describe("the camp's layout", () => {
  test("the ground is flat wherever you can walk, and climbs north beyond", () => {
    for (let x = -BOUNDS; x <= BOUNDS; x += 2.5)
      for (let z = -BOUNDS; z <= BOUNDS; z += 2.5) expect(groundHeight(x, z)).toBeCloseTo(0, 6);
    expect(groundHeight(0, -90)).toBeGreaterThan(4);
    expect(groundHeight(0, -90)).toBeGreaterThan(groundHeight(0, 60));
  });

  test("no structure stands on the lane, the plaza, the spawn or a fixture", () => {
    const fixtures: [number, number][] = [
      [SPAWN[0], SPAWN[2]],
      [CHEST.pos[0], CHEST.pos[2]],
      [MERCHANT.pos[0], MERCHANT.pos[2]],
      [DEV_SLAB[0], DEV_SLAB[2]],
      [PILLAR.pos[0], PILLAR.pos[2]],
      [CAMPFIRE[0], CAMPFIRE[2]],
      [WORKTABLE.pos[0], WORKTABLE.pos[2]],
      ...[...GATE_TORCHES, ...LANTERNS, ...BANNERS].map(([x, , z]) => [x, z] as [number, number]),
    ];
    for (const s of STRUCTURES) {
      for (const [x, z] of fixtures) expect(inStructure(s, x, z, 0.5)).toBe(false);
      for (let z = LANE.z0; z <= LANE.z1; z += 0.5)
        for (const x of [-LANE.width / 2, 0, LANE.width / 2]) expect(inStructure(s, x, z, 0.3)).toBe(false);
      for (let a = 0; a < Math.PI * 2; a += 0.2) expect(inStructure(s, Math.cos(a) * PLAZA_R, Math.sin(a) * PLAZA_R, 0.3)).toBe(false);
      // Inside the walls.
      expect(Math.abs(s.pos[0]) + Math.hypot(s.w, s.d) / 2).toBeLessThan(BOUNDS);
      expect(Math.abs(s.pos[2]) + Math.hypot(s.w, s.d) / 2).toBeLessThan(BOUNDS);
    }
  });

  test("tents turn their doors toward the lane", () => {
    for (const s of STRUCTURES.filter((s) => s.kind === "tent")) {
      const front = [Math.sin(s.rot), Math.cos(s.rot)];
      const toLane = [-s.pos[0], 0];
      expect(front[0]! * toLane[0]! + front[1]! * toLane[1]!).toBeGreaterThan(0);
    }
  });

  test("the depth stone faces the way you come up the lane", () => {
    const front = [Math.sin(PILLAR.rot), Math.cos(PILLAR.rot)];
    const toSpawn = [SPAWN[0] - PILLAR.pos[0], SPAWN[2] - PILLAR.pos[2]];
    const len = Math.hypot(toSpawn[0]!, toSpawn[1]!);
    expect((front[0]! * toSpawn[0]! + front[1]! * toSpawn[1]!) / len).toBeGreaterThan(0.99);
  });
});
