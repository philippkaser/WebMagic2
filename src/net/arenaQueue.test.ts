import { describe, expect, test } from "bun:test";
import { ARENA } from "../arena/rules";
import { ArenaQueue } from "./arenaQueue";

describe("the obelisk's queue", () => {
  test("two challengers start a bout after the gathering breath", () => {
    const q = new ArenaQueue();
    q.join("a", 0);
    expect(q.take(100_000)).toBeNull(); // alone
    q.join("b", 1000);
    expect(q.take(1000 + ARENA.gatherMs - 1)).toBeNull();
    expect(q.take(1000 + ARENA.gatherMs)).toEqual(["a", "b"]);
    expect(q.size).toBe(0);
  });

  test("a full hall starts at once; the rest wait for the next bout", () => {
    const q = new ArenaQueue();
    for (let i = 0; i < ARENA.maxPlayers + 1; i++) q.join(`p${i}`, i);
    expect(q.take(10)).toHaveLength(ARENA.maxPlayers);
    expect(q.position(`p${ARENA.maxPlayers}`)).toBe(1);
  });

  test("joining twice keeps your place; leaving gives it up", () => {
    const q = new ArenaQueue();
    q.join("a", 0);
    q.join("b", 1);
    expect(q.join("a", 5)).toBe(1);
    q.leave("a");
    expect(q.position("b")).toBe(1);
    expect(q.has("a")).toBe(false);
  });
});
