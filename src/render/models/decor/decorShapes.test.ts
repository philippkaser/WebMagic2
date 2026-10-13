import { describe, expect, test } from "bun:test";
import { BufferGeometry, Vector3 } from "three";
import { ARCHITECTURE, WALL_HEIGHT } from "../../../core/config";
import { generateFloor } from "../../../world/gen";
import { allDecorDefs } from "../../../world/decor";
import type { BiomeId, DoorwaySpawn } from "../../../world/types";
import { HANG_FLOOR } from "../../../world/gen/dressing";
import { doorArch } from "../archStoneMesh";
import { bakeDecor } from "./decorBake";
import { decorTemplate, doorLeafParts, portcullisParts } from "./decorShapes";

/** The shapes must keep the promises the generator made about them: a
 * hanging piece never reaches below its `hang`, a wall piece stays on its
 * wall within its width and height, a floor piece stays within its
 * footprint, and the doorway iron stays out of the clear opening. */

const BIOMES: BiomeId[] = ["catacombs", "drowned", "forge", "crystal", "hollow"];

function bounds(geos: BufferGeometry[]): { min: Vector3; max: Vector3; maxR: number } {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  let maxR = 0;
  for (const g of geos) {
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const v = new Vector3(p.getX(i), p.getY(i), p.getZ(i));
      min.min(v);
      max.max(v);
      maxR = Math.max(maxR, Math.hypot(v.x, v.z));
    }
  }
  return { min, max, maxR };
}

describe("decor templates", () => {
  for (const def of allDecorDefs()) {
    test(`${def.kind}: every shape fits what the generator promised`, () => {
      for (const biome of BIOMES) {
        for (let v = 0; v < def.variants; v++) {
          const t = decorTemplate(def.kind, v, biome);
          expect(t.parts.length).toBeGreaterThan(0);
          for (const part of t.parts) {
            const g = part.geo;
            expect(g.index).toBeNull();
            for (const name of ["position", "normal", "uv"]) expect(g.getAttribute(name)).toBeDefined();
            for (const x of g.getAttribute("uv").array as Float32Array) expect(x >= 0 && x <= 1).toBe(true);
          }
          const b = bounds(t.parts.map((p) => p.geo));
          const big = def.scale[1];
          if (def.hang !== undefined) {
            expect(b.max.y).toBeLessThanOrEqual(0.001);
            expect(-b.min.y * big).toBeLessThanOrEqual(def.hang + 1e-6);
            expect(WALL_HEIGHT + b.min.y * big).toBeGreaterThanOrEqual(HANG_FLOOR);
          } else if (def.wall) {
            expect(b.min.z).toBeGreaterThanOrEqual(-0.01);
            expect(b.max.z * big).toBeLessThan(0.45);
            expect(b.min.y * def.scale[0]).toBeGreaterThanOrEqual(def.wall.y0 - 0.05);
            expect(b.max.y * big).toBeLessThanOrEqual(def.wall.y1 + 0.2);
            expect(Math.max(-b.min.x, b.max.x)).toBeLessThanOrEqual(def.wall.halfWidth + 0.08);
          } else if (def.mounts.includes("upperCorner")) {
            expect(b.max.y).toBeLessThanOrEqual(0.001);
            expect(-b.min.y * big).toBeLessThan(WALL_HEIGHT - HANG_FLOOR);
          } else {
            // Floor pieces: on the floor, within their footprint (plus a
            // knuckle's grace), and low unless they live in corners.
            // (Heaps, rubble and crystal roots sit half buried.)
            const buried = def.kind === "rubble" || def.kind === "slag" || def.kind === "spur";
            expect(b.min.y).toBeGreaterThanOrEqual(buried ? -0.25 : -0.03);
            expect(b.maxR * big).toBeLessThanOrEqual(def.radius * big + 0.2);
            const tall = def.kind === "kelp" || def.kind === "brazier" || def.kind === "anvil" || def.kind === "spur";
            if (!tall) expect(b.max.y * big).toBeLessThan(0.6);
          }
          // Fires burn where the piece is.
          for (const f of t.flames) expect(f.scale).toBeGreaterThan(0);
        }
      }
    });
  }
});

