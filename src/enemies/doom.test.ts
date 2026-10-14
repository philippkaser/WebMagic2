import { describe, expect, test } from "bun:test";
import { ack, createLedger, LEDGER_TTL, noteMine, pending, predictedHp } from "./doom";

describe("the doom ledger", () => {
  test("predicts hp from blows the host hasn't confirmed", () => {
    const l = createLedger();
    noteMine(l, 10, 0);
    noteMine(l, 15, 0.05);
    expect(predictedHp(30, l, 0.1)).toBe(5);
    expect(predictedHp(20, l, 0.1)).toBeLessThanOrEqual(0); // lethal: death throes
  });

  test("a snapshot's drop consumes our oldest blows first", () => {
    const l = createLedger();
    noteMine(l, 10, 0);
    noteMine(l, 15, 0.05);
    expect(ack(l, 10, 0.1)).toBe(10);
    expect(pending(l, 0.1)).toBe(15);
    expect(ack(l, 5, 0.12)).toBe(5);
    expect(pending(l, 0.12)).toBe(10);
  });

  test("a teammate's damage in the same snapshot is left over", () => {
    const l = createLedger();
    noteMine(l, 10, 0);
    // The host applied our 10 and someone else's 12 between two snapshots.
    expect(ack(l, 22, 0.1)).toBe(10);
    expect(pending(l, 0.1)).toBe(0);
  });

  test("blows the host never confirms expire (a misprediction heals)", () => {
    const l = createLedger();
    noteMine(l, 50, 0);
    expect(predictedHp(30, l, 0.1)).toBeLessThan(0);
    expect(predictedHp(30, l, LEDGER_TTL + 0.01)).toBe(30);
  });

  test("never overflows: a held beam folds into the newest entry", () => {
    const l = createLedger();
    for (let i = 0; i < 100; i++) noteMine(l, 1, i * 0.001);
    expect(pending(l, 0.1)).toBeCloseTo(100, 6);
    expect(ack(l, 100, 0.1)).toBeCloseTo(100, 6);
    expect(pending(l, 0.1)).toBeCloseTo(0, 6);
  });

  test("ignores non-damage", () => {
    const l = createLedger();
    noteMine(l, 0, 0);
    noteMine(l, NaN, 0);
    noteMine(l, -4, 0);
    expect(l.n).toBe(0);
  });
});
