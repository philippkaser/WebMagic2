import { describe, expect, test } from "bun:test";
import { FloorDirectory } from "./matchmaking";

/** Directory with a scripted "random": each call pops the next value. */
function makeDirectory(rolls: number[] = [], joinChance = 0.3, max = 3) {
  let seed = 1;
  let now = 0;
  const dir = new FloorDirectory({
    maxPerInstance: max,
    joinChance,
    random: () => rolls.shift() ?? 0.99,
    seedFn: () => seed++,
    now: () => now++,
  });
  return dir;
}

describe("FloorDirectory — encounters", () => {
  test("a failed encounter roll gives you a floor of your own", () => {
    const dir = makeDirectory([0.9]);
    const a = dir.join("alice", 3);
    const b = dir.join("bob", 3);
    expect(b.instance.id).not.toBe(a.instance.id);
    expect(b.joinedExisting).toBe(false);
    expect(b.instance.seed).not.toBe(a.instance.seed);
  });

  test("a successful roll drops you into someone's floor (same seed)", () => {
    const dir = makeDirectory([0.1, 0]);
    const a = dir.join("alice", 3);
    const b = dir.join("bob", 3);
    expect(b.instance.id).toBe(a.instance.id);
    expect(b.instance.seed).toBe(a.instance.seed);
    expect(b.joinedExisting).toBe(true);
  });

  test("only wizards on the same floor number ever meet", () => {
    const dir = makeDirectory([], 1);
    const a = dir.join("alice", 1);
    const b = dir.join("bob", 2);
    expect(a.instance.id).not.toBe(b.instance.id);
  });

  test("full instances are never joined", () => {
    const dir = makeDirectory([], 1, 2);
    dir.join("p1", 4);
    dir.join("p2", 4);
    const third = dir.join("p3", 4);
    expect(third.joinedExisting).toBe(false);
    expect(third.instance.players.size).toBe(1);
  });

  test("pact partners travel together regardless of the roll", () => {
    const dir = makeDirectory([], 0);
    const a = dir.join("alice", 6);
    const b = dir.join("bob", 6, ["alice"]);
    expect(b.instance.id).toBe(a.instance.id);
  });

  test("encounter rate converges on joinChance", () => {
    const dir = new FloorDirectory({ maxPerInstance: 99, joinChance: 0.3 });
    dir.join("anchor", 9);
    let met = 0;
    for (let i = 0; i < 4000; i++) {
      const r = dir.join(`p${i}`, 9);
      if (r.joinedExisting) met++;
      dir.leave(`p${i}`);
    }
    expect(met / 4000).toBeGreaterThan(0.26);
    expect(met / 4000).toBeLessThan(0.34);
  });

  test("descending frees the old slot; empty instances are disposed", () => {
    const dir = makeDirectory();
    const disposed: string[] = [];
    dir.onDispose = (i) => disposed.push(i.id);
    const f1 = dir.join("alice", 1);
    dir.join("alice", 2);
    expect(dir.instanceOf("alice")!.floor).toBe(2);
    expect(dir.instancesOnFloor(1)).toHaveLength(0);
    expect(disposed).toEqual([f1.instance.id]);
  });

  test("host is the oldest member and migrates on leave", () => {
    const dir = makeDirectory([0, 0], 1);
    const a = dir.join("alice", 5);
    dir.join("bob", 5);
    expect(dir.hostOf(a.instance)).toBe("alice");
    dir.leave("alice");
    expect(dir.hostOf(a.instance)).toBe("bob");
  });
});
