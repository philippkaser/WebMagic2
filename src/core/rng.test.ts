import { describe, expect, test } from "bun:test";
import { hashSeed, Rng } from "./rng";

describe("Rng", () => {
  test("same seed yields the same sequence", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  test("values stay in [0, 1) and int stays in range", () => {
    const rng = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const n = rng.int(3, 9);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(9);
    }
  });

  test("hashSeed is stable and spreads inputs", () => {
    expect(hashSeed("stone")).toBe(hashSeed("stone"));
    expect(hashSeed("stone")).not.toBe(hashSeed("slab"));
  });
});
