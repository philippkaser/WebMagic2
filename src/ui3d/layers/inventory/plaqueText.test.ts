import { describe, expect, test } from "bun:test";
import { ENCHANT_COLOR } from "../../../items/affixes";
import { resolveItem } from "../../../items/catalog";
import type { TextSpan } from "../../font/layout";
import { INK } from "./materials";
import { fortuneText, plaqueText, wornCounterpart } from "./plaqueText";

const plain = (spans: TextSpan[]) => spans.map((s) => s.text).join("");

describe("plaqueText (the item plaque's words)", () => {
  test("name in the item's colour, enchanted names in the enchant colour", () => {
    expect(plaqueText(resolveItem("ember_staff@7"), null).title[0]).toEqual({ text: "Ember Staff", color: "#ff8b3d" });
    const keen = plaqueText(resolveItem("amulet_vigor+keen@5"), null);
    expect(keen.title[0]!.color).toBe(ENCHANT_COLOR);
    expect(keen.accent).toBe(ENCHANT_COLOR);
    expect(plain(keen.body)).toContain("Enchanted: +12% spell damage");
  });

  test("stacks show their count; kind line says what it is", () => {
    const t = plaqueText(resolveItem("potion_hp_weak"), null, { qty: 3 });
    expect(plain(t.title)).toBe("Weak Healing Draught ×3");
    expect(plain(t.body).split("\n")[0]).toBe("Consumable · stacks to 5");
    expect(plain(plaqueText(resolveItem("cloak_blink@6"), null).body).split("\n")[0]).toBe("Cloak · tier 2");
  });

  test("comparison against the worn piece colours the deltas and names it", () => {
    const t = plaqueText(resolveItem("ember_staff@9"), resolveItem("ember_staff@4"));
    const level = t.body.find((s) => s.text.includes("Lv 9"))!;
    expect(level.text.startsWith("▲")).toBe(true);
    expect(level.color).toBe(INK.better);
    expect(plain(t.body)).toContain("vs. worn Ember Staff");
    const worse = plaqueText(resolveItem("ember_staff@2"), resolveItem("ember_staff@8"));
    expect(worse.body.find((s) => s.text.includes("Lv 2"))!.color).toBe(INK.worse);
  });

  test("footnotes: unbanked, Maro's offer, Maro's price", () => {
    const body = plain(plaqueText(resolveItem("amulet_focus@3"), null, { runLoot: true, sellFor: 9 }).body);
    expect(body).toContain("Unbanked — lost if you fall");
    expect(body).toContain("Maro pays 9 gold");
    const ware = plaqueText(resolveItem("save_feather"), null, { price: { gold: 180, affordable: false } });
    expect(plain(ware.body)).toContain("180 gold — not enough");
  });

  test("the Orb of Fortune has its own words", () => {
    expect(plain(fortuneText(65, true).title)).toBe("Orb of Fortune");
    expect(plain(fortuneText(65, true).body)).toContain("65 gold");
  });

  test("wornCounterpart: same slot, different item, never the worn socket itself or a potion", () => {
    const worn = resolveItem("ember_staff@7");
    expect(wornCounterpart(resolveItem("arc_staff@3"), worn, false)?.itemId).toBe("ember_staff@7");
    expect(wornCounterpart(worn, worn, true)).toBeNull();
    expect(wornCounterpart(resolveItem("ember_staff@7"), worn, false)).toBeNull();
    expect(wornCounterpart(resolveItem("potion_hp_weak"), null, false)).toBeNull();
  });
});
