import { describe, expect, test } from "bun:test";
import { RUN } from "../core/config";
import { Rng } from "../core/rng";
import { canExtract, entryFloorFor, entryRange, floorsUntilExtract, newRun } from "./progression";

describe("entry floor from gear", () => {
  test("fresh wizards land at the top", () => {
    const rng = new Rng(1);
    for (let i = 0; i < 50; i++) expect(entryFloorFor(1, rng)).toBeLessThanOrEqual(3);
  });

  test("the rift throws you near your gear level, inside the advertised band", () => {
    const rng = new Rng(2);
    const [lo, hi] = entryRange(20);
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const f = entryFloorFor(20, rng);
      expect(f).toBeGreaterThanOrEqual(lo);
      expect(f).toBeLessThanOrEqual(hi);
      seen.add(f);
    }
    expect(seen.size).toBeGreaterThan(2); // it's a rift, not an elevator
  });

  test("never throws you so deep that extraction is impossible", () => {
    const rng = new Rng(3);
    for (let i = 0; i < 50; i++) expect(entryFloorFor(400, rng)).toBeLessThanOrEqual(100 - RUN.floorsToExtract);
  });
});

describe("extraction", () => {
  test(`homeward rift opens on the ${RUN.floorsToExtract}th floor of a run`, () => {
    const run = newRun(7);
    expect(canExtract(run)).toBe(false);
    run.floorsVisited = RUN.floorsToExtract - 1;
    expect(canExtract(run)).toBe(false);
    expect(floorsUntilExtract(run)).toBe(1);
    run.floorsVisited = RUN.floorsToExtract;
    expect(canExtract(run)).toBe(true);
    expect(canExtract(null)).toBe(false);
  });
});
