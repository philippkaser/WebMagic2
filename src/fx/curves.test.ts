import { describe, expect, test } from "bun:test";
import {
  budgetCount,
  clamp01,
  colorMix,
  easeOutCubic,
  easeOutQuint,
  flicker,
  hash01,
  lifeAlpha,
  lifeSize,
  pixelSpan,
  steppedFlicker,
  steps,
  randomInCone,
  randomUnit,
  ringPoint,
  trailSteps,
} from "./curves";

/** Deterministic rand for the emitter helpers. */
function seq(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

describe("easing", () => {
  test("ease-outs run 0 → 1 and clamp outside", () => {
    for (const f of [easeOutCubic, easeOutQuint]) {
      expect(f(0)).toBe(0);
      expect(f(1)).toBe(1);
      expect(f(-1)).toBe(0);
      expect(f(2)).toBe(1);
    }
  });
  test("ease-outs are front-loaded (a pressure front covers most ground early)", () => {
    expect(easeOutCubic(0.3)).toBeGreaterThan(0.6);
    expect(easeOutQuint(0.3)).toBeGreaterThan(easeOutCubic(0.3));
  });
  test("clamp01", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0.25)).toBe(0.25);
    expect(clamp01(3)).toBe(1);
  });
});

describe("lifeAlpha", () => {
  test("fades in over fadeIn, then out to zero at death", () => {
    expect(lifeAlpha(0, 0.2, 1)).toBe(0);
    expect(lifeAlpha(0.1, 0.2, 1)).toBeCloseTo(0.5 * 0.9);
    expect(lifeAlpha(1, 0.2, 1)).toBe(0);
  });
  test("no fade-in starts at full alpha", () => {
    expect(lifeAlpha(0, 0, 2)).toBe(1);
  });
  test("a higher fade-out power dies faster", () => {
    expect(lifeAlpha(0.5, 0, 3)).toBeLessThan(lifeAlpha(0.5, 0, 1));
  });
  test("zero power holds full alpha all life (the legacy chips)", () => {
    expect(lifeAlpha(0.9, 0, 0)).toBe(1);
  });
});

describe("lifeSize", () => {
  test("every curve starts at the start size", () => {
    for (const c of [0, 1, 2]) expect(lifeSize(0, 0.3, 0.9, c)).toBeCloseTo(0.3);
  });
  test("shrink and grow end at the end size", () => {
    expect(lifeSize(1, 0.3, 0, 0)).toBeCloseTo(0);
    expect(lifeSize(1, 0.3, 0.9, 1)).toBeCloseTo(0.9);
  });
  test("shrink holds its size early (legacy 1 − t² look)", () => {
    expect(lifeSize(0.3, 1, 0, 0)).toBeCloseTo(1 - 0.09);
  });
  test("pop peaks at the end size early, then settles back", () => {
    expect(lifeSize(0.15, 0.2, 1, 2)).toBeCloseTo(1);
    expect(lifeSize(1, 0.2, 1, 2)).toBeCloseTo(0.2);
    expect(lifeSize(0.5, 0.2, 1, 2)).toBeLessThan(1);
  });
});

