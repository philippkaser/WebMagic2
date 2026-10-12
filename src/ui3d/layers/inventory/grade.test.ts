import { describe, expect, test } from "bun:test";
import { allItemDefs, resolveItem } from "../../../items/catalog";
import { isGearSlot } from "../../../items/types";
import { FRAMES } from "../../theme";
import { GRADES, gradeOf } from "./grade";
import { paintSprite, spriteSize } from "./spriteArt";

describe("gradeOf (the item's rarity as the grimoire shows it)", () => {
  test("plain gear is common; one enchantment blue, two violet; uniques amber", () => {
    for (const def of allItemDefs()) {
      if (!isGearSlot(def.slot)) continue;
      if (def.unique) {
        expect(gradeOf(resolveItem(`${def.id}@3`)).id).toBe("legendary");
        continue;
      }
      expect(gradeOf(resolveItem(`${def.id}@3`)).id).toBe("common");
      expect(gradeOf(resolveItem(`${def.id}+keen@3`)).id).toBe("enchanted");
      expect(gradeOf(resolveItem(`${def.id}+keen+vigorous@3`)).id).toBe("arcane");
    }
  });

  test("no grade wears the arcane frame (cyan means 'this socket takes it')", () => {
    for (const g of Object.values(GRADES)) expect(g.frame.trim).not.toBe(FRAMES.arcane.trim);
  });
});

describe("pixel sprites", () => {
  test("paint the tint into the 'a' pixels and leave '.' transparent", () => {
    const { w, h } = spriteSize("gem");
    const data = paintSprite("gem", "#ff0000");
    expect(data.length).toBe(w * h * 4);
    // Row 0 of the bitmap is the top: "..ooo.." → its first pixel is clear.
    const top = (h - 1) * w * 4;
    expect(data[top + 3]).toBe(0);
    // "oaaaaco" (row 3): pixel 1 is the tint.
    const row3 = (h - 1 - 3) * w * 4 + 4;
    expect([data[row3], data[row3 + 1], data[row3 + 2], data[row3 + 3]]).toEqual([255, 0, 0, 255]);
  });
});
