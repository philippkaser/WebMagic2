import { describe, expect, test } from "bun:test";
import { FloorDirectory } from "./matchmaking";

function makeDirectory() {
  let seed = 1;
  let now = 0;
  return new FloorDirectory(4, () => seed++, () => now++);
}

describe("FloorDirectory", () => {
  test("players entering the same floor share an instance (and its seed)", () => {
    const dir = makeDirectory();
    const a = dir.join("alice", 3);
    const b = dir.join("bob", 3);
    expect(b.id).toBe(a.id);
    expect(b.seed).toBe(a.seed);
    expect(a.players.size).toBe(2);
  });

  test("a fifth player overflows into a brand-new instance with a fresh seed", () => {
    const dir = makeDirectory();
    const first = dir.join("p1", 3);
    dir.join("p2", 3);
    dir.join("p3", 3);
    dir.join("p4", 3);
    const overflow = dir.join("p5", 3);
    expect(overflow.id).not.toBe(first.id);
    expect(overflow.seed).not.toBe(first.seed);
    expect(overflow.players.size).toBe(1);
    // And a sixth joins the overflow instance, not another new one.
    const sixth = dir.join("p6", 3);
    expect(sixth.id).toBe(overflow.id);
  });

  test("different floors never share instances", () => {
    const dir = makeDirectory();
    const a = dir.join("alice", 1);
    const b = dir.join("bob", 2);
    expect(a.id).not.toBe(b.id);
  });

  test("descending moves the player and frees their old slot", () => {
    const dir = makeDirectory();
    const f1 = dir.join("alice", 1);
    dir.join("alice", 2);
    expect(dir.instanceOf("alice")!.floor).toBe(2);
    // Old instance was emptied and garbage-collected.
    expect(dir.instancesOnFloor(1)).toHaveLength(0);
    expect(f1.players.size).toBe(0);
  });

  test("leaving frees capacity for the next entrant", () => {
    const dir = makeDirectory();
    const inst = dir.join("p1", 5);
    dir.join("p2", 5);
    dir.join("p3", 5);
    dir.join("p4", 5);
    dir.leave("p2");
    const rejoin = dir.join("p5", 5);
    expect(rejoin.id).toBe(inst.id);
  });

  test("oldest instance with room fills first", () => {
    const dir = makeDirectory();
    const first = dir.join("p1", 7);
    dir.join("p2", 7);
    dir.join("p3", 7);
    dir.join("p4", 7); // first is now full
    const second = dir.join("p5", 7); // new instance
    dir.leave("p1"); // room opens in the oldest again
    const next = dir.join("p6", 7);
    expect(next.id).toBe(first.id);
    expect(second.id).not.toBe(first.id);
  });
});
