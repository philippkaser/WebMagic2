import { describe, expect, test } from "bun:test";
import { CONFIRM, confirmPitch, createConfirm, flushConfirm, marksAt, newMarks, noteHit, noteKill, pendingDue } from "./confirm";

/** Drive a confirm like the shell does: hits at their times, the held sound
 * flushed when it falls due. Returns the times sounds played. */
function play(hits: { at: number; weight: number; frac?: number }[], until: number): number[] {
  const c = createConfirm();
  const played: number[] = [];
  let i = 0;
  for (let t = 0; t <= until; t += 0.001) {
    while (i < hits.length && hits[i]!.at <= t) {
      const h = hits[i++]!;
      if (noteHit(c, t, h.weight, h.frac ?? 0.5, false)) played.push(t);
    }
    const due = pendingDue(c);
    if (due !== null && t >= due && flushConfirm(c, t)) played.push(t);
  }
  return played;
}

describe("the hit confirm", () => {
  test("a held beam at 12.5 Hz makes at most 9 sounds a second", () => {
    const hits = Array.from({ length: 13 }, (_, i) => ({ at: i * 0.08, weight: 0.1 }));
    const played = play(hits, 1);
    expect(played.length).toBeLessThanOrEqual(9);
    expect(played.length).toBeGreaterThanOrEqual(6);
  });

  test("heavy shots each get their own sound, a gate apart", () => {
    const hits = Array.from({ length: 5 }, (_, i) => ({ at: i * 0.07, weight: 0.8 }));
    expect(play(hits, 1).length).toBe(5);
  });

  test("a flame hitting four creatures at once is one sound, weighing all four", () => {
    const c = createConfirm();
    const first = noteHit(c, 1, 0.1, 0.9, false);
    expect(first).not.toBeNull();
    for (let i = 0; i < 4; i++) expect(noteHit(c, 1.08, 0.1, 0.4 + i * 0.1, false)).toBeNull();
    const held = flushConfirm(c, 1 + CONFIRM.lightGate + 1e-9);
    expect(held).not.toBeNull();
    expect(held!.weight).toBeCloseTo(0.4, 9);
    // The lowest life among them sets the pitch.
    expect(held!.pitch).toBeCloseTo(confirmPitch(0.4), 9);
    expect(flushConfirm(c, 2)).toBeNull();
  });

  test("a kill supersedes a tick: the held sound is dropped and the X shows", () => {
    const c = createConfirm();
    noteHit(c, 0, 0.8, 0.5, false);
    noteHit(c, 0.02, 0.8, 0.1, false);
    expect(pendingDue(c)).not.toBeNull();
    expect(noteKill(c, 0.03, "w1", false)).toBe(true);
    expect(pendingDue(c)).toBeNull();
    const m = marksAt(c, 0.04, newMarks());
    expect(m.kill).toBe(1);
    expect(m.tick).toBe(0);
  });

  test("a kill is confirmed once, though two signals report it", () => {
    const c = createConfirm();
    expect(noteKill(c, 0, "w1", false)).toBe(true);
    expect(noteKill(c, 0.12, "w1", false)).toBe(false);
    expect(noteKill(c, 0.12, "w2", false)).toBe(true);
    expect(noteKill(c, 0 + CONFIRM.killMemory + 0.01, "w1", false)).toBe(true);
  });

  test("the pitch climbs monotonically, and most of it past the knee", () => {
    expect(confirmPitch(1)).toBe(1);
    expect(confirmPitch(0)).toBeCloseTo(1.6, 9);
    let prev = 0;
    for (let f = 1; f >= 0; f -= 0.01) {
      const p = confirmPitch(f);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
    expect(confirmPitch(0) - confirmPitch(0.5)).toBeGreaterThan(confirmPitch(0.5) - confirmPitch(1));
    expect(confirmPitch(Number.NaN)).toBe(1);
  });

  test("the marks: ticks fade and step out, the X holds then steps away in three", () => {
    const c = createConfirm();
    const m = newMarks();
    noteHit(c, 0, 0.9, 0.5, true);
    expect(marksAt(c, 0, m).tick).toBe(1);
    expect(m.crit).toBe(true);
    expect(m.heavy).toBe(true);
    expect(m.spread).toBe(0);
    expect(marksAt(c, CONFIRM.tickLife * 0.9, m).spread).toBe(2);
    expect(marksAt(c, CONFIRM.tickLife, m).tick).toBe(0);
    noteKill(c, 1, "x", false);
    expect(marksAt(c, 1 + CONFIRM.killHold - 0.001, m).kill).toBe(1);
    const steps = new Set<string>();
    for (let t = 0; t < CONFIRM.killOut; t += 0.002) steps.add(marksAt(c, 1 + CONFIRM.killHold + t, m).kill.toFixed(3));
    expect([...steps]).toEqual(["0.667", "0.333"]);
    expect(marksAt(c, 1 + CONFIRM.killHold + CONFIRM.killOut, m).kill).toBe(0);
  });
});
