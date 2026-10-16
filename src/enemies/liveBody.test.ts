import { afterEach, describe, expect, test } from "bun:test";
import { STOP } from "../combat/impact";
import { landing } from "../combat/landing";
import { hitstop, presentScale, resetPresentTime } from "../core/presentTime";
import { KNEE } from "../game/vitality";
import { LiveBody } from "./liveBody";

describe("the living body under a hitstop", () => {
  afterEach(resetPresentTime);

  test("a held frame hangs the pose whole: the breath doesn't drop out, the shiver doesn't re-roll", () => {
    const b = new LiveBody("shadow", "held", 100, 0.5, { current: 0 });
    b.lifeTo(5, null); // at death's door: deep, ragged breaths
    b.doom(); // and shuddering in its throes
    const at = { x: 0, y: 1, z: 0 };
    for (let i = 0; i < 20; i++) b.frame(1 / 60, at, null);
    const held = { ...b.pose };
    hitstop(0.2);
    for (let i = 0; i < 5; i++) {
      b.frame(1 / 60, at, null);
      expect(b.pose).toEqual(held);
    }
    resetPresentTime();
    b.frame(1 / 60, at, null);
    expect(b.pose).not.toEqual(held); // and it lives again once the picture runs
  });
});

describe("the knee's break", () => {
  afterEach(() => {
    landing.weight = Number.NaN;
    resetPresentTime();
  });

  test("a flame's tick of ours that breaks a body doesn't stop the stream", () => {
    const b = new LiveBody("slime", "swept", 100, 0.5, { current: 0 });
    landing.weight = STOP.tickWeight * 0.5;
    b.lifeTo(KNEE.real * 100 - 1, { x: 0, y: 0, z: 0 }, true);
    expect(b.broke).toBe(true);
    expect(presentScale()).toBe(1);
  });
});
