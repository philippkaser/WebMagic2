import { describe, expect, test } from "bun:test";
import {
  bpmOf,
  HEART,
  heartbeat,
  kickBrink,
  kickRelease,
  LIFE_BRINK,
  lifeByte,
  lowOf,
  newHeart,
  readLifeByte,
  releaseOf,
  SECOND_WIND_MIN,
  stepHeart,
} from "./heart";
import { LAST_STAND } from "./vitality";

const run = (h: ReturnType<typeof newHeart>, seconds: number, frac: number, onBeat?: () => void) => {
  for (let t = 0; t < seconds; t += 1 / 60) {
    const before = h.beats;
    stepHeart(h, 1 / 60, frac);
    if (h.beats !== before) onBeat?.();
  }
};

describe("the heart's depth", () => {
  test("nothing above the last-stand line, a step at it, all of it at zero", () => {
    expect(lowOf(1)).toBe(0);
    expect(lowOf(LAST_STAND.below)).toBe(0);
    expect(lowOf(LAST_STAND.below - 1e-6)).toBeCloseTo(HEART.onset, 4);
    expect(lowOf(0)).toBe(1);
    let prev = 0;
    for (let f = LAST_STAND.below - 0.01; f >= 0; f -= 0.01) {
      expect(lowOf(f)).toBeGreaterThanOrEqual(prev);
      prev = lowOf(f);
    }
  });

  test("the rate climbs from calm through the line to death's door", () => {
    expect(bpmOf(0)).toBe(HEART.rest);
    expect(bpmOf(HEART.onset)).toBeCloseTo(HEART.line, 9);
    expect(bpmOf(1)).toBe(HEART.door);
    expect(bpmOf(0.6)).toBeGreaterThan(bpmOf(0.4));
  });

  test("a lub-dub in 0…1", () => {
    let peak = 0;
    for (let p = 0; p < 1; p += 0.01) {
      const b = heartbeat(p);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
      peak = Math.max(peak, b);
    }
    expect(peak).toBeGreaterThan(0.9);
    expect(heartbeat(0.6)).toBeLessThan(0.01);
  });
});

describe("one heart", () => {
  test("silent while whole: no beats, no thuds", () => {
    const h = newHeart();
    let thuds = 0;
    run(h, 5, 0.9, () => thuds++);
    expect(h.low).toBe(0);
    expect(h.felt).toBe(0);
    expect(h.beat).toBe(0);
    expect(thuds).toBe(0);
  });

  test("felt below the line, racing toward death", () => {
    const h = newHeart();
    let thuds = 0;
    run(h, 4, 0.25, () => thuds++);
    expect(h.low).toBeGreaterThan(HEART.onset);
    const nearLine = h.bpm;
    expect(nearLine).toBeGreaterThan(HEART.line - 1);
    // ~100 bpm for 4 s: a handful of thuds, counted once each.
    expect(thuds).toBeGreaterThanOrEqual(5);
    expect(thuds).toBeLessThanOrEqual(8);
    run(h, 4, 0.02);
    expect(h.bpm).toBeGreaterThan(nearLine + 30);
    expect(h.low).toBeGreaterThan(0.95);
  });

  test("the Brink slams it, and the slam fades", () => {
    const h = newHeart();
    run(h, 3, 0.01);
    const before = h.bpm;
    kickBrink(h);
    expect(h.brink).toBe(1);
    run(h, 0.5, 0.01);
    expect(h.bpm).toBeGreaterThan(before + 5);
    run(h, 6, 0.01);
    expect(h.brink).toBe(0);
  });

  test("a second wind lifts it fast and the heart slows over three beats", () => {
    const h = newHeart();
    run(h, 3, 0.1);
    const racing = h.bpm;
    kickRelease(h, 1);
    let thuds = 0;
    // Healed well over the line.
    run(h, 0.5, 0.8);
    expect(h.low).toBeLessThan(0.05);
    run(h, 8, 0.8, () => thuds++);
    // The heart keeps beating a few beats as it settles, then is gone.
    expect(thuds).toBeGreaterThanOrEqual(2);
    expect(thuds).toBeLessThanOrEqual(HEART.calmBeats + 1);
    expect(h.felt).toBe(0);
    expect(h.bpm).toBeLessThan(racing - 20);
    expect(h.release).toBeLessThan(0.01);
  });

  test("without a second wind the heart just fades as the grey lifts", () => {
    const h = newHeart();
    run(h, 3, 0.1);
    run(h, 4, 0.9);
    expect(h.felt).toBe(0);
    expect(h.calm).toBe(0);
  });
});

describe("second wind", () => {
  test("only a real heal back over the line", () => {
    const line = LAST_STAND.below;
    expect(releaseOf(0.1, 0.5)).toBeGreaterThan(0.5);
    expect(releaseOf(0.1, 0.5)).toBeLessThanOrEqual(1);
    // A trickle across the line, a heal staying inside the band, a heal from above it.
    expect(releaseOf(line - 0.01, line + 0.01)).toBe(0);
    expect(releaseOf(0.05, 0.2)).toBe(0);
    expect(releaseOf(0.4, 0.9)).toBe(0);
    expect(releaseOf(line - SECOND_WIND_MIN, line)).toBeGreaterThan(0);
    // Bigger heals lift harder.
    expect(releaseOf(0.05, 1)).toBeGreaterThan(releaseOf(0.25, 0.4));
  });
});

describe("life on the wire", () => {
  test("whole, a sliver, dead, the Brink", () => {
    expect(lifeByte(100, 100, false)).toBe(15);
    expect(lifeByte(1, 100, false)).toBe(1);
    expect(lifeByte(0, 100, false)).toBe(0);
    expect(lifeByte(1, 100, true)).toBe(1 + LIFE_BRINK);
    expect(lifeByte(50, 100, false)).toBe(8);
  });

  test("the last-stand line reads the same on both sides of the wire", () => {
    // Just under the line used to round up to 5/15 — over it, so floor-mates
    // saw no last stand from 26.7% to 30%.
    const read = (health: number) => readLifeByte(lifeByte(health, 100, false))!.frac;
    for (const health of [29.99, 29, 28, 27, 26.7, 20, 1]) {
      expect(read(health)).toBeLessThan(LAST_STAND.below);
      expect(lowOf(read(health))).toBeGreaterThan(0);
    }
    for (const health of [30, 31, 33.4, 50, 100]) {
      expect(read(health)).toBeGreaterThanOrEqual(LAST_STAND.below);
      expect(lowOf(read(health))).toBe(0);
    }
    // Across a whole pool, in fine steps: in the last stand here ⇔ there.
    for (let hp = 1; hp <= 1000; hp++) {
      expect(read(hp / 10) < LAST_STAND.below).toBe(hp / 10 / 100 < LAST_STAND.below);
    }
    // The Brink bit rides on top of the capped step.
    expect(lifeByte(29, 100, true)).toBe(4 + LIFE_BRINK);
  });

  test("reads back, and refuses what isn't one", () => {
    expect(readLifeByte(15)).toEqual({ frac: 1, brink: false });
    expect(readLifeByte(1 + LIFE_BRINK)).toEqual({ frac: 1 / 15, brink: true });
    for (const bad of [undefined, -1, 32, 3.5, "7", null, Number.NaN]) expect(readLifeByte(bad)).toBeNull();
    for (let b = 0; b < 32; b++) {
      const r = readLifeByte(b)!;
      expect(lifeByte(r.frac * 100, 100, r.brink)).toBe(b === LIFE_BRINK ? 0 + LIFE_BRINK : b);
    }
  });
});
