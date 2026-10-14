import { describe, expect, test } from "bun:test";
import { Rng } from "../core/rng";
import { resolveItem } from "./catalog";
import { salvageYield } from "./crafting";
import { gamblePrice, sellValue } from "./economy";
import { rollGamble } from "./loot";

describe("the Orb of Fortune can't be farmed", () => {
  test("at every depth, gambling to sell loses on average, and rarely wins", () => {
    const rng = new Rng(7);
    for (let deepest = 0; deepest <= 100; deepest += 10) {
      const price = gamblePrice(deepest);
      let sum = 0;
      let wins = 0;
      const n = 2000;
      for (let i = 0; i < n; i++) {
        const v = sellValue(rollGamble(rng, deepest))!;
        sum += v;
        if (v > price) wins++;
      }
      expect(sum / n).toBeLessThan(price * 0.85);
      expect(wins / n).toBeLessThan(0.1);
    }
  });

  test("gambling then salvaging doesn't print riftglass (only the rare legendary gives any)", () => {
    const rng = new Rng(9);
    for (const deepest of [10, 40, 90]) {
      let glass = 0;
      const n = 2000;
      for (let i = 0; i < n; i++) glass += salvageYield(resolveItem(rollGamble(rng, deepest))).find((s) => s.id === "riftglass")?.qty ?? 0;
      // A riftglass this way costs thousands of gold — far dearer than finding one.
      expect((gamblePrice(deepest) * n) / Math.max(1, glass)).toBeGreaterThan(2000);
    }
  });
});