describe("colorMix / flicker / hash", () => {
  test("colorMix exponent shapes the ramp", () => {
    expect(colorMix(0.5, 1)).toBeCloseTo(0.5);
    expect(colorMix(0.5, 0.5)).toBeGreaterThan(0.5); // cools quickly
    expect(colorMix(0.5, 2)).toBeLessThan(0.5); // holds, shifts late
  });
  test("flicker stays within [1 − amount, 1]", () => {
    for (let t = 0; t < 5; t += 0.037) {
      const f = flicker(t, 0.3, 0.6);
      expect(f).toBeGreaterThanOrEqual(0.4 - 1e-9);
      expect(f).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(flicker(1.23, 0.5, 0)).toBe(1);
  });
  test("hash01 is deterministic and in [0, 1)", () => {
    for (let i = 0; i < 50; i++) {
      const h = hash01(i * 0.731);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      expect(hash01(i * 0.731)).toBe(h);
    }
  });
});

describe("pixel steps", () => {
  test("steps quantizes into flat levels and hits both ends", () => {
    expect(steps(0, 4)).toBe(0);
    expect(steps(0.2, 4)).toBe(0);
    expect(steps(0.3, 4)).toBeCloseTo(1 / 3);
    expect(steps(0.6, 4)).toBeCloseTo(2 / 3);
    expect(steps(0.8, 4)).toBe(1);
    expect(steps(1, 4)).toBe(1);
    const seen = new Set<number>();
    for (let x = 0; x <= 1; x += 0.01) seen.add(steps(x, 4));
    expect(seen.size).toBe(4);
  });
  test("steppedFlicker only ever takes three levels within [1 − amount, 1]", () => {
    const seen = new Set<number>();
    for (let t = 0; t < 10; t += 0.013) {
      const f = steppedFlicker(t, 0.37, 0.6);
      expect(f).toBeGreaterThanOrEqual(0.4 - 1e-9);
      expect(f).toBeLessThanOrEqual(1 + 1e-9);
      seen.add(Math.round(f * 1000));
    }
    expect(seen.size).toBeLessThanOrEqual(3);
    expect(seen.size).toBeGreaterThan(1);
    expect(steppedFlicker(1, 0.2, 0)).toBe(1);
  });
  test("pixelSpan: whole pixels, never below one, sub-pixel dithers by coverage", () => {
    const o = { n: 0, coverage: 0 };
    expect(pixelSpan(2, o)).toEqual({ n: 4, coverage: 1 });
    expect(pixelSpan(1.3, o).n).toBe(3);
    pixelSpan(0.25, o);
    expect(o.n).toBe(1);
    expect(o.coverage).toBeCloseTo(0.5);
    expect(pixelSpan(0, o).coverage).toBeCloseTo(0.08);
  });
});

describe("emitter maths", () => {
  const v = { x: 0, y: 0, z: 0 };
  test("randomUnit returns unit vectors", () => {
    const r = seq(7);
    for (let i = 0; i < 200; i++) {
      randomUnit(v, r);
      expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 6);
    }
  });
  test("randomUnit covers both hemispheres", () => {
    const r = seq(3);
    let up = 0;
    for (let i = 0; i < 400; i++) if (randomUnit(v, r).y > 0) up++;
    expect(up).toBeGreaterThan(150);
    expect(up).toBeLessThan(250);
  });
  test("randomInCone stays within the cone around any axis", () => {
    const r = seq(11);
    const axes: [number, number, number][] = [
      [0, 1, 0],
      [0, -1, 0],
      [1, 0, 0],
      [0.6, 0, 0.8],
      [0.267, 0.534, 0.802],
    ];
    for (const [x, y, z] of axes) {
      const l = Math.hypot(x, y, z);
      const [ax, ay, az] = [x / l, y / l, z / l];
      for (let i = 0; i < 100; i++) {
        randomInCone(ax, ay, az, 0.4, v, r);
        expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 6);
        const cos = v.x * ax + v.y * ay + v.z * az;
        expect(cos).toBeGreaterThanOrEqual(Math.cos(0.4) - 1e-6);
      }
    }
  });
  test("a cone of π or more is the whole sphere", () => {
    const r = seq(5);
    let down = 0;
    for (let i = 0; i < 200; i++) if (randomInCone(0, 1, 0, Math.PI, v, r).y < 0) down++;
    expect(down).toBeGreaterThan(50);
  });
  test("ringPoint lies on the horizontal circle", () => {
    ringPoint(1.1, 2.5, v);
    expect(v.y).toBe(0);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(2.5);
  });
});

describe("budgets", () => {
  test("budgetCount is the nominal count while the pool has room", () => {
    expect(budgetCount(40, 0)).toBe(40);
    expect(budgetCount(40, 0.6)).toBe(40);
  });
  test("thins to a quarter as the pool fills, never to zero", () => {
    expect(budgetCount(40, 1)).toBe(10);
    expect(budgetCount(40, 0.8)).toBeLessThan(40);
    expect(budgetCount(1, 1)).toBe(1);
    expect(budgetCount(0, 0.2)).toBe(0);
  });
  test("trailSteps spaces trail particles along the path, capped", () => {
    expect(trailSteps(0, 0.1, 10)).toBe(0);
    expect(trailSteps(0.02, 0.1, 10)).toBe(1);
    expect(trailSteps(0.5, 0.1, 10)).toBe(5);
    expect(trailSteps(50, 0.1, 10)).toBe(10);
  });
});
