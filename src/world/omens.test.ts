import { describe, expect, test } from "bun:test";
import { NEUTRAL_FLOOR_RULES } from "../game/floorRules";
import { OMEN_DEFS, getOmenDef, omenGenMods, omenRules, rollOmen, omenEffects } from "./omens";
import type { OmenId } from "./types";

const SEEDS = Array.from({ length: 400 }, (_, i) => (i * 2654435761 + 1013904223) >>> 0);

describe("omens", () => {
  test("floor 1 is always calm", () => {
    for (const seed of SEEDS) expect(rollOmen(seed, 1)).toBeNull();
  });

  test("roughly 28% of deeper floors arrive under an omen", () => {
    for (const floor of [2, 3, 7, 10, 25, 50, 99, 100]) {
      const share = SEEDS.filter((s) => rollOmen(s, floor) !== null).length / SEEDS.length;
      expect(share).toBeGreaterThanOrEqual(0.18);
      expect(share).toBeLessThanOrEqual(0.38);
    }
  });

  test("sequential seeds and adjacent floors don't move in lockstep", () => {
    // The side stream is hashed, so neighbouring inputs shouldn't correlate.
    let sameAsNext = 0;
    for (let s = 0; s < 400; s++) if (rollOmen(s, 12) === rollOmen(s + 1, 12)) sameAsNext++;
    expect(sameAsNext / 400).toBeLessThan(0.7);
    let sameAsBelow = 0;
    for (let f = 2; f < 100; f++) if (rollOmen(777, f) !== null && rollOmen(777, f) === rollOmen(777, f + 1)) sameAsBelow++;
    expect(sameAsBelow).toBeLessThan(15);
  });

  test("is deterministic and respects each omen's minimum depth", () => {
    for (const seed of SEEDS.slice(0, 100)) {
      for (const floor of [2, 3, 4, 5, 6, 40]) {
        const omen = rollOmen(seed, floor);
        expect(rollOmen(seed, floor)).toBe(omen);
        if (omen) expect(floor).toBeGreaterThanOrEqual(getOmenDef(omen).minFloor);
      }
    }
  });

  test("every omen turns up somewhere", () => {
    const seen = new Set<OmenId>();
    for (const seed of SEEDS) {
      const omen = rollOmen(seed, 30);
      if (omen) seen.add(omen);
    }
    expect(seen.size).toBe(OMEN_DEFS.length);
  });

  test("table is well-formed: whispers fit, rules are real FloorRules keys", () => {
    const ruleKeys = new Set(Object.keys(NEUTRAL_FLOOR_RULES));
    const ids = OMEN_DEFS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const def of OMEN_DEFS) {
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.whisper.length).toBeGreaterThan(0);
      expect(def.whisper.length).toBeLessThanOrEqual(90);
      expect(def.weight).toBeGreaterThan(0);
      expect(def.minFloor).toBeGreaterThanOrEqual(2);
      for (const [key, value] of Object.entries(def.rules)) {
        expect(ruleKeys.has(key)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
    }
  });

  test("each omen bends exactly the numbers it promises", () => {
    expect(omenRules("weightless")).toEqual({ gravityMult: 0.42 });
    expect(omenGenMods("lightless")).toEqual({ torchMult: 0.35, fogMult: 0.55, barrelBias: 0, enemyCountMult: 1 });
    expect(omenRules("crimson")).toEqual({
      enemyDamageMult: 1.25,
      enemySpeedMult: 1.2,
      lootChanceMult: 1.7,
      goldMult: 1.5,
    });
    expect(omenRules("manatide")).toEqual({ manaRegenMult: 2.2 });
    expect(omenRules("volatile")).toEqual({ explosionRadiusMult: 1.35 });
    expect(omenGenMods("volatile").barrelBias).toBe(0.35);
    expect(omenRules("teeming")).toEqual({ enemyHealthMult: 0.75 });
    expect(omenGenMods("teeming").enemyCountMult).toBe(1.5);
  });

  test("a calm floor has neutral rules and knobs; rule objects are copies", () => {
    expect(omenRules(null)).toEqual({});
    expect(omenGenMods(null)).toEqual({ torchMult: 1, fogMult: 1, barrelBias: 0, enemyCountMult: 1 });
    const rules = omenRules("weightless");
    rules.gravityMult = 99;
    expect(getOmenDef("weightless").rules.gravityMult).toBe(0.42);
  });

  test("unknown ids throw", () => {
    expect(() => getOmenDef("sunny" as OmenId)).toThrow();
  });
});

describe("omen effects in plain words", () => {
  test("a calm floor has none", () => {
    expect(omenEffects(null)).toEqual([]);
  });

  test("every omen says what it does, at least once", () => {
    for (const def of OMEN_DEFS) {
      const lines = omenEffects(def.id);
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) expect(l.text.length).toBeGreaterThan(5);
    }
  });

  test("the numbers come from the rules", () => {
    const crimson = omenEffects("crimson").map((l) => l.text);
    expect(crimson).toContain("Monsters hit 25% harder");
    expect(crimson).toContain("Monsters move 20% faster");
    expect(crimson).toContain("Loot drops 70% more often");
    expect(crimson).toContain("50% more gold");
    expect(omenEffects("manatide")[0]).toEqual({ text: "Mana returns 2.2× as fast", good: true });
    const teeming = omenEffects("teeming");
    expect(teeming).toContainEqual({ text: "50% more monsters", good: false });
    expect(teeming).toContainEqual({ text: "Monsters have 25% less health", good: true });
  });
});
