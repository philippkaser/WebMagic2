import { describe, expect, test } from "bun:test";
import { ARCHITECTURE, PLAYER, WALL_HEIGHT } from "../../core/config";
import { generateFloor } from "../../world/gen";
import type { DoorwaySpawn, FloorArchitecture } from "../../world/types";
import { buildArchStone, doorArch, doorwayCollider, pillarCollider } from "./archStoneMesh";

/** The dressed stonework is one mesh built by pure code, so its promises
 * are checked on plain buffers: well-formed, inside the vault, never in a
 * doorway's clear opening, and colliders where the stone is drawn. */

const EMPTY: FloorArchitecture = { pillars: [], ribs: [], shafts: [], crystals: [], doorways: [] };

const door = (over: Partial<DoorwaySpawn> = {}): DoorwaySpawn => ({
  axis: "x",
  face: 4,
  from: -2,
  to: 0,
  inward: -1,
  style: "open",
  hinge: 1,
  ...over,
});

function checkWellFormed(m: ReturnType<typeof buildArchStone>): void {
  const vc = m.positions.length / 3;
  expect(m.normals.length).toBe(vc * 3);
  expect(m.uvs.length).toBe(vc * 2);
  expect(m.indices.length % 6).toBe(0);
  for (const v of m.positions) expect(Number.isFinite(v)).toBe(true);
  for (const v of m.uvs) expect(Number.isFinite(v)).toBe(true);
  for (const i of m.indices) expect(i).toBeLessThan(vc);
  for (let i = 0; i < vc; i++) {
    const len = Math.hypot(m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]);
    expect(len).toBeCloseTo(1, 5);
    // Nothing above the vault or under the floor.
    expect(m.positions[i * 3 + 1]).toBeGreaterThanOrEqual(-1e-6);
    expect(m.positions[i * 3 + 1]).toBeLessThanOrEqual(WALL_HEIGHT + 1e-6);
  }
}

describe("dressed stonework mesh", () => {
  test("nothing planned, nothing built", () => {
    expect(buildArchStone(EMPTY).positions.length).toBe(0);
  });

  test("a doorway's frame keeps its opening clear below the arch", () => {
    for (const d of [door(), door({ from: -2, to: 2 }), door({ axis: "z", face: -6, inward: 1, from: 4, to: 6 })]) {
      const m = buildArchStone({ ...EMPTY, doorways: [d] });
      checkWellFormed(m);
      const { springY, crownY } = doorArch(d.to - d.from);
      expect(crownY).toBeGreaterThan(springY);
      expect(springY).toBeGreaterThan(PLAYER.halfHeight * 2 + PLAYER.radius * 2 + 0.6);
      for (let i = 0; i < m.positions.length; i += 3) {
        const p: [number, number, number] = [m.positions[i], m.positions[i + 1], m.positions[i + 2]];
        const along = d.axis === "x" ? p[0] : p[2];
        const into = ((d.axis === "x" ? p[2] : p[0]) - d.face) * d.inward;
        // Stone stands on the room side (jambs, arch) or in the slot's header.
        expect(into).toBeGreaterThanOrEqual(-ARCHITECTURE.headerDepth - 1e-6);
        expect(into).toBeLessThan(0.6);
        if (along > d.from + 1e-6 && along < d.to - 1e-6) expect(p[1]).toBeGreaterThanOrEqual(springY - 1e-6);
      }
      const c = doorwayCollider(d);
      expect(c.center[1] - c.half[1]).toBeCloseTo(crownY - 0.05, 6);
      expect(c.center[1] + c.half[1]).toBeCloseTo(WALL_HEIGHT, 6);
    }
  });

  test("whole floors: well formed, and small enough to stay one cheap draw", () => {
    for (const [seed, floor] of [
      [7, 3],
      [99, 14],
      [4242, 27],
      [31337, 44],
      [0xbeef, 77],
    ]) {
      const layout = generateFloor(seed, floor);
      const m = buildArchStone(layout.architecture);
      checkWellFormed(m);
      expect(m.positions.length / 3).toBeLessThan(120_000);
      if (layout.architecture.doorways.length) expect(m.positions.length).toBeGreaterThan(0);
    }
  });

  test("a pillar's collider is its base block, floor to vault", () => {
    const c = pillarCollider([3, 0, -5]);
    expect(c.center).toEqual([3, WALL_HEIGHT / 2, -5]);
    expect(c.half).toEqual([ARCHITECTURE.pillarBase, WALL_HEIGHT / 2, ARCHITECTURE.pillarBase]);
  });
});
