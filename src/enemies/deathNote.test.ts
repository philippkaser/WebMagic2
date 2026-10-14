import { describe, expect, test } from "bun:test";
import { encodeDeath, MAX_KILLER_ID, MAX_OVERKILL, readDeath } from "./deathNote";

describe("the death note", () => {
  test("round-trips the killer, a unit direction and overkill", () => {
    const n = readDeath(encodeDeath("p7", 30, -40, 0.5));
    expect(n).not.toBeNull();
    expect(n!.by).toBe("p7");
    expect(n!.dir![0]).toBeCloseTo(0.6, 2);
    expect(n!.dir![1]).toBeCloseTo(-0.8, 2);
    expect(n!.over).toBeCloseTo(0.5, 2);
  });

  test("a blow with no planar push has no direction", () => {
    expect(readDeath(encodeDeath("", 0, 0, 0))!.dir).toBeNull();
    expect(readDeath(encodeDeath("", 0, 1e-9, 0))!.dir).toBeNull();
  });

  test("clamps overkill and drops what isn't a note", () => {
    expect(readDeath(encodeDeath("a", 1, 0, 99))!.over).toBe(MAX_OVERKILL);
    expect(readDeath({ by: "a", d: [1, 0], o: -3 })!.over).toBe(0);
    expect(readDeath({ by: "a", d: [1, 0], o: NaN })!.over).toBe(0);
    expect(readDeath(null)).toBeNull();
    expect(readDeath("kill")).toBeNull();
    expect(readDeath({ d: [1, 0], o: 0 })).toBeNull();
    expect(readDeath({ by: "x".repeat(MAX_KILLER_ID + 1), d: [1, 0], o: 0 })).toBeNull();
  });

  test("hostile directions are tamed: non-finite dropped, long ones renormalised", () => {
    expect(readDeath({ by: "a", d: [Infinity, 0], o: 0 })!.dir).toBeNull();
    expect(readDeath({ by: "a", d: [1], o: 0 })!.dir).toBeNull();
    const long = readDeath({ by: "a", d: [30, 40], o: 0 })!.dir!;
    expect(Math.hypot(long[0], long[1])).toBeCloseTo(1, 6);
  });

  test("ids are cut to the wire limit when written", () => {
    expect(encodeDeath("y".repeat(200), 1, 0, 0).by.length).toBe(MAX_KILLER_ID);
  });
});
