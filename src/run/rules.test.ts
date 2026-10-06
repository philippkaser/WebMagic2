import { describe, expect, test } from "bun:test";
import {
  canLeave,
  entryFloorFor,
  entryFloorForGear,
  floorsUntilExit,
  gearLevel,
  paceWaitMs,
  RUN,
  spendPace,
  type PaceState,
} from "./rules";

describe("the Weighing (gear level → entry floor)", () => {
  test("starter gear resonates weakly and enters on floor 1", () => {
    const starter = ["apprentice_staff", null, null, "worn_boots"];
    expect(gearLevel(starter)).toBeCloseTo(0.5);
    expect(entryFloorForGear(starter)).toBe(1);
  });

  test("gear level is the mean item level over four slots; empty slots weigh nothing", () => {
    const full = ["ember_staff@10", "amulet_vigor@10", "cloak_warden@10", "worn_boots@10"];
    expect(gearLevel(full)).toBe(10);
    const half = ["ember_staff@10", "amulet_vigor@10", null, null];
    expect(gearLevel(half)).toBe(5);
    // Legacy ids resonate at their catalog depth.
    expect(gearLevel(["void_staff", null, null, null])).toBe(6 / 4);
  });

  test("forged, unknown or consumable ids carry no weight", () => {
    expect(gearLevel(["nope@90", "potion_hp_weak", "ember_staff@x", null])).toBe(0);
  });

  test("deeper gear casts you deeper, but never past the last five floors", () => {
    expect(entryFloorFor(0)).toBe(1);
    expect(entryFloorFor(10)).toBe(Math.round(10 * RUN.entryDepthPerLevel));
    expect(entryFloorFor(20)).toBeGreaterThan(entryFloorFor(10));
    expect(entryFloorFor(500)).toBe(RUN.maxEntryFloor);
    expect(RUN.maxEntryFloor + RUN.floorsBeforeExit - 1).toBeLessThanOrEqual(100);
  });
});

describe("the Tithe of Five (exit rule)", () => {
  test("the way home opens on the fifth floor played, and stays open", () => {
    expect(floorsUntilExit(1)).toBe(4);
    expect(canLeave(1)).toBe(false);
    expect(canLeave(4)).toBe(false);
    expect(floorsUntilExit(5)).toBe(0);
    expect(canLeave(5)).toBe(true);
    expect(canLeave(9)).toBe(true);
  });
});

describe("the deep's pace", () => {
  const rules = { msPerFloor: 1000, burst: 3 };

  test("a full burst goes through at once; the next floor waits for a token", () => {
    let state: PaceState | undefined;
    for (let i = 0; i < 3; i++) {
      expect(paceWaitMs(state, 0, rules)).toBe(0);
      state = spendPace(state, 0, rules);
    }
    expect(paceWaitMs(state, 0, rules)).toBe(1000);
    expect(paceWaitMs(state, 400, rules)).toBe(600);
    expect(paceWaitMs(state, 1000, rules)).toBe(0);
  });

  test("tokens come back over time, never past the burst", () => {
    let state = spendPace(undefined, 0, rules); // 2 left
    state = spendPace(state, 0, rules); // 1 left
    expect(paceWaitMs(spendPace(state, 0, rules), 0, rules)).toBe(1000);
    // A long rest refills only to the burst: three floors, then a wait.
    let rested: PaceState | undefined = state;
    for (let i = 0; i < 3; i++) rested = spendPace(rested, 60_000, rules);
    expect(paceWaitMs(rested, 60_000, rules)).toBe(1000);
  });

  test("waiting exactly the asked time is always enough (no float shortfall)", () => {
    let state: PaceState | undefined;
    let now = 0;
    for (let i = 0; i < 50; i++) {
      now += paceWaitMs(state, now, { msPerFloor: 15_000, burst: 3 });
      expect(paceWaitMs(state, now, { msPerFloor: 15_000, burst: 3 })).toBe(0);
      state = spendPace(state, now, { msPerFloor: 15_000, burst: 3 });
      now += 7; // a little drift between requests
    }
  });
});
