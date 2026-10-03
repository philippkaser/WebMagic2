import { describe, expect, test } from "bun:test";
import { airDb, decorrelator, earDelay, ears, HEAD_RADIUS, shadowAlpha, SPEED_OF_SOUND, spread } from "./binaural";

/** Direction (x right, z ahead) at `deg` degrees round to the right. */
const dir = (deg: number): [number, number, number] => [Math.sin((deg * Math.PI) / 180), 0, Math.cos((deg * Math.PI) / 180)];

describe("binaural cues", () => {
  test("the far ear hears it later: Woodworth's ITD, ~0.66 ms at the side", () => {
    const a = HEAD_RADIUS / SPEED_OF_SOUND;
    expect(earDelay(0)).toBe(0);
    expect(earDelay(Math.PI / 2)).toBeCloseTo(a, 9);
    const side = ears(...dir(90), true);
    expect(side.delayL - side.delayR).toBeCloseTo(a * (1 + Math.PI / 2), 9);
    expect(side.delayL - side.delayR).toBeGreaterThan(0.00063);
    expect(side.delayL - side.delayR).toBeLessThan(0.00068);
    // Grows steadily from straight ahead to the side, mirrored left/right.
    let last = -1;
    for (let deg = 0; deg <= 90; deg += 10) {
      const e = ears(...dir(deg), true);
      const itd = e.delayL - e.delayR;
      expect(itd).toBeGreaterThan(last);
      last = itd;
      const m = ears(...dir(-deg), true);
      expect(m.delayR - m.delayL).toBeCloseTo(itd, 12);
    }
  });

  test("the head shadows the far ear's treble, lifts the near ear's", () => {
    expect(shadowAlpha(0)).toBeCloseTo(2, 9);
    expect(shadowAlpha((150 * Math.PI) / 180)).toBeCloseTo(0.1, 9);
    const right = ears(...dir(90), true);
    expect(right.shelfR).toBeGreaterThan(3);
    expect(right.shelfL).toBeLessThan(-6);
    // The lows hardly differ (a few dB), the treble a lot.
    const lowIld = 20 * Math.log10(right.gainR / right.gainL);
    expect(lowIld).toBeGreaterThan(1);
    expect(lowIld).toBeLessThan(4);
    expect(right.shelfR - right.shelfL).toBeGreaterThan(12);
  });

  test("straight ahead is untouched; behind is duller, not shifted", () => {
    const front = ears(0, 0, 1, true);
    expect(front.delayL).toBeCloseTo(front.delayR, 12);
    expect(front.shelfL).toBeCloseTo(0, 9);
    expect(front.shelfR).toBeCloseTo(0, 9);
    expect(front.gainL).toBeCloseTo(1, 9);
    expect(front.behind).toBeCloseTo(0, 9);
    const back = ears(0, 0, -1, true);
    expect(back.delayL).toBeCloseTo(back.delayR, 12);
    expect(back.behind).toBeLessThan(-5);
    // A sound on top of you loses its side.
    const close = ears(...dir(90), true, 0);
    expect(close.delayL).toBeCloseTo(close.delayR, 12);
  });

  test("on speakers: level, no delays", () => {
    const right = ears(...dir(90), false);
    expect(right.delayL).toBe(0);
    expect(right.delayR).toBe(0);
    expect(right.gainR).toBeGreaterThan(right.gainL * 4);
    const front = ears(0, 0, 1, false);
    expect(front.gainL).toBeCloseTo(1, 9);
    expect(front.gainR).toBeCloseTo(1, 9);
  });

  test("a sound has a size: a point far off, all round you inside it", () => {
    expect(spread(0, 1)).toBe(0);
    expect(spread(1.2, 1.2)).toBeCloseTo(0.5, 9);
    expect(spread(1.2, 0)).toBeGreaterThan(0.99);
    expect(spread(1.2, 20)).toBeLessThan(0.05);
    expect(spread(1.2, 3)).toBeLessThan(spread(1.2, 2));
  });

  test("air takes the treble off far sounds", () => {
    expect(airDb(1)).toBeCloseTo(0, 9);
    expect(airDb(12)).toBeCloseTo(-3, 9);
    expect(airDb(30)).toBeLessThan(airDb(12));
    expect(airDb(1000)).toBe(-18);
  });

  test("the decorrelator: unit energy, and the ears' signals barely alike", () => {
    const sr = 48000;
    const [l, r] = decorrelator(sr);
    const energy = (a: Float32Array) => a.reduce((s, v) => s + v * v, 0);
    expect(energy(l)).toBeCloseTo(1, 5);
    expect(energy(r)).toBeCloseTo(1, 5);
    let worst = 0;
    const lag = Math.round(0.001 * sr);
    for (let k = -lag; k <= lag; k++) {
      let c = 0;
      for (let i = 0; i < l.length; i++) {
        const j = i + k;
        if (j >= 0 && j < r.length) c += l[i]! * r[j]!;
      }
      worst = Math.max(worst, Math.abs(c));
    }
    expect(worst).toBeLessThan(0.3);
  });
});
