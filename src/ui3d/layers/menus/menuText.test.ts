import { describe, expect, test } from "bun:test";
import { layoutText } from "../../font/layout";
import { resolveLost, splitQty } from "./lostItems";
import {
  CONTROLS,
  controlsLegend,
  deathHeadline,
  formatResonance,
  lossSentence,
  lostList,
  sanitizeNameDraft,
  spansText,
} from "./menuText";

describe("menu text", () => {
  test("controls legend: one line per control, actions in a straight column", () => {
    const text = spansText(controlsLegend());
    const lines = text.split("\n");
    expect(lines.length).toBe(CONTROLS.length);
    const col = lines[0]!.indexOf(CONTROLS[0]![1]);
    lines.forEach((line, i) => expect(line.indexOf(CONTROLS[i]![1])).toBe(col));
    expect(layoutText(controlsLegend()).lines).toBe(CONTROLS.length);
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

  test("death headline names the floor and the killer (or the dungeon)", () => {
    expect(spansText(deathHeadline({ floor: 12, killer: "Morgana" }))).toBe("ON FLOOR 12 · SLAIN BY MORGANA");
    expect(spansText(deathHeadline({ floor: 3, killer: null }))).toBe("ON FLOOR 3 · THE DUNGEON TOOK YOU");
    expect(spansText(deathHeadline(null))).toContain("FLOOR ?");
  });

  test("the loss is spelled out, grave or not", () => {
    const base = { floor: 4, killer: null, lostItems: ["Ember Staff"], lostGold: 30, grave: false };
    expect(lostList(base)).toEqual(["Ember Staff", "30 gold"]);
    expect(spansText(lossSentence(base))).toBe("The dungeon keeps what you carried: Ember Staff, 30 gold.");
    expect(spansText(lossSentence({ ...base, grave: true }))).toContain("Your grave holds Ember Staff, 30 gold");
    expect(spansText(lossSentence({ ...base, lostItems: [], lostGold: 0 }))).toContain("carried nothing");
    expect(spansText(lossSentence(null))).toContain("carried nothing");
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
