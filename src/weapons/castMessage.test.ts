import { describe, expect, test } from "bun:test";
import { MAX_ITEM_LEVEL } from "../items/itemId";
import { staffPotency } from "../items/power";
import { BASIC_STAFF_ID } from "../items/catalog";
import { makeItemId } from "../items/itemId";
import {
  CAST_STAT_LIMITS,
  encodeCastMsg,
  NEUTRAL_CAST_STATS,
  sanitizeCastMsg,
  sanitizeCastStats,
  type CastMsg,
} from "./castMessage";

const good = (): CastMsg => ({
  abilityId: "bolt",
  origin: [1, 2, 3],
  dir: [0, 0, -1],
  staffId: "splinter_staff",
  stats: { damageMult: 1.12, extraProjectiles: 1, homing: 0.3 },
});

describe("encodeCastMsg → sanitizeCastMsg", () => {
  test("a legit cast round-trips unchanged", () => {
    const msg = encodeCastMsg(
      "scatter",
      { x: 4, y: 1.5, z: -2 },
      { x: 0, y: 0, z: 1 },
      "ember_staff",
      { damageMult: 1.3, extraProjectiles: 2, homing: 0.5 },
    );
    expect(sanitizeCastMsg(msg)).toEqual(msg);
  });

  test("encoding copies only the cast-shaping stats (not the whole DerivedStats)", () => {
    const msg = encodeCastMsg("bolt", { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, "arc_staff", {
      damageMult: 1,
      extraProjectiles: 0,
      homing: 0,
      fireRateMult: 2,
      maxHealth: 500,
    } as never);
    expect(Object.keys(msg.stats).sort()).toEqual(["damageMult", "extraProjectiles", "homing"]);
  });
});

describe("sanitizeCastMsg — rejects what can't be replayed", () => {
  test("non-objects and unknown spells", () => {
    for (const bad of [null, undefined, 1, "cast", []]) expect(sanitizeCastMsg(bad)).toBeNull();
    expect(sanitizeCastMsg({ ...good(), abilityId: "meteor" })).toBeNull();
    expect(sanitizeCastMsg({ ...good(), abilityId: 7 })).toBeNull();
  });

  test("malformed origin or aim", () => {
    for (const v of [
      undefined,
      [1, 2],
      [1, 2, 3, 4],
      [1, "2", 3],
      [NaN, 0, 0],
      [0, Infinity, 0],
      { x: 0, y: 0, z: 1 },
    ]) {
      expect(sanitizeCastMsg({ ...good(), origin: v })).toBeNull();
      expect(sanitizeCastMsg({ ...good(), dir: v })).toBeNull();
    }
  });

  test("a zero-length aim has no direction", () => {
    expect(sanitizeCastMsg({ ...good(), dir: [0, 0, 0] })).toBeNull();
  });
});

describe("sanitizeCastMsg — degrades softer problems", () => {
  test("aim is renormalized (a huge dir can't fling a blast across the map)", () => {
    const out = sanitizeCastMsg({ ...good(), dir: [0, 300, 400] })!;
    expect(out.dir[0]).toBe(0);
    expect(out.dir[1]).toBeCloseTo(0.6, 12);
    expect(out.dir[2]).toBeCloseTo(0.8, 12);
  });

  test("unknown or non-staff items replay as the Apprentice Staff", () => {
    for (const staffId of [undefined, 42, "", "staff_of_tomorrow", "amulet_vigor", "save_feather"]) {
      expect(sanitizeCastMsg({ ...good(), staffId })!.staffId).toBe(BASIC_STAFF_ID);
    }
  });

  test("an enchanted staff id is reduced to its base staff", () => {
    const staffId = makeItemId("ember_staff", "keen");
    expect(sanitizeCastMsg({ ...good(), staffId })!.staffId).toBe("ember_staff");
  });

  test("missing stats (older client) mean bare-handed casting", () => {
    const { stats: _stats, ...rest } = good();
    expect(sanitizeCastMsg(rest)!.stats).toEqual({ ...NEUTRAL_CAST_STATS });
    expect(sanitizeCastMsg({ ...rest, stats: "strong" })!.stats).toEqual({ ...NEUTRAL_CAST_STATS });
  });

  test("the output carries only known fields", () => {
    const out = sanitizeCastMsg({ ...good(), damage: 9999, stats: { ...good().stats, fireRateMult: 50 } })!;
    expect(Object.keys(out).sort()).toEqual(["abilityId", "dir", "origin", "staffId", "stats"]);
    expect(Object.keys(out.stats).sort()).toEqual(["damageMult", "extraProjectiles", "homing"]);
  });
});

describe("sanitizeCastStats", () => {
  test("in-range values pass through", () => {
    expect(sanitizeCastStats({ damageMult: 1.5, extraProjectiles: 2, homing: 0.8 })).toEqual({
      damageMult: 1.5,
      extraProjectiles: 2,
      homing: 0.8,
    });
  });

  test("damageMult is clamped to [0, 16] — above the deepest legit staff", () => {
    expect(CAST_STAT_LIMITS.damageMult).toEqual({ min: 0, max: 16 });
    expect(sanitizeCastStats({ damageMult: 1000 }).damageMult).toBe(16);
    expect(sanitizeCastStats({ damageMult: -3 }).damageMult).toBe(0);
    // A level-120 staff with a fury amulet and a keen affix still fits.
    expect(staffPotency(MAX_ITEM_LEVEL) * 1.3 * 1.12).toBeLessThan(16);
  });

  test("extraProjectiles is an integer in [0, 4]", () => {
    expect(sanitizeCastStats({ extraProjectiles: 2.6 }).extraProjectiles).toBe(3);
    expect(sanitizeCastStats({ extraProjectiles: 2.4 }).extraProjectiles).toBe(2);
    expect(sanitizeCastStats({ extraProjectiles: 99 }).extraProjectiles).toBe(4);
    expect(sanitizeCastStats({ extraProjectiles: -1 }).extraProjectiles).toBe(0);
  });

  test("homing is clamped to [0, 2]", () => {
    expect(sanitizeCastStats({ homing: 7 }).homing).toBe(2);
    expect(sanitizeCastStats({ homing: -0.5 }).homing).toBe(0);
  });

  test("non-finite or non-numeric stats fall back to neutral", () => {
    const out = sanitizeCastStats({ damageMult: NaN, extraProjectiles: Infinity, homing: "max" });
    expect(out).toEqual({ ...NEUTRAL_CAST_STATS });
  });
});
