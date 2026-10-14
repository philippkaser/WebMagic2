import { describe, expect, test } from "bun:test";
import { ARENA, boutOver, newScoreboard, ranked, recordFall, winnerOf } from "./rules";

describe("the Proving Ground's rules", () => {
  const players = [
    { id: "a", name: "Ann" },
    { id: "b", name: "Bo" },
    { id: "c", name: "Cy" },
  ];

  test("a fall gives the killer a yield; a fall by your own hand gives no one anything", () => {
    let board = newScoreboard(players);
    board = recordFall(board, "b", "a", 10);
    board = recordFall(board, "a", "a", 11);
    expect(board.find((s) => s.id === "a")).toMatchObject({ kills: 1, falls: 1 });
    expect(board.find((s) => s.id === "b")).toMatchObject({ kills: 0, falls: 1 });
  });

  test("most yields wins; ties go to fewer falls, then to who scored first", () => {
    let board = newScoreboard(players);
    board = recordFall(board, "c", "a", 5);
    board = recordFall(board, "c", "b", 3);
    board = recordFall(board, "a", "c", 7);
    // a and b both have 1 kill; a fell once, b never.
    expect(ranked(board).map((s) => s.id)).toEqual(["b", "a", "c"]);
    expect(winnerOf(board)).toBe("b");
    expect(winnerOf(newScoreboard(players))).toBeNull();
    // b deserted: the bout goes to who's still standing in the hall.
    expect(winnerOf(board, new Set(["a", "c"]))).toBe("a");
  });

  test("a bout ends on the score or when the sands run out", () => {
    let board = newScoreboard(players);
    expect(boutOver(board, 0, ARENA.durationMs - 1)).toBe(false);
    expect(boutOver(board, 0, ARENA.durationMs)).toBe(true);
    for (let i = 0; i < ARENA.killsToWin; i++) board = recordFall(board, "b", "a", i);
    expect(boutOver(board, 0, 1000)).toBe(true);
  });
});
