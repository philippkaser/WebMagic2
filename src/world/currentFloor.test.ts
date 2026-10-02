import { describe, expect, test } from "bun:test";
import { TILE } from "../core/config";
import { exploredBits, isExplored, markExplored, mergeExplored } from "./currentFloor";
import { generateFloor } from "./gen";

describe("sharing what a wizard has seen", () => {
  test("bits round-trip into another wizard's view of the same floor", () => {
    const mine = generateFloor(77, 3);
    const theirs = generateFloor(77, 3); // the same floor, another machine
    const [x, , z] = mine.spawn;
    markExplored(mine, x, z, 4);
    expect(mergeExplored(theirs, exploredBits(mine))).toBe(true);
    const n = mine.size;
    for (let tz = 0; tz < n; tz++)
      for (let tx = 0; tx < n; tx++) expect(isExplored(theirs, tx, tz)).toBe(isExplored(mine, tx, tz));
    const stx = Math.floor(x / TILE + n / 2);
    const stz = Math.floor(z / TILE + n / 2);
    expect(isExplored(theirs, stx, stz)).toBe(true);
    // Nothing new the second time.
    expect(mergeExplored(theirs, exploredBits(mine))).toBe(false);
  });

  test("garbage and wrong sizes are ignored", () => {
    const f = generateFloor(5, 2);
    expect(mergeExplored(f, "%%%not base64")).toBe(false);
    expect(mergeExplored(f, btoa("abc"))).toBe(false);
  });
});
