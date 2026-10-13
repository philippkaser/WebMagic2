import { describe, expect, test } from "bun:test";
import { type DecalSpec, DecalKind, DecalPool, scorchFor, splatFor } from "./decalPool";

const spec = (x = 0): DecalSpec => ({
  kind: DecalKind.scorch,
  x,
  z: 0,
  size: 1,
  rot: 0,
  variant: 0,
  tint: [1, 1, 1],
  glow: [1, 0.5, 0.2],
  glowStrength: 1,
  glowSeconds: 5,
});

describe("decal pool", () => {
  test("fills free slots first", () => {
    const p = new DecalPool(8, 6, 2);
    const slots = [0, 1, 2].map((i) => p.add(spec(i), i));
    expect(new Set(slots).size).toBe(3);
    expect(p.count).toBe(3);
    expect(p.liveCount).toBe(3);
  });

  test("past the soft cap the oldest fade, then free their slot", () => {
    const p = new DecalPool(8, 4, 2);
    const slots: number[] = [];
    for (let i = 0; i < 6; i++) slots.push(p.add(spec(i), i * 0.1));
    expect(p.liveCount).toBe(4);
    expect(p.count).toBe(6);
    // The two oldest are fading, the rest whole.
    expect(p.fade(slots[0], 0.6)).toBeLessThan(1);
    expect(p.fade(slots[1], 0.6)).toBeLessThan(1);
    expect(p.fade(slots[5], 0.6)).toBe(1);
    // Fading runs down to nothing over fadeSeconds…
    expect(p.fade(slots[0], 0.4 + 1)).toBeCloseTo(0.5, 5);
    // …and the slots come free.
    const freed = p.update(10);
    expect(freed.sort()).toEqual([slots[0], slots[1]].sort());
    expect(p.count).toBe(4);
    expect(p.fade(slots[0], 10)).toBe(0);
  });

  test("never more than capacity: a full pool overwrites its oldest", () => {
    const p = new DecalPool(5, 5, 2);
    for (let i = 0; i < 5; i++) p.add(spec(i), i);
    const s = p.add(spec(99), 10);
    expect(p.slots[s]!.x).toBe(99);
    expect(p.count).toBe(5);
    expect(p.slots.some((d) => d?.x === 0)).toBe(false);
    expect(p.liveCount).toBe(5);
  });

  test("a long fight keeps the newest marks", () => {
    const p = new DecalPool(200, 184, 2.5);
    for (let i = 0; i < 2000; i++) {
      p.add(spec(i), i * 0.05);
      p.update(i * 0.05);
    }
    expect(p.count).toBeLessThanOrEqual(200);
    expect(p.liveCount).toBe(184);
    const xs = p.slots.filter((d) => d && d.fadeStart === Infinity).map((d) => d!.x);
    expect(Math.min(...xs)).toBe(2000 - 184);
  });

  test("clear empties it", () => {
    const p = new DecalPool(4, 4, 1);
    p.add(spec(), 0);
    p.clear();
    expect(p.count).toBe(0);
    expect(p.liveCount).toBe(0);
  });
});

describe("what blasts and deaths leave", () => {
  const blast = { x: 3, y: 0.2, z: -2, radius: 1.7, color: [1, 0.4, 0.1] as [number, number, number], power: 14 / 36, vfx: "blast" as const };

  test("a bolt's pop scuffs; a barrel craters; same spot, same look", () => {
    const pop = scorchFor(blast)!;
    const barrel = scorchFor({ ...blast, radius: 3.5, power: 1 })!;
    expect(pop.size).toBeGreaterThan(0.45);
    expect(pop.size).toBeLessThan(1.8);
    expect(barrel.size).toBeGreaterThan(pop.size * 2);
    expect(barrel.size).toBeLessThanOrEqual(4.6);
    expect(scorchFor(blast)).toEqual(pop);
    expect(pop.glow).toEqual(blast.color);
  });

  test("no scorch from a ring of force, or a blast up in the air", () => {
    expect(scorchFor({ ...blast, vfx: "shockwave" })).toBeNull();
    expect(scorchFor({ ...blast, y: 1.65 })).toBeNull();
    // Half-way up the sphere: a smaller scorch than at the floor.
    expect(scorchFor({ ...blast, y: 1.0 })!.size).toBeLessThan(scorchFor(blast)!.size);
  });

  test("deaths: goo, shards or ash by the body's burst style", () => {
    const base = { x: 1, y: 0.5, z: 1, body: [0.2, 0.7, 0.1] as [number, number, number], soul: [0.6, 0.9, 0.4] as [number, number, number], scale: 1 };
    expect(splatFor(base).kind).toBe(DecalKind.goo);
    expect(splatFor({ ...base, style: "shard" }).kind).toBe(DecalKind.shards);
    expect(splatFor({ ...base, style: "smoke" }).kind).toBe(DecalKind.ash);
    expect(splatFor({ ...base, style: "spark" }).kind).toBe(DecalKind.ash);
    // Goo keeps the body's hue (green stays green).
    const t = splatFor(base).tint;
    expect(t[1]).toBeGreaterThan(t[0]);
    expect(t[1]).toBeGreaterThan(t[2]);
    // Bigger creatures, bigger marks — within bounds.
    expect(splatFor({ ...base, scale: 2 }).size).toBeGreaterThan(splatFor(base).size);
    expect(splatFor({ ...base, scale: 9 }).size).toBeLessThanOrEqual(3.4);
  });
});
