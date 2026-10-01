import { describe, expect, test } from "bun:test";
import { resolveItem } from "../../../items/catalog";
import type { TextSpan } from "../../font/layout";
import { GRADES } from "./grade";
import { INK } from "./materials";
import { fortuneText, plaqueText, quickHint, wornCounterpart } from "./plaqueText";

const plain = (spans: TextSpan[]) => spans.map((s) => s.text).join("");
const notes = (t: ReturnType<typeof plaqueText>) => t.notes.map((n) => plain(n.text));

describe("plaqueText (the item plaque's words)", () => {
  test("name in its grade's colour; enchanted names violet, with the enchantment first", () => {
    expect(plaqueText(resolveItem("ember_staff@7"), null).title[0]).toEqual({ text: "Ember Staff", color: GRADES.rare.color });
    expect(plaqueText(resolveItem("apprentice_staff@1"), null).title[0]!.color).toBe(GRADES.common.color);
    const keen = plaqueText(resolveItem("amulet_vigor+keen@5"), null);
    expect(keen.title[0]!.color).toBe(GRADES.enchanted.color);
    expect(keen.gem).toBe(GRADES.enchanted.color);
    expect(plain(keen.stats).split("\n")[0]).toBe("Enchanted: +12% spell damage");
  });

  test("stacks show their count; the small-caps line says what it is", () => {
    const t = plaqueText(resolveItem("potion_hp_weak"), null, { qty: 3 });
    expect(plain(t.title)).toBe("Weak Healing Draught ×3");
    expect(plain(t.sub)).toBe("CONSUMABLE · STACKS TO 5");
    expect(t.statsHead).toBe("EFFECT");
    expect(plain(plaqueText(resolveItem("cloak_blink@6"), null).sub)).toBe("RARE · CLOAK · LV 6");
    expect(plain(plaqueText(resolveItem("cloak_blink+swift@6"), null).sub)).toBe("ENCHANTED · CLOAK · TIER 2 · LV 6");
  });

  test("comparison against the worn piece colours the deltas and names it", () => {
    const t = plaqueText(resolveItem("ember_staff@9"), resolveItem("ember_staff@4"));
    expect(t.statsHead).toBe("IF EQUIPPED");
    const level = t.stats.find((s) => s.text.includes("Lv 9"))!;
    expect(level.text.startsWith("▲")).toBe(true);
    expect(level.color).toBe(INK.better);
    expect(notes(t)).toContain("vs. worn Ember Staff");
    const worse = plaqueText(resolveItem("ember_staff@2"), resolveItem("ember_staff@8"));
    expect(worse.stats.find((s) => s.text.includes("Lv 2"))!.color).toBe(INK.worse);
    expect(plaqueText(resolveItem("ember_staff@2"), null, { worn: true }).statsHead).toBe("GRANTS");
  });

  test("footnotes: unbanked (hourglass), Maro's offer and price (coin), the quick-move hint", () => {
    const t = plaqueText(resolveItem("amulet_focus@3"), null, { runLoot: true, sellFor: 9, hint: "Shift-click to equip" });
    expect(notes(t)).toEqual(["Unbanked — lost if you fall", "Maro pays 9 gold", "Shift-click to equip"]);
    expect(t.notes[0]!.icon).toBe("hourglass");
    expect(t.notes[1]!.icon).toBe("coin");
    const ware = plaqueText(resolveItem("save_feather"), null, { price: { gold: 180, affordable: false } });
    expect(notes(ware)).toContain("180 gold — not enough");
  });

  test("the legendary get a gold frame, the rest brass", () => {
    expect(plaqueText(resolveItem("voidcore_staff@9"), null).frame).toBe(resolveItem("voidcore_staff@9").def.tier >= 3 ? "gold" : "brass");
    expect(plaqueText(resolveItem("apprentice_staff@1"), null).frame).toBe("brass");
  });

  test("the Orb of Fortune has its own words", () => {
    expect(plain(fortuneText(65, true).title)).toBe("Orb of Fortune");
    expect(plain(fortuneText(65, true).notes[0]!.text)).toBe("65 gold");
  });

  test("quickHint mirrors quickMove's rules, and the staff never moves", () => {
    expect(quickHint({ container: "bag", index: 0 }, false, false)).toBe("Shift-click to equip");
    expect(quickHint({ container: "bag", index: 0 }, true, false)).toBe("Shift-click: onto the belt");
    expect(quickHint({ container: "bag", index: 0 }, false, true)).toBe("Shift-click: into the stash");
    expect(quickHint({ container: "chest", index: 2 }, false, true)).toBe("Shift-click: into the satchel");
    expect(quickHint({ container: "equipment", slot: "cloak" }, false, false)).toBe("Shift-click: into the satchel");
    expect(quickHint({ container: "equipment", slot: "staff" }, false, false)).toBeNull();
  });

  test("wornCounterpart: same slot, different item, never the worn socket itself or a potion", () => {
    const worn = resolveItem("ember_staff@7");
    expect(wornCounterpart(resolveItem("arc_staff@3"), worn, false)?.itemId).toBe("ember_staff@7");
    expect(wornCounterpart(worn, worn, true)).toBeNull();
    expect(wornCounterpart(resolveItem("ember_staff@7"), worn, false)).toBeNull();
    expect(wornCounterpart(resolveItem("potion_hp_weak"), null, false)).toBeNull();
  });
});
