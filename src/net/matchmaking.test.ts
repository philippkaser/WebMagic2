import { describe, expect, test } from "bun:test";
import { ENCOUNTERS } from "../core/config";
import { FloorDirectory } from "./matchmaking";

/** A directory whose dice always roll `roll` (0 = every encounter succeeds,
 * 0.999 = none ever do). */
function makeDirectory(roll = 0) {
  let seed = 1;
  let now = 0;
  return new FloorDirectory(4, () => seed++, () => now++, () => roll);
}

describe("FloorDirectory — sharing (encounter rolls succeed)", () => {
  test("players entering the same floor share an instance (and its seed)", () => {
    const dir = makeDirectory(0);
    const a = dir.join("alice", 3);
    const b = dir.join("bob", 3);
    expect(b.id).toBe(a.id);
    expect(b.seed).toBe(a.seed);
    expect(a.players.size).toBe(2);
  });

  test("a full instance overflows into a brand-new instance with a fresh seed", () => {
    const dir = makeDirectory(0);
    const first = dir.join("p1", 3);
    dir.join("p2", 3);
    dir.join("p3", 3);
    dir.join("p4", 3);
    const overflow = dir.join("p5", 3);
    expect(overflow.id).not.toBe(first.id);
    expect(overflow.seed).not.toBe(first.seed);
    expect(overflow.players.size).toBe(1);
  });

  test("different floors never share instances, whatever the dice say", () => {
    const dir = makeDirectory(0);
    const a = dir.join("alice", 1);
    const b = dir.join("bob", 2);
    expect(a.id).not.toBe(b.id);
  });

  test("descending moves the player and frees their old slot", () => {
    const dir = makeDirectory(0);
    const f1 = dir.join("alice", 1);
    dir.join("alice", 2);
    expect(dir.instanceOf("alice")!.floor).toBe(2);
    expect(f1.players.size).toBe(0);
    // The emptied instance lingers (for reconnects), invisible to encounters.
    expect(f1.emptySince).not.toBeNull();
  });

  test("host is the first joiner and migrates in join order", () => {
    const dir = makeDirectory(0);
    const inst = dir.join("p1", 3);
    dir.join("p2", 3);
    dir.join("p3", 3);
    const first = () => inst.players.values().next().value;
    expect(first()).toBe("p1");
    dir.leave("p1");
    expect(first()).toBe("p2");
    dir.leave("p3");
    expect(first()).toBe("p2");
  });
});

describe("FloorDirectory — the tension clock", () => {
  test("failed rolls keep wizards apart, each in a private instance", () => {
    const dir = makeDirectory(0.999);
    const a = dir.join("alice", 4);
    const b = dir.join("bob", 4);
    expect(a.id).not.toBe(b.id);
    expect(a.seed).not.toBe(b.seed);
    expect(dir.instancesOnFloor(4)).toHaveLength(2);
  });

  test("every floor walked alone raises the odds, up to the cap", () => {
    const dir = makeDirectory(0.999);
    expect(dir.encounterChance("alice")).toBeCloseTo(ENCOUNTERS.baseChance);
    dir.join("alice", 1);
    expect(dir.encounterChance("alice")).toBeCloseTo(ENCOUNTERS.baseChance + ENCOUNTERS.perSoloFloor);
    for (let f = 2; f <= 20; f++) dir.join("alice", f);
    expect(dir.encounterChance("alice")).toBeCloseTo(ENCOUNTERS.maxChance);
  });

  test("a meeting resets the clock", () => {
    let roll = 0.999;
    const dir = new FloorDirectory(4, () => 7, () => 0, () => roll);
    dir.join("alice", 2);
    dir.join("bob", 1);
    dir.join("bob", 2); // alone again (roll fails) — bob's streak is 2
    roll = 0;
    dir.join("carol", 2); // carol meets someone
    expect(dir.encounterChance("carol")).toBeCloseTo(ENCOUNTERS.baseChance);
  });

  test("the roll only matters when someone is there to meet", () => {
    const dir = makeDirectory(0);
    const solo = dir.join("alice", 9);
    expect(solo.players.size).toBe(1);
    // Nobody else on floor 9, so alice walked it alone: her clock advanced.
    expect(dir.encounterChance("alice")).toBeGreaterThan(ENCOUNTERS.baseChance);
  });

  test("odds follow the dice: with realistic rolls most entries stay private", () => {
    let x = 12345;
    const dice = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    const dir = new FloorDirectory(4, () => x, () => 0, dice);
    dir.join("resident", 6); // someone is always waiting on floor 6
    let met = 0;
    for (let i = 0; i < 400; i++) {
      const inst = dir.join(`visitor${i}`, 6);
      if (inst.players.has("resident")) met++;
      dir.forget(`visitor${i}`);
    }
    // First-entry chance is the base chance — rare, but it happens.
    expect(met).toBeGreaterThan(400 * ENCOUNTERS.baseChance * 0.5);
    expect(met).toBeLessThan(400 * ENCOUNTERS.baseChance * 1.8);
  });
});

describe("FloorDirectory — reconnect affinity", () => {
  test("preferInstanceId puts a dropped wizard back where they were, no roll", () => {
    const dir = makeDirectory(0.999); // rolls would always fail
    const inst = dir.join("alice", 5);
    dir.join("bob", 5, { preferInstanceId: inst.id });
    expect(inst.players.has("bob")).toBe(true);
  });

  test("a stale or foreign preference falls back to the normal rules", () => {
    const dir = makeDirectory(0.999);
    const on5 = dir.join("alice", 5);
    const back = dir.join("bob", 6, { preferInstanceId: on5.id }); // wrong floor
    expect(back.id).not.toBe(on5.id);
    const ghost = dir.join("carol", 5, { preferInstanceId: "inst_999" });
    expect(ghost.id).not.toBe(on5.id);
  });
});

describe("FloorDirectory — lingering instances", () => {
  function clocked(lingerMs = 1000) {
    let now = 0;
    let seed = 1;
    const dir = new FloorDirectory(4, () => seed++, () => now, () => 0, undefined, lingerMs);
    return { dir, tick: (ms: number) => (now += ms) };
  }

  test("a solo wizard who drops comes back to the same world", () => {
    const { dir, tick } = clocked();
    const before = dir.join("alice", 7);
    dir.forget("alice"); // socket dropped
    tick(500);
    const after = dir.join("alice2", 7, { preferInstanceId: before.id });
    expect(after.id).toBe(before.id);
    expect(after.seed).toBe(before.seed);
  });

  test("strangers never walk into an empty lingering instance", () => {
    const { dir } = clocked();
    const alone = dir.join("alice", 7);
    dir.leave("alice");
    const bob = dir.join("bob", 7); // dice always succeed, but nobody is there
    expect(bob.id).not.toBe(alone.id);
  });

  test("empty instances are garbage-collected after their linger time", () => {
    const { dir, tick } = clocked(1000);
    const gone = dir.join("alice", 3);
    dir.leave("alice");
    tick(999);
    dir.join("bob", 9);
    expect(dir.instanceById(gone.id)).not.toBeNull();
    tick(1);
    dir.join("carol", 9);
    expect(dir.instanceById(gone.id)).toBeNull();
  });
});