describe("doorway iron and wood", () => {
  const doors: DoorwaySpawn[] = [
    { axis: "x", face: 4, from: -2, to: 0, inward: -1, style: "portcullis", hinge: -1 },
    { axis: "z", face: -6, from: 2, to: 6, inward: 1, style: "door", hinge: 1 },
    { axis: "x", face: -10, from: 6, to: 10, inward: 1, style: "door", hinge: -1 },
    { axis: "z", face: 8, from: -4, to: -2, inward: -1, style: "portcullis", hinge: 1 },
  ];
  const local = (d: DoorwaySpawn, v: Vector3) => ({
    along: d.axis === "x" ? v.x : v.z,
    into: ((d.axis === "x" ? v.z : v.x) - d.face) * d.inward,
    y: v.y,
  });

  test("a raised portcullis hangs in the slot, its spikes above head height", () => {
    for (const d of doors) {
      const { crownY } = doorArch(d.to - d.from);
      for (const part of portcullisParts(d, "catacombs")) {
        const p = part.geo.getAttribute("position");
        for (let i = 0; i < p.count; i++) {
          const l = local(d, new Vector3(p.getX(i), p.getY(i), p.getZ(i)));
          expect(l.into).toBeLessThan(0);
          expect(l.into).toBeGreaterThan(-ARCHITECTURE.headerDepth);
          expect(l.along).toBeGreaterThanOrEqual(d.from);
          expect(l.along).toBeLessThanOrEqual(d.to);
          expect(l.y).toBeGreaterThan(crownY - 0.8);
          expect(l.y).toBeGreaterThan(2.9);
        }
      }
    }
  });

  test("a broken door leans on the wall beside its jamb, out of the opening", () => {
    for (const d of doors) {
      for (const part of doorLeafParts(d)) {
        const p = part.geo.getAttribute("position");
        for (let i = 0; i < p.count; i++) {
          const l = local(d, new Vector3(p.getX(i), p.getY(i), p.getZ(i)));
          expect(l.y).toBeGreaterThanOrEqual(-0.01);
          expect(l.into).toBeGreaterThan(0);
          expect(l.into).toBeLessThan(0.6);
          if (d.hinge < 0) expect(l.along).toBeLessThanOrEqual(d.from + 0.01);
          else expect(l.along).toBeGreaterThanOrEqual(d.to - 0.01);
          const reach = ARCHITECTURE.doorLeaf + ARCHITECTURE.jambWidth;
          expect(Math.min(Math.abs(l.along - d.from), Math.abs(l.along - d.to))).toBeLessThan(reach);
        }
      }
    }
  });
});

describe("baking a floor", () => {
  test("whole floors bake into at most three meshes, with their fires", () => {
    for (const [seed, floor] of [
      [5, 2],
      [77, 13],
      [4242, 26],
      [99, 41],
      [31337, 63],
    ]) {
      const l = generateFloor(seed, floor);
      const b = bakeDecor(l.dressing, l.architecture.doorways, l.biome);
      const meshes = Object.values(b.geometry).filter((g) => g !== null);
      expect(meshes.length).toBeLessThanOrEqual(3);
      if (l.dressing.length) expect(meshes.length).toBeGreaterThan(0);
      for (const g of meshes) {
        const count = g!.getAttribute("position").count;
        expect(count).toBeGreaterThan(0);
        expect(count).toBeLessThan(400_000);
      }
      const burning = l.dressing.filter((d) => d.kind === "candles" || d.kind === "brazier").length;
      expect(b.glows.length).toBeGreaterThanOrEqual(burning);
      expect(b.fires.length).toBeGreaterThanOrEqual(b.glows.length);
      // The shared flame pool holds 128; torches need theirs.
      expect(b.fires.length).toBeLessThan(96);
    }
  });
});
