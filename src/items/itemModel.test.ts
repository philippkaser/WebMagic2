import { describe, expect, test } from "bun:test";
import { addBuff, liveBuffs, withBlessings } from "./buffs";
import { computeStats, MIN_MAX_HEALTH, resolveItem } from "./catalog";
import { MAX_ENHANCE, splitItemId, withAffixes, withEnhance, withLevel } from "./itemId";
import { amplifyPassives } from "./power";
import { rarityOf } from "./rarity";
import type { Equipment } from "./inventory";

/** The item model's sharp edges: what the forge amplifies, which ids are
 * refused, how rarity reads, what blessings do and don't touch. */

describe("forge amplification", () => {
  test("boons grow, banes and whole counts stay put", () => {
    // fireRateMult up is a boon; damageTakenMult up is a bane; bounces is an integer count.
    const out = amplifyPassives({ fireRateMult: 1.2, damageTakenMult: 1.3, bounces: 2, manaCostMult: 0.8 }, 5);
    expect(out.fireRateMult!).toBeGreaterThan(1.2);
    expect(out.damageTakenMult).toBe(1.3);
    expect(out.bounces).toBe(2);
    // A cheaper spell (manaCostMult below 1) is a boon: it moves further down.
    expect(out.manaCostMult!).toBeLessThan(0.8);
    expect(amplifyPassives({ fireRateMult: 1.2 }, 0)).toEqual({ fireRateMult: 1.2 });
  });
});

describe("item ids", () => {
  test("round-trip level, enhancement and enchantments", () => {
    const id = withEnhance(withLevel(withAffixes("ember_staff", ["keen", "hasty"]), 12), 3);
    expect(id).toBe("ember_staff+keen+hasty@12^3");
    expect(splitItemId(id)).toMatchObject({ baseId: "ember_staff", affixIds: ["keen", "hasty"], level: 12, enhance: 3, wellFormed: true });
  });

  test("hostile and malformed ids are refused", () => {
    for (const bad of [
      "ember_staff^0",
      `ember_staff^${MAX_ENHANCE + 1}`,
      "ember_staff^",
      "ember_staff^3@12",
      "ember_staff@12^3^4",
      "ember_staff+keen+keen",
      "ember_staff++keen",
      "ember_staff+keen+hasty+swift",
      "stormcaller+keen",
      "potion_hp_weak@5",
      "grave_moss^1",
    ]) {
      expect(() => resolveItem(bad)).toThrow();
    }
  });

  test("rarity follows enchantments and legend", () => {
    expect(resolveItem("ember_staff@3").rarity).toBe("common");
    expect(resolveItem("ember_staff+keen@3").rarity).toBe("enchanted");
    expect(resolveItem("ember_staff+keen+hasty@3").rarity).toBe("arcane");
    expect(resolveItem("stormcaller@3").rarity).toBe("legendary");
    expect(rarityOf(resolveItem("grave_moss").def, 0)).toBe("common");
  });
});

describe("stats", () => {
  const kit = (over: Partial<Equipment> = {}): Equipment => ({
    staff: { defId: "apprentice_staff", runLoot: false },
    amulet: null,
    cloak: null,
    boots: null,
    ...over,
  });

  test("max health never drops below the floor, however banes stack", () => {
    const stats = computeStats(
      kit({
        staff: { defId: "apprentice_staff+leeching@1", runLoot: false },
        amulet: { defId: "amulet_focus+leeching+ascetic@1", runLoot: false },
        cloak: { defId: "cloak_warden+ascetic@1", runLoot: false },
      }),
    );
    const blessed = withBlessings(stats, addBuff([], "blood_oath", 0), 1);
    expect(blessed.maxHealth).toBe(MIN_MAX_HEALTH);
  });

  test("the same kit object reuses its stats; blessings never touch them", () => {
    const k = kit();
    const a = computeStats(k);
    expect(computeStats(k)).toBe(a);
    const before = JSON.stringify(a);
    withBlessings(a, addBuff([], "fury", 0), 1);
    expect(JSON.stringify(a)).toBe(before);
  });

  test("drinking again refreshes a blessing rather than stacking it", () => {
    const once = addBuff([], "haste", 0);
    const twice = addBuff(once, "haste", 10_000);
    expect(twice.length).toBe(1);
    expect(twice[0]!.until).toBeGreaterThan(once[0]!.until);
    expect(liveBuffs(twice, twice[0]!.until + 1)).toEqual([]);
  });
});
