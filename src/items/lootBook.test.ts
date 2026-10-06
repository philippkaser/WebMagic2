import { describe, expect, test } from "bun:test";
import { Rng } from "../core/rng";
import { generateFloor } from "../world/gen";
import type { FloorLayout } from "../world/types";
import { resolveItem, SAVE_FEATHER_ID } from "./catalog";
import { ENEMY_LOOT_CHANCE, rollSourceLoot, treasureItem } from "./dropTables";
import { LootBook, TREASURE_ORB } from "./lootBook";

const NO_OMEN = { lootChanceMult: 1, goldMult: 1 };

/** A floor with at least one slime and one prop (deep enough for slimes). */
function slimeFloor(): FloorLayout {
  for (let seed = 1; seed < 500; seed++) {
    const layout = generateFloor(seed, 12);
    if (layout.enemies.some((e) => e.kind === "slime") && layout.props.length > 0) return layout;
  }
  throw new Error("no slime floor found");
}

describe("drop tables", () => {
  test("a monster drops an item about a quarter of the time, and coins more often", () => {
    const rng = new Rng(1);
    let items = 0;
    let golds = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      for (const d of rollSourceLoot(rng, { kind: "enemy", enemy: "wisp", gen: 0 }, 5, NO_OMEN)) {
        if (d.itemId) items++;
        else golds++;
      }
    }
    expect(items / n).toBeCloseTo(ENEMY_LOOT_CHANCE, 1);
    expect(golds / n).toBeCloseTo(0.6, 1);
  });

  test("a slime drops items only when it dies for good", () => {
    const rng = new Rng(2);
    for (let i = 0; i < 2000; i++) {
      for (const gen of [0, 1]) {
        const drops = rollSourceLoot(rng, { kind: "enemy", enemy: "slime", gen }, 8, NO_OMEN);
        expect(drops.every((d) => d.itemId === null)).toBe(true);
      }
    }
  });

  test("the Warden always leaves two deeper items and gold, sometimes a feather", () => {
    const rng = new Rng(3);
    let withFeather = 0;
    for (let i = 0; i < 2000; i++) {
      const drops = rollSourceLoot(rng, { kind: "boss" }, 10, NO_OMEN);
      const items = drops.filter((d) => d.itemId);
      // Two rolled items (a roll may itself be a feather), plus the bonus one.
      expect(items.length === 2 || items.length === 3).toBe(true);
      if (items.length === 3) {
        withFeather++;
        expect(items[2].itemId).toBe(SAVE_FEATHER_ID);
      }
      for (const d of items) expect(resolveItem(d.itemId!).level).toBeLessThanOrEqual(13);
      expect(drops.some((d) => d.gold > 0)).toBe(true);
    }
    expect(withFeather / 2000).toBeCloseTo(0.35, 1);
  });

  test("the omen scales item chances and gold amounts", () => {
    const count = (mult: number) => {
      const rng = new Rng(4);
      let items = 0;
      for (let i = 0; i < 20_000; i++) {
        items += rollSourceLoot(rng, { kind: "prop", prop: "pot" }, 3, { lootChanceMult: mult, goldMult: 1 })
          .filter((d) => d.itemId).length;
      }
      return items;
    };
    expect(count(1.7) / count(1)).toBeCloseTo(1.7, 0);
  });
});

describe("the loot book", () => {
  test("every source the floor holds rolls once; anything else rolls nothing", () => {
    const layout = generateFloor(31, 10); // a boss floor
    const book = new LootBook(layout, new Rng(1));
    expect(book.roll("e0")).not.toBeNull();
    expect(book.roll("e0")).toBeNull(); // the same kill twice
    expect(book.roll(`p${layout.props.length - 1}`)).not.toBeNull();
    expect(book.roll(`e${layout.enemies.length}`)).toBeNull(); // no such enemy
    expect(book.roll("p99999")).toBeNull();
    expect(book.roll("totally_made_up")).toBeNull();
    const boss = book.roll("boss")!;
    expect(boss.length).toBeGreaterThanOrEqual(3);
    expect(book.roll("boss")).toBeNull();
    // Only a boss floor has a boss to roll.
    expect(new LootBook(generateFloor(31, 9), new Rng(1)).roll("boss")).toBeNull();
  });

  test("a claimed description is trusted for slime splits only, within the budget", () => {
    const layout = slimeFloor();
    const slimes = layout.enemies.filter((e) => e.kind === "slime").length;
    const book = new LootBook(layout, new Rng(2));
    const split = (gen: number) => book.roll(`s${Math.random()}`, { kind: "enemy", enemy: "slime", gen });
    for (let i = 0; i < slimes * 2; i++) expect(split(1)).not.toBeNull();
    expect(split(1)).toBeNull(); // every slime has split already
    for (let i = 0; i < slimes * 4; i++) expect(split(2)).not.toBeNull();
    expect(split(2)).toBeNull();
    expect(split(0)).toBeNull(); // generation 0 is a layout slime, with a layout id
    expect(split(3)).toBeNull();
    expect(book.roll("s1", { kind: "boss" })).toBeNull();
    expect(book.roll("s2", { kind: "enemy", enemy: "wisp", gen: 1 })).toBeNull();
  });

  test("an orb is claimed once; the treasure is an orb from the start", () => {
    const layout = generateFloor(7, 4);
    const book = new LootBook(layout, new Rng(3));
    expect(book.claim(TREASURE_ORB)).toEqual({ itemId: treasureItem(layout.seed, layout.floor), gold: 0 });
    expect(book.claim(TREASURE_ORB)).toBeNull();
    const gift = book.issue("amulet_vigor@3", 0, "d");
    expect(gift.orbId.startsWith("d")).toBe(true);
    expect(book.claim(gift.orbId)).toEqual({ itemId: "amulet_vigor@3", gold: 0 });
    expect(book.claim(gift.orbId)).toBeNull();
    expect(book.claim("o404")).toBeNull();
  });
});
