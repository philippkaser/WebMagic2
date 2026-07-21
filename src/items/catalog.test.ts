import { describe, expect, test } from "bun:test";
import { computeStats } from "./catalog";
import { makeItemId } from "./itemId";
import type { Equipment } from "./types";

/** A staff is mandatory; everything else is optional. Helper to build a kit. */
function kit(over: Partial<Equipment> = {}): Equipment {
  return {
    staff: { defId: "apprentice_staff", runLoot: false },
    amulet: null,
    cloak: null,
    boots: null,
    ...over,
  };
}

describe("computeStats — casting modifiers", () => {
  test("baseline kit has neutral casting stats", () => {
    const s = computeStats(kit());
    expect(s.extraProjectiles).toBe(0);
    expect(s.homing).toBe(0);
    expect(s.fireRateMult).toBe(1);
  });

  test("additive modifiers sum, multiplicative ones multiply", () => {
    // Splinterstaff (+1 projectile) + Amulet of Multiplicity (+1) + Twinned
    // affix on the amulet (+1) = 3 extra; homing/fire-rate fold independently.
    const s = computeStats(
      kit({
        staff: { defId: "splinter_staff", runLoot: false }, // +1 projectile
        amulet: { defId: makeItemId("amulet_multi", "twinned"), runLoot: false }, // +1 base, +1 affix
      }),
    );
    expect(s.extraProjectiles).toBe(3);
  });

  test("split and bounce modifiers sum across gear and affixes", () => {
    const s = computeStats(
      kit({
        // Amulet of Fission (+1 split) with the Bouncing affix (+2 bounces),
        // on a staff carrying the Splitting affix (+1 split).
        staff: { defId: makeItemId("apprentice_staff", "splitting"), runLoot: false },
        amulet: { defId: makeItemId("amulet_fission", "bouncing"), runLoot: false },
      }),
    );
    expect(s.split).toBe(2);
    expect(s.bounces).toBe(2);

    const ricochet = computeStats(
      kit({ amulet: { defId: makeItemId("amulet_ricochet", "bouncing"), runLoot: false } }),
    );
    expect(ricochet.bounces).toBe(4);
    expect(ricochet.split).toBe(0);
  });

  test("homing sums across staff and amulet; fire rate multiplies", () => {
    const s = computeStats(
      kit({
        staff: { defId: "seeker_staff", runLoot: false }, // homing 0.5
        amulet: { defId: "amulet_seeker", runLoot: false }, // homing 0.45
      }),
    );
    expect(s.homing).toBeCloseTo(0.95, 5);

    const haste = computeStats(
      kit({ amulet: { defId: makeItemId("amulet_haste", "hasty"), runLoot: false } }),
    );
    // 1.22 (base) * 1.15 (Hasty affix)
    expect(haste.fireRateMult).toBeCloseTo(1.403, 3);
  });
});
