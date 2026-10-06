import { describe, expect, test } from "bun:test";
import { Rng } from "../core/rng";
import { OMEN_DEFS } from "../world/omens";
import { isBossFloor } from "../world/gen/pois";
import { SAVE_FEATHER_ID } from "./catalog";
import {
  bossGoldAmount,
  enemyGoldAmount,
  MAX_GOLD_MULT,
  maxGoldDrop,
  propGoldAmount,
} from "./economy";
import { couldDropOn, rollDrop } from "./loot";

/** What a floor can give — the bounds the server holds host-attested pickups
 * to. They must never refuse a legitimate drop, so every roll the game makes
 * is checked against them. */

describe("couldDropOn: a floor's loot, and nothing past it", () => {
  test("every drop a floor rolls — and the Warden's, two floors deeper — passes", () => {
    for (let floor = 1; floor <= 100; floor++) {
      const rng = new Rng(floor * 7919);
      for (let i = 0; i < 60; i++) {
        const drop = rollDrop(rng, floor);
        expect(couldDropOn(drop, floor)).toBe(true);
        if (isBossFloor(floor)) expect(couldDropOn(rollDrop(rng, floor + 2), floor)).toBe(true);
      }
    }
  });

  test("the Warden's feather counts from the first boss floor", () => {
    expect(couldDropOn(SAVE_FEATHER_ID, 10)).toBe(true);
  });

  test("too deep a level, or too deep an item, is refused", () => {
    expect(couldDropOn("void_staff+keen@120", 1)).toBe(false);
    expect(couldDropOn("ember_staff@4", 1)).toBe(true); // floor 1 reaches level 4
    expect(couldDropOn("ember_staff@5", 1)).toBe(false);
    // A legacy id resonates at its catalog depth (void staff: floor 6).
    expect(couldDropOn("void_staff", 2)).toBe(false);
    expect(couldDropOn("void_staff", 3)).toBe(true);
    // Feathers don't drop in the shallows at all.
    expect(couldDropOn(SAVE_FEATHER_ID, 1)).toBe(false);
  });

  test("ids that aren't items are refused", () => {
    expect(couldDropOn("totally_made_up_item", 50)).toBe(false);
    expect(couldDropOn("ember_staff+no_such_affix@3", 50)).toBe(false);
    expect(couldDropOn("ember_staff@abc", 50)).toBe(false);
    expect(couldDropOn("potion_hp_weak@3", 50)).toBe(false); // consumables carry no level
    expect(couldDropOn("potion_hp_weak+keen", 50)).toBe(false); // nor an enchantment
  });
});

describe("maxGoldDrop: the richest orb a floor can drop", () => {
  test("no omen pays more than MAX_GOLD_MULT", () => {
    for (const omen of OMEN_DEFS) expect(omen.rules.goldMult ?? 1).toBeLessThanOrEqual(MAX_GOLD_MULT);
  });

  test("covers every source's roll under the richest omen", () => {
    for (let floor = 1; floor <= 100; floor++) {
      const rng = new Rng(floor);
      for (let i = 0; i < 50; i++) {
        const rolls = [enemyGoldAmount(rng, floor), propGoldAmount(rng, floor)];
        if (isBossFloor(floor)) rolls.push(bossGoldAmount(rng, floor));
        for (const base of rolls) {
          expect(Math.round(base * MAX_GOLD_MULT)).toBeLessThanOrEqual(maxGoldDrop(floor));
        }
      }
    }
  });

  test("is a monster's purse off the boss floors, the Warden's hoard on them", () => {
    expect(maxGoldDrop(1)).toBeLessThan(10);
    expect(maxGoldDrop(10)).toBeGreaterThan(maxGoldDrop(11));
  });
});
