import { describe, expect, test } from "bun:test";
import { chainPath, coneHits, lightningPoints, raySphere, rayHits, sweptHits, type HitTarget } from "./hitscan";

const v = (x: number, y: number, z: number) => ({ x, y, z });
const T = (x: number, z: number, radius = 0.5, ref = `${x},${z}`): HitTarget<string> => ({ pos: v(x, 1, z), radius, ref });

describe("hitscan geometry", () => {
  test("raySphere: entry distance, inside, behind, miss", () => {
    expect(raySphere(v(0, 0, 0), v(1, 0, 0), v(5, 0, 0), 1)).toBeCloseTo(4);
    expect(raySphere(v(5, 0, 0), v(1, 0, 0), v(5, 0, 0), 1)).toBe(0);
    expect(raySphere(v(0, 0, 0), v(-1, 0, 0), v(5, 0, 0), 1)).toBeNull();
    expect(raySphere(v(0, 0, 0), v(1, 0, 0), v(5, 3, 0), 1)).toBeNull();
  });

  test("rayHits: nearest first, capped by the wall distance", () => {
    const targets = [T(8, 0), T(3, 0), T(5, 4), T(14, 0)];
    const hits = rayHits(v(0, 1, 0), v(1, 0, 0), 10, targets);
    expect(hits.map((h) => h.target.ref)).toEqual(["3,0", "8,0"]);
    // A forgiving beam catches the near miss.
    expect(rayHits(v(0, 1, 0), v(1, 0, 0), 10, [T(5, 0.9)], 0.5).length).toBe(1);
    expect(rayHits(v(0, 1, 0), v(1, 0, 0), 10, [T(5, 0.9)]).length).toBe(0);
  });

  test("coneHits: inside the cone and range only, widened by body size", () => {
    const targets = [T(4, 0), T(4, 1), T(4, 3), T(9, 0), T(-3, 0)];
    const hits = coneHits(v(0, 1, 0), v(1, 0, 0), 6.5, (22 * Math.PI) / 180, targets);
    expect(hits.map((h) => h.target.ref)).toEqual(["4,0", "4,1"]);
    expect(hits[0]!.centred).toBeGreaterThan(hits[1]!.centred);
    // A big body at the cone's edge still gets singed.
    expect(coneHits(v(0, 1, 0), v(1, 0, 0), 6.5, 0.38, [T(4, 2.2, 1.6)]).length).toBe(1);
  });

  test("chainPath: nearest unstruck within range, never twice", () => {
    const a = T(0, 0);
    const b = T(3, 0);
    const c = T(6, 0);
    const far = T(30, 0);
    const path = chainPath(a, [a, b, c, far], 5, 4);
    expect(path.map((t) => t.ref)).toEqual(["0,0", "3,0", "6,0"]);
    expect(chainPath(a, [a, b, c], 1, 4).length).toBe(2);
  });

  test("sweptHits: what a moving bolt touched, in travel order", () => {
    const hits = sweptHits(v(0, 1, 0), v(10, 1, 0), 0.15, [T(7, 0.4), T(2, 0), T(5, 3)]);
    expect(hits.map((h) => h.ref)).toEqual(["2,0", "7,0.4"]);
  });

  test("lightningPoints: exact ends, jagged middle", () => {
    let i = 0;
    const rand = () => [0.9, 0.1, 0.5, 0.2, 0.8, 0.3][i++ % 6]!;
    const pts = lightningPoints(v(0, 0, 0), v(10, 0, 0), 5, 1, rand);
    expect(pts.length).toBe(6);
    expect(pts[0]).toEqual(v(0, 0, 0));
    expect(pts[5]).toEqual(v(10, 0, 0));
    expect(pts.slice(1, 5).some((p) => Math.abs(p.y) > 0.1 || Math.abs(p.z) > 0.1)).toBe(true);
  });
});
