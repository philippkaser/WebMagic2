import { describe, expect, test } from "bun:test";
import { spaced } from "./grimoire";
import { itemLook, RARITY_COLOR } from "./itemLook";
import { resolveLost, splitQty } from "./lostItems";
import {
  CONTROLS,
  deathHeadline,
  formatResonance,
  lossVerdict,
  lostList,
  sanitizeNameDraft,
  spansText,
  TENETS,
  wrapRows,
} from "./menuText";

describe("menu text", () => {
  test("every control has a key cap and an action; the three laws are written", () => {
    for (const c of CONTROLS) {
      expect(c.keys.length).toBeGreaterThan(0);
      expect(c.action.length).toBeGreaterThan(0);
    }
    expect(TENETS.map((t) => t.title)).toEqual(["The Weighing Gate", "The Tithe of Five", "Friend or Foe"]);
  });

  test("rows wrap greedily and never overflow (unless one item alone is wider)", () => {
    expect(wrapRows([10, 10, 10], 100, 5)).toEqual([[0, 1, 2]]);
    expect(wrapRows([40, 40, 40], 100, 5)).toEqual([[0, 1], [2]]);
    expect(wrapRows([150, 10], 100, 5)).toEqual([[0], [1]]);
    expect(wrapRows([], 100, 5)).toEqual([]);
    const widths = [12, 30, 25, 8, 40, 33, 19, 27];
    for (const row of wrapRows(widths, 70, 4)) {
      const w = row.reduce((s, i) => s + widths[i]!, 0) + 4 * (row.length - 1);
      expect(w <= 70 || row.length === 1).toBe(true);
    }
  });

  test("labels are plain caps (no tracking: Silkscreen is wide already)", () => {
    expect(spaced("Your name")).toBe("YOUR NAME");
  });

  test("name drafts are filtered like the committed name, without trimming", () => {
    expect(sanitizeNameDraft("Mor<gana>!")).toBe("Morgana");
    expect(sanitizeNameDraft("Old Pell ")).toBe("Old Pell ");
    expect(sanitizeNameDraft("a".repeat(30)).length).toBe(16);
    expect(sanitizeNameDraft("O'Brannoc-2")).toBe("O'Brannoc-2");
  });

  test("resonance keeps one decimal", () => {
    expect(formatResonance(7)).toBe("7.0");
    expect(formatResonance(7.25)).toBe("7.3");
    expect(formatResonance(0)).toBe("0.0");
  });

  test("death headline names the killer (or the dungeon), the floor and its band", () => {
    expect(spansText(deathHeadline({ floor: 12, killer: "Morgana" }, "The Drowned Halls"))).toBe(
      "Slain by Morgana on floor 12 — The Drowned Halls",
    );
    expect(spansText(deathHeadline({ floor: 3, killer: null }, null))).toBe("The dungeon claimed you on floor 3");
    expect(spansText(deathHeadline(null, null))).toContain("floor ?");
  });

  test("the verdict says where the loss went, grave or not", () => {
    const base = { floor: 4, killer: null, lostItems: ["Ember Staff"], lostGold: 30, grave: false };
    expect(lostList(base)).toEqual(["Ember Staff", "30 gold"]);
    expect(lossVerdict(base).label).toBe("The dungeon keeps what you carried");
    expect(lossVerdict({ ...base, grave: true }).label).toBe("Your grave keeps what you carried");
    expect(lossVerdict({ ...base, grave: true }).lore).toContain("waits below");
    expect(lossVerdict({ ...base, lostItems: [], lostGold: 0 })).toEqual({ label: null, lore: expect.stringContaining("carried nothing") });
    expect(lossVerdict(null).label).toBeNull();
  });

  test("item cards borrow the rarity scale: tier, enchantment", () => {
    expect(itemLook("ember_staff")?.color).toBeDefined();
    expect(itemLook("ember_staff+keen")?.color).toBe(RARITY_COLOR.epic);
    expect(itemLook("ember_staff+keen")?.name).toBe("Keen Ember Staff");
    expect(itemLook("no_such_thing")).toBeNull();
  });
});

describe("lost items", () => {
  test("quantities split off display names", () => {
    expect(splitQty("Weak Healing Draught ×3")).toEqual({ name: "Weak Healing Draught", qty: 3 });
    expect(splitQty("Ember Staff")).toEqual({ name: "Ember Staff", qty: 1 });
  });

  test("ids from the fall event win when they match the record", () => {
    const things = resolveLost(["Ember Staff"], [{ id: "ember_staff@9", qty: 1 }]);
    expect(things).toEqual([{ id: "ember_staff@9", qty: 1, name: "Ember Staff" }]);
  });

  test("names alone resolve through the catalog, affixes included; unknowns keep a slot", () => {
    const [plain, enchanted, potion, unknown] = resolveLost(
      ["Ember Staff", "Keen Ember Staff", "Weak Healing Draught ×2", "The Moon"],
      [{ id: "ember_staff", qty: 1 }], // stale event: ignored (length mismatch)
    );
    expect(plain!.id).toBe("ember_staff");
    expect(enchanted!.id).toBe("ember_staff+keen");
    expect(potion!.qty).toBe(2);
    expect(potion!.id).not.toBeNull();
    expect(unknown).toEqual({ id: null, qty: 1, name: "The Moon" });
  });
});
