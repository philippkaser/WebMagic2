import { describe, expect, test } from "bun:test";
import {
  createHitGate,
  createQuietTally,
  createStagger,
  dirOf,
  GATE_S,
  hitStrength,
  hitTier,
  NO_DIR,
  passGate,
  quantDir,
  quietSince,
  readHitExtras,
  sparkScale,
  STAGGER,
  staggerFor,
} from "./hitFx";

describe("hit weight", () => {
  test("strength is clamped and grows with the share of life", () => {
    expect(hitStrength(0.1, 100)).toBe(0.12);
    expect(hitStrength(20, 100)).toBeCloseTo(0.5, 6);
    expect(hitStrength(999, 30)).toBe(1);
  });

  test("tiers: chip, solid, heavy", () => {
    expect(hitTier(1, 100)).toBe(0);
    expect(hitTier(10, 100)).toBe(1);
    expect(hitTier(25, 100)).toBe(2);
  });

  test("spark size grows from a scratch to a whole life", () => {
    expect(sparkScale(0, 30)).toBeCloseTo(0.6, 6);
    expect(sparkScale(30, 30)).toBeCloseTo(2, 6);
    expect(sparkScale(5, 30)).toBeGreaterThan(sparkScale(1, 30));
  });
});

describe("the hit gate", () => {
  test("pops at most once per interval and carries what it didn't show", () => {
    const g = createHitGate();
    expect(passGate(g, 5, 0)).toBe(5);
    expect(passGate(g, 5, 0.02)).toBe(0);
    expect(passGate(g, 5, 0.05)).toBe(0);
    expect(passGate(g, 5, GATE_S + 0.001)).toBe(15);
  });

  test("a beam at 12.5 Hz shows every tick's damage, in fewer, bigger pops", () => {
    const g = createHitGate();
    let shown = 0;
    let pops = 0;
    for (let i = 0; i < 125; i++) {
      const s = passGate(g, 5, i * 0.08);
      if (s > 0) pops++;
      shown += s;
    }
    expect(pops).toBeLessThanOrEqual(125);
    expect(shown).toBe(625);
  });
});

describe("the stagger budget", () => {
  test("a heavy bolt earns the full stagger", () => {
    expect(staggerFor(createStagger(), 20, 30, 0)).toBeCloseTo(STAGGER.max, 6);
  });

  test("beam ticks earn slivers, then nothing once the bank is dry", () => {
    const s = createStagger();
    const first = staggerFor(s, 5, 30, 0);
    expect(first).toBeGreaterThan(0.05);
    expect(first).toBeLessThan(0.1);
    let total = first;
    let lastNonZero = 0;
    for (let i = 1; i < 125; i++) {
      const g = staggerFor(s, 5, 30, i * 0.08);
      total += g;
      if (g > 0) lastNonZero = i;
    }
    // Ten seconds of beam: at most the bank plus its refill — never stunlocked.
    expect(total).toBeLessThanOrEqual(STAGGER.bank + 10 * STAGGER.refill + 1e-6);
    expect(total).toBeLessThan(10 * 0.5);
    expect(lastNonZero).toBeGreaterThan(0);
  });

  test("the bank refills with time", () => {
    const s = createStagger();
    staggerFor(s, 30, 30, 0);
    staggerFor(s, 30, 30, 0);
    expect(staggerFor(s, 30, 30, 0)).toBe(0);
    expect(staggerFor(s, 30, 30, 2)).toBeCloseTo(STAGGER.max, 6);
  });
});

describe("the blow's direction on the wire", () => {
  test("16 steps round-trip within a step", () => {
    const out = { x: 0, z: 0 };
    for (let a = -Math.PI; a < Math.PI; a += 0.1) {
      const k = quantDir(Math.cos(a) * 7, Math.sin(a) * 7);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(16);
      expect(dirOf(k, out)).toBe(true);
      expect(out.x * Math.cos(a) + out.z * Math.sin(a)).toBeGreaterThan(Math.cos(Math.PI / 16) - 1e-9);
    }
  });

  test("a push straight down has no direction", () => {
    expect(quantDir(0, 0)).toBe(NO_DIR);
    expect(dirOf(NO_DIR, { x: 0, z: 0 })).toBe(false);
    expect(dirOf(3.5, { x: 0, z: 0 })).toBe(false);
    expect(dirOf(-1, { x: 0, z: 0 })).toBe(false);
  });
});

describe("hit command extras", () => {
  test("reads a well-formed command", () => {
    const e = readHitExtras({ damage: 5, impulse: { x: 0, y: 0, z: 0 }, at: [1, 2, 3], m: 1, q: 1, c: 1 });
    expect(e.at).toEqual([1, 2, 3]);
    expect(e.mine).toBe(true);
    expect(e.quiet).toBe(true);
    expect(e.crit).toBe(true);
  });

  test("drops junk instead of trusting it", () => {
    expect(readHitExtras(null)).toEqual({ at: null, mine: false, quiet: false, crit: false });
    const e = readHitExtras({ at: [1, NaN, 3], m: "yes", q: true });
    expect(e.at).toBeNull();
    expect(e.mine).toBe(false);
    expect(e.quiet).toBe(false);
    expect(readHitExtras({ at: [1e9, 0, 0] }).at).toBeNull();
    expect(readHitExtras({ at: [1, 2] }).at).toBeNull();
  });
});

describe("quiet damage on the wire", () => {
  test("a tug's share of a snapshot's drop is quiet; a real blow in the same snapshot is not", () => {
    const t = createQuietTally();
    expect(quietSince(t, 1.5)).toBe(1.5); // a tug alone: the whole drop
    expect(quietSince(t, 3)).toBe(1.5); // a tug and a 10 hp bolt: of the 11.5 drop, the bolt shows
    expect(quietSince(t, 3)).toBe(0); // a bolt alone: nothing quiet
  });

  test("no field (never tugged) or garbage reads as nothing quiet, and it never counts backwards", () => {
    const t = createQuietTally();
    expect(quietSince(t, undefined)).toBe(0);
    expect(quietSince(t, Number.NaN)).toBe(0);
    expect(quietSince(t, "4")).toBe(0);
    expect(t.dealt).toBe(0);
    quietSince(t, 6);
    expect(quietSince(t, 4.5)).toBe(0);
    expect(t.dealt).toBe(4.5);
  });

  test("a migrated host carries on from the last total it read as a replica", () => {
    const host = createQuietTally();
    const replica = createQuietTally();
    quietSince(host, 9);
    quietSince(replica, 9);
    host.dealt += 1.5; // it holds the body now: one more tug
    expect(quietSince(replica, host.dealt)).toBe(1.5);
  });
});
