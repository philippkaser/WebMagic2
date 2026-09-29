import { describe, expect, test } from "bun:test";
import { Rng } from "../core/rng";
import { allLoreFragments, getLoreFragment, loreFragmentsForFloor, pickLoreFragment } from "./lore";

const fragments = allLoreFragments();

describe("lore fragments", () => {
  test("there is a real body of lore with unique ids", () => {
    expect(fragments.length).toBeGreaterThanOrEqual(30);
    const ids = fragments.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(getLoreFragment(id).id).toBe(id);
    expect(() => getLoreFragment("no-such-rune")).toThrow();
  });

  test("every fragment is titled, one to four sentences, with a sane depth band", () => {
    for (const f of fragments) {
      expect(f.title.trim().length).toBeGreaterThan(0);
      expect(f.text.trim().length).toBeGreaterThan(0);
      const sentences = f.text.split(/[.!?]+(?:\s+|$)/).filter((s) => s.trim().length > 0);
      expect(sentences.length).toBeGreaterThanOrEqual(1);
      expect(sentences.length).toBeLessThanOrEqual(4);
      expect(f.minFloor).toBeGreaterThanOrEqual(1);
      expect(f.minFloor).toBeLessThanOrEqual(100);
      if (f.maxFloor !== undefined) {
        expect(f.maxFloor).toBeGreaterThanOrEqual(f.minFloor);
        expect(f.maxFloor).toBeLessThanOrEqual(100);
      }
    }
  });

  test("never speaks in UI terms", () => {
    const banned = [/\bHP\b/, /\bMP\b/, /checkpoint/i, /\bfloor \d/i, /\blevel \d/i, /\bXP\b/];
    for (const f of fragments) {
      for (const re of banned) expect(`${f.title} ${f.text}`).not.toMatch(re);
    }
  });

  test("every depth has something to read, spread across the whole dungeon", () => {
    for (let floor = 1; floor <= 100; floor++) {
      expect(loreFragmentsForFloor(floor).length).toBeGreaterThanOrEqual(3);
    }
    // Deep lore exists and shallow floors can't read it.
    const deepest = fragments.filter((f) => f.minFloor >= 80);
    expect(deepest.length).toBeGreaterThan(0);
    for (const f of deepest) expect(loreFragmentsForFloor(10)).not.toContain(f);
  });

  test("the picker is deterministic, depth-valid and honours exclusions", () => {
    for (const floor of [1, 9, 18, 33, 47, 70, 100]) {
      const a = pickLoreFragment(new Rng(floor * 31), floor);
      const b = pickLoreFragment(new Rng(floor * 31), floor);
      expect(a).not.toBeNull();
      expect(a).toBe(b);
      expect(loreFragmentsForFloor(floor)).toContain(a!);

      const all = new Set(loreFragmentsForFloor(floor).map((f) => f.id));
      expect(pickLoreFragment(new Rng(1), floor, all)).toBeNull();
      const rng = new Rng(floor);
      for (let i = 0; i < 50; i++) {
        const pick = pickLoreFragment(rng, floor, new Set([a!.id]));
        expect(pick?.id).not.toBe(a!.id);
      }
    }
  });

  test("deep floors mostly speak of deep things", () => {
    const rng = new Rng(2024);
    let recent = 0;
    for (let i = 0; i < 400; i++) {
      if (pickLoreFragment(rng, 90)!.minFloor >= 55) recent++;
    }
    expect(recent / 400).toBeGreaterThan(0.6);
  });
});
