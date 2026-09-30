import { describe, expect, test } from "bun:test";
import { Rng } from "../core/rng";
import { allItemDefs, BASIC_STAFF_ID } from "./catalog";
import {
  defaultEquipment,
  emptyLoadout,
  equipFrom,
  pickUp,
  settleDeath,
  settleExtraction,
  unequip,
  type Loadout,
} from "./inventory";
import { rollItem } from "./loot";
import { computeStats, gearLevel, itemPower } from "./stats";
import type { ItemInstance } from "./types";

const item = (defId: string, level: number, runLoot: boolean, uid = defId + level): ItemInstance => ({
  uid,
  defId,
  level,
  rarity: "common",
  runLoot,
});

describe("loot rolls", () => {
  test("level tracks the floor and ids are unique", () => {
    const rng = new Rng(42);
    const uids = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const it = rollItem(rng, 20);
      expect(it.level).toBeGreaterThanOrEqual(19);
      expect(it.level).toBeLessThanOrEqual(22);
      expect(it.runLoot).toBe(true);
      uids.add(it.uid);
    }
    expect(uids.size).toBe(400);
  });

  test("items never roll below their minimum floor", () => {
    const rng = new Rng(7);
    const defs = new Map(allItemDefs().map((d) => [d.id, d]));
    for (let i = 0; i < 500; i++) {
      const it = rollItem(rng, 2);
      expect(defs.get(it.defId)!.minFloor).toBeLessThanOrEqual(2);
    }
  });

  test("bonus rolls (bosses) are never common", () => {
    const rng = new Rng(9);
    for (let i = 0; i < 100; i++) expect(rollItem(rng, 10, 2).rarity).not.toBe("common");
  });
});

describe("stats & gear level", () => {
  test("starter kit is gear level 1", () => {
    expect(gearLevel(defaultEquipment())).toBe(1);
  });

  test("higher-level staffs hit harder; rarity multiplies power", () => {
    const base = defaultEquipment();
    const strong = { ...base, staff: item(BASIC_STAFF_ID, 10, false) };
    expect(computeStats(strong).damageMult).toBeGreaterThan(computeStats(base).damageMult);
    expect(itemPower({ ...strong.staff, rarity: "legendary" })).toBe(15);
  });

  test("gear level averages all four slots (empty slots count as 0)", () => {
    const e = {
      staff: item("ember_staff", 8, false),
      amulet: item("amulet_vigor", 8, false),
      cloak: null,
      boots: item("worn_boots", 8, false),
    };
    expect(gearLevel(e)).toBe(6);
    expect(gearLevel({ ...e, cloak: item("cloak_warden", 8, false) })).toBe(8);
  });
});

describe("inventory economy", () => {
  function midRun(): Loadout {
    // Brought a banked lvl-5 staff in, found a lvl-9 staff and swapped.
    let l: Loadout = { ...emptyLoadout(), stash: [item("amulet_focus", 3, false)] };
    l = { ...l, equipment: { ...l.equipment, staff: item("ember_staff", 5, false) } };
    l = pickUp(l, item("arc_staff", 9, true)).loadout;
    l = equipFrom(l, "arc_staff9", "satchel");
    l = pickUp(l, item("cloak_warden", 9, true)).loadout; // empty slot → auto-equip
    l = pickUp(l, item("boots_hover", 8, true)).loadout;
    return l;
  }

  test("picking up fills an empty optional slot, else the satchel", () => {
    const l = midRun();
    expect(l.equipment.cloak?.defId).toBe("cloak_warden");
    expect(l.satchel.map((i) => i.defId).sort()).toEqual(["boots_hover", "ember_staff"]);
  });

  test("death takes every run item and nothing else", () => {
    const { loadout, lost } = settleDeath(midRun());
    expect(lost.map((i) => i.defId).sort()).toEqual(["arc_staff", "boots_hover", "cloak_warden"]);
    // The banked staff that was carried in the satchel comes home and is re-equipped.
    expect(loadout.equipment.staff.defId).toBe("ember_staff");
    expect(loadout.equipment.cloak).toBeNull();
    expect(loadout.satchel).toHaveLength(0);
    expect(loadout.stash.map((i) => i.defId)).toEqual(["amulet_focus"]);
  });

  test("death with nothing banked refills with starter gear", () => {
    let l = emptyLoadout();
    l = pickUp(l, item("boots_hover", 3, true)).loadout;
    l = equipFrom(l, "boots_hover3", "satchel");
    const { loadout } = settleDeath(l);
    expect(loadout.equipment.boots.defId).toBe("worn_boots");
  });

  test("extraction keeps everything and unpacks the satchel", () => {
    const { loadout, gained } = settleExtraction(midRun());
    expect(gained).toHaveLength(3);
    expect(loadout.satchel).toHaveLength(0);
    const all = [loadout.equipment.staff, loadout.equipment.cloak!, ...loadout.stash];
    expect(all.every((i) => !i.runLoot)).toBe(true);
    expect(loadout.stash.map((i) => i.defId).sort()).toEqual(["amulet_focus", "boots_hover", "ember_staff"]);
  });

  test("unequipping moves the item to the chosen container", () => {
    const l = unequip(midRun(), "cloak", "satchel");
    expect(l.equipment.cloak).toBeNull();
    expect(l.satchel.some((i) => i.defId === "cloak_warden")).toBe(true);
  });
});
