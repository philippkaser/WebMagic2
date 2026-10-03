import { describe, expect, test } from "bun:test";
import { allItemDefs } from "../items/catalog";
import { getSpellDef, isSpellId, SPELLS, spellInfo, type SpellDef } from "./spellCatalog";

describe("spell catalog — integrity", () => {
  test("every ability any staff references exists", () => {
    const staffs = allItemDefs().filter((d) => d.slot === "staff");
    expect(staffs.length).toBeGreaterThan(0);
    for (const staff of staffs) {
      for (const id of [staff.primary, staff.secondary]) {
        expect(id).toBeString();
        expect(isSpellId(id!)).toBe(true);
        expect(() => getSpellDef(id!)).not.toThrow();
      }
    }
  });

  test("ids are unique and lookups round-trip", () => {
    const ids = SPELLS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SPELLS) expect(getSpellDef(s.id)).toBe(s);
  });

  test("unknown ids are rejected", () => {
    expect(isSpellId("nope")).toBe(false);
    expect(() => getSpellDef("nope")).toThrow();
  });

  test("every number is finite and costs/cooldowns are positive", () => {
    for (const s of SPELLS) {
      for (const [key, v] of Object.entries(s)) {
        if (typeof v === "number") expect(Number.isFinite(v), `${s.id}.${key}`).toBe(true);
      }
      expect(s.mana).toBeGreaterThan(0);
      expect(s.cooldown).toBeGreaterThan(0);
    }
  });
});

/** The table before it became data: every spell's numbers, verbatim from the
 * old per-spell cast code (bolt defaults: count 1, spread 0.012, gravity 0,
 * pop 1.7 / 9 — fireProjectile's defaults). Changing a number here is a
 * balance change, not a refactor. */
type SpellNumbers = SpellDef extends infer S ? (S extends SpellDef ? Omit<S, "id" | "name"> : never) : never;
const TODAY: Record<string, SpellNumbers> = {
  bolt: {
    kind: "bolt", mana: 3, cooldown: 0.26, damage: 16, speed: 34, size: 0.13,
    count: 1, spread: 0.012, gravityScale: 0, blastRadius: 1.7, blastImpulse: 9,
  },
  scatter: {
    kind: "bolt", mana: 7, cooldown: 0.55, damage: 8, speed: 26, size: 0.1,
    count: 5, spread: 0.22, gravityScale: 0.35, blastRadius: 1.4, blastImpulse: 9,
  },
  rapid: {
    kind: "bolt", mana: 2, cooldown: 0.11, damage: 7, speed: 42, size: 0.09,
    count: 1, spread: 0.05, gravityScale: 0, blastRadius: 1.7, blastImpulse: 9,
  },
  lance: {
    kind: "bolt", mana: 9, cooldown: 0.7, damage: 34, speed: 52, size: 0.19,
    count: 1, spread: 0.012, gravityScale: 0, blastRadius: 2.4, blastImpulse: 18,
  },
  blast: {
    kind: "blast", mana: 18, cooldown: 0.95, damage: 24, radius: 3.8, impulse: 30,
    reach: 1.5, particles: 40, light: 42, recoil: { back: 4.2, up: 5.5, minLift: 0.8 },
  },
  voidseed: {
    kind: "seed", mana: 10, cooldown: 0.5, damage: 30, speed: 18, size: 0.2,
    gravityScale: 0, color: "#a06bff",
  },
  collapse: { kind: "collapse", mana: 12, cooldown: 0.8 },
  shockwave: {
    kind: "shockwave", mana: 14, cooldown: 1.15, damage: 12, radius: 5.5, impulse: 44,
    particles: 54, light: 48,
  },
};

describe("spell catalog — numbers unchanged by the data refactor", () => {
  test("the table holds exactly the known spells", () => {
    expect(SPELLS.map((s) => s.id).sort()).toEqual(Object.keys(TODAY).sort());
  });

  for (const [id, expected] of Object.entries(TODAY)) {
    test(id, () => {
      const { id: _id, name: _name, ...numbers } = getSpellDef(id);
      expect(numbers as unknown).toEqual(expected);
    });
  }

  test("display names", () => {
    expect(Object.fromEntries(SPELLS.map((s) => [s.id, s.name]))).toEqual({
      bolt: "Bolt",
      scatter: "Ember Scatter",
      rapid: "Arc Bolt",
      lance: "Void Lance",
      blast: "Force Blast",
      voidseed: "Void Seed",
      collapse: "Collapse",
      shockwave: "Shockwave",
    });
  });
});

describe("spellInfo — tooltip derived from the numbers", () => {
  test("reproduces the hand-written tooltips of the numbered spells", () => {
    const info = (id: string) => spellInfo(getSpellDef(id));
    expect(info("bolt")).toBe("16 dmg");
    expect(info("scatter")).toBe("5×8 dmg, spread");
    expect(info("rapid")).toBe("7 dmg, rapid");
    expect(info("lance")).toBe("34 dmg + blast");
    expect(info("blast")).toBe("24 dmg, knockback");
    expect(info("shockwave")).toBe("12 dmg, huge knockback");
    expect(info("voidseed")).toBe("30 dmg, plant · Collapse to detonate");
    expect(info("collapse")).toBe("implode your seeds → black holes");
  });

  test("every damaging spell's tooltip shows its damage number", () => {
    for (const s of SPELLS) {
      if ("damage" in s) expect(spellInfo(s)).toContain(String(s.damage));
    }
  });

  test("retuning a number retunes the tooltip", () => {
    const bolt = getSpellDef("bolt") as Readonly<Extract<SpellDef, { kind: "bolt" }>>;
    expect(spellInfo({ ...bolt, damage: 21 })).toBe("21 dmg");
    expect(spellInfo({ ...bolt, count: 3 })).toBe("3×16 dmg");
    expect(spellInfo({ ...bolt, blastRadius: 2.5 })).toBe("16 dmg + blast");
    expect(spellInfo({ ...bolt, count: 3, spread: 0.3 })).toBe("3×16 dmg, spread");
    expect(spellInfo({ ...bolt, cooldown: 0.1 })).toBe("16 dmg, rapid");

    const blast = getSpellDef("blast") as Readonly<Extract<SpellDef, { kind: "blast" }>>;
    expect(spellInfo({ ...blast, damage: 30 })).toBe("30 dmg, knockback");
    expect(spellInfo({ ...blast, impulse: 50 })).toBe("24 dmg, huge knockback");

    const seed = getSpellDef("voidseed") as Readonly<Extract<SpellDef, { kind: "seed" }>>;
    expect(spellInfo({ ...seed, damage: 45 })).toStartWith("45 dmg");
  });
});
