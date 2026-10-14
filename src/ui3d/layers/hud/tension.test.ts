import { describe, expect, test } from "bun:test";
import { WARDEN } from "../../../enemies/brains/warden";
import { KNEE, shownFrac } from "../../../game/vitality";
import { artPixel, MARK, markAlpha, markHold, markLife, Nearest, rattleBpm } from "./lifeMarks";
import { discBelow, heightForFill, levelToHeight } from "./orbMaterials";

describe("the boss bar's knee", () => {
  test("the Warden enrages exactly where its bar crosses the notch", () => {
    // The last third of the bar IS the enraged half of its life: they can
    // never drift apart.
    expect(WARDEN.enrageFrac).toBe(KNEE.real);
    expect(shownFrac(WARDEN.enrageFrac)).toBeCloseTo(KNEE.shown, 9);
  });
});

describe("the orb tells the truth", () => {
  test("a disc's area below a chord: ends, middle, monotonic", () => {
    expect(discBelow(-1)).toBeCloseTo(0, 9);
    expect(discBelow(0)).toBeCloseTo(0.5, 9);
    expect(discBelow(1)).toBeCloseTo(1, 9);
    let prev = -1;
    for (let h = -1; h <= 1; h += 0.05) {
      expect(discBelow(h)).toBeGreaterThan(prev);
      prev = discBelow(h);
    }
  });

  test("exact at the ends, monotonic between", () => {
    expect(heightForFill(0)).toBe(levelToHeight(0));
    expect(heightForFill(1)).toBe(levelToHeight(1));
    expect(heightForFill(0.5)).toBeCloseTo(levelToHeight(0.5), 3);
    let prev = -Infinity;
    for (let f = 0.01; f < 1; f += 0.01) {
      expect(heightForFill(f)).toBeGreaterThan(prev);
      prev = heightForFill(f);
    }
  });

  test("30 % of the value covers 30 % of the orb (not a quarter)", () => {
    const bottom = -0.88;
    const top = 0.86;
    for (const f of [0.1, 0.3, 0.7]) {
      const h = heightForFill(f);
      // Back to the unit disc the area is judged on.
      const unit = ((h - bottom) / (top - bottom)) * 2 - 1;
      expect(discBelow(unit)).toBeCloseTo(f, 3);
    }
    // Low values stand higher than a straight level would put them.
    expect(heightForFill(0.3)).toBeGreaterThan(levelToHeight(0.3));
    expect(heightForFill(0.7)).toBeLessThan(levelToHeight(0.7));
  });
});

describe("life marks", () => {
  test("held after a blow, longer past the knee, then gone in hard steps", () => {
    expect(markHold(0.9)).toBe(MARK.hold);
    expect(markHold(KNEE.real)).toBe(MARK.holdPast);
    expect(markAlpha(0, MARK.hold)).toBe(1);
    expect(markAlpha(MARK.hold, MARK.hold)).toBe(1);
    expect(markAlpha(MARK.hold + MARK.fade, MARK.hold)).toBe(0);
    const seen = new Set<number>();
    for (let t = MARK.hold; t <= MARK.hold + MARK.fade; t += 0.01) seen.add(markAlpha(t, MARK.hold));
    expect(seen.size).toBeLessThanOrEqual(MARK.fadeSteps + 1);
  });

  test("the shooter sees their own blow at once, and never bounced back up", () => {
    expect(markLife(0.8, 0.6, 50)).toBe(0.6);
    // The authority already knows it's lower: that wins.
    expect(markLife(0.5, 0.6, 50)).toBe(0.5);
    // A stale prediction gives way to the authority.
    expect(markLife(0.8, 0.6, MARK.predictMs + 1)).toBe(0.8);
    expect(markLife(0.8, 0.6, -1)).toBe(0.8);
  });

  test("a death rattle only past the knee, quickening to the end", () => {
    expect(rattleBpm(0.9)).toBe(0);
    expect(rattleBpm(0)).toBe(0);
    expect(rattleBpm(KNEE.real)).toBe(MARK.rattle[0]);
    expect(rattleBpm(0.05)).toBeGreaterThan(rattleBpm(0.4));
  });

  test("a pixel size that grows with the screen, never below one", () => {
    expect(artPixel(100)).toBe(1);
    expect(artPixel(600)).toBe(2);
    expect(artPixel(1080)).toBe(3);
    expect(artPixel(2160)).toBeGreaterThan(artPixel(1440));
  });

  test("keeps the nearest few, nearest first, without growing", () => {
    const near = new Nearest<string>(3);
    for (const [k, d] of [["a", 9], ["b", 2], ["c", 7], ["d", 1], ["e", 30], ["f", 3]] as const) near.offer(k, d);
    expect(near.n).toBe(3);
    expect(near.items.slice(0, near.n)).toEqual(["d", "b", "f"]);
    expect(near.items.length).toBe(3);
    near.reset();
    expect(near.n).toBe(0);
    near.offer("z", 5);
    expect(near.items[0]).toBe("z");
  });
});
