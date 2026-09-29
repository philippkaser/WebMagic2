import { describe, expect, test } from "bun:test";
import { BAG_SLOTS, BELT_SLOTS, emptyGrid } from "../items/inventory";
import { bankKit, settleDeath, type CarriedKit } from "./outcomes";

function kit(): CarriedKit {
  const bag = emptyGrid(BAG_SLOTS);
  bag[0] = { defId: "amulet_focus@4", qty: 1, runLoot: true };
  bag[1] = { defId: "cloak_shadow", qty: 1, runLoot: false };
  const belt = emptyGrid(BELT_SLOTS);
  belt[0] = { defId: "potion_hp_weak", qty: 3, runLoot: true };
  return {
    equipment: {
      staff: { defId: "ember_staff+keen@5", runLoot: true },
      amulet: { defId: "amulet_vigor", runLoot: false },
      cloak: { defId: "cloak_warden@5", runLoot: true },
      boots: { defId: "worn_boots", runLoot: false },
    },
    bag,
    belt,
  };
}

describe("run outcomes", () => {
  test("dying keeps gear from home and loses everything found this run", () => {
    const out = settleDeath(kit(), "apprentice_staff");
    expect(out.kept.equipment.staff).toEqual({ defId: "apprentice_staff", runLoot: false });
    expect(out.kept.equipment.amulet).toEqual({ defId: "amulet_vigor", runLoot: false });
    expect(out.kept.equipment.cloak).toBeNull();
    expect(out.kept.equipment.boots).toEqual({ defId: "worn_boots", runLoot: false });
    expect(out.kept.bag[0]).toBeNull();
    expect(out.kept.bag[1]).toEqual({ defId: "cloak_shadow", qty: 1, runLoot: false });
    expect(out.kept.belt[0]).toBeNull();
    expect(out.lost).toEqual([
      { id: "ember_staff+keen@5", qty: 1 },
      { id: "cloak_warden@5", qty: 1 },
      { id: "amulet_focus@4", qty: 1 },
      { id: "potion_hp_weak", qty: 3 },
    ]);
    expect(out.lostNames).toContain("Keen Ember Staff");
    expect(out.lostNames).toContain("Weak Healing Draught ×3");
  });

  test("walking home banks everything carried", () => {
    const banked = bankKit(kit());
    expect(banked.equipment.staff.runLoot).toBe(false);
    expect(banked.equipment.cloak!.runLoot).toBe(false);
    expect(banked.bag.every((s) => !s || !s.runLoot)).toBe(true);
    expect(banked.belt.every((s) => !s || !s.runLoot)).toBe(true);
  });
});
