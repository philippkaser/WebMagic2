import { describe, expect, test } from "bun:test";
import { TILE } from "../core/config";
import { generateFloor } from "../world/gen";
import {
  analyzeRoom,
  gridFromLayout,
  impulseResponse,
  lineOfSight,
  openAt,
  soundPath,
  traceRay,
  villageGrid,
  type AcousticGrid,
} from "./acoustics";

/** A grid from ASCII rows: '#' solid, '.' open; 1 m cells, origin at 0. */
function grid(rows: string[], outside: "solid" | "open" = "solid"): AcousticGrid {
  const size = rows.length;
  const solid = new Uint8Array(size * size);
  rows.forEach((r, z) => [...r].forEach((c, x) => (solid[z * size + x] = c === "#" ? 1 : 0)));
  return { cell: 1, size, x0: 0, z0: 0, solid, ceiling: 4, outside, surfaces: { absorption: 0.05, brightness: 0.5 } };
}

// An L-shaped corridor: east along row 1, then south down column 8.
const L = grid([
  "##########",
  "#........#",
  "########.#",
  "########.#",
  "########.#",
  "########.#",
  "########.#",
  "########.#",
  "########.#",
  "##########",
]);

describe("acoustics", () => {
  test("open air vs rock", () => {
    expect(openAt(L, 1.5, 1.5)).toBe(true);
    expect(openAt(L, 1.5, 2.5)).toBe(false);
    // Past the edge: rock underground, air under the sky.
    expect(openAt(L, -3, 1.5)).toBe(false);
    expect(openAt(grid(["..", ".."], "open"), -3, 1.5)).toBe(true);
  });

  test("rays stop at the first wall", () => {
    // From the corridor's west end heading east: the wall is at x = 9.
    expect(traceRay(L, 1.5, 1.5, 1, 0, 50)).toBeCloseTo(7.5, 6);
    // Heading north: the wall is right there.
    expect(traceRay(L, 1.5, 1.5, 0, -1, 50)).toBeCloseTo(0.5, 6);
    // Out into open air beyond an open grid's edge: never returns.
    const open = grid(["...", "...", "..."], "open");
    expect(traceRay(open, 1.5, 1.5, 1, 0, 50)).toBe(Infinity);
  });

  test("line of sight", () => {
    expect(lineOfSight(L, 1.5, 1.5, 7.5, 1.5)).toBe(true);
    expect(lineOfSight(L, 1.5, 1.5, 8.5, 7.5)).toBe(false);
  });

  test("round the corner: the sound comes from the opening, from as far as it went", () => {
    const p = soundPath(L, 1.5, 1.5, 8.5, 7.5);
    expect(p.blocked).toBe(false);
    expect(p.corners).toBeGreaterThanOrEqual(1);
    // Longer than straight through the rock, about along the corridor.
    expect(p.length).toBeGreaterThan(Math.hypot(7, 6));
    expect(p.length).toBeLessThan(7 + 6 + 1.5);
    // It seems to come from the east (down the corridor), not the south-east
    // through the wall.
    const dx = p.apparent[0] - 1.5;
    const dz = p.apparent[1] - 1.5;
    expect(Math.abs(Math.atan2(dz, dx))).toBeLessThan(0.2);
    expect(Math.hypot(dx, dz)).toBeCloseTo(p.length, 6);
  });

  test("in plain sight it's direct", () => {
    const p = soundPath(L, 1.5, 1.5, 6.5, 1.5);
    expect(p).toEqual({ length: 5, apparent: [6.5, 1.5], corners: 0, blocked: false });
  });

  test("sealed off: heard only through the rock", () => {
    const sealed = grid(["#####", "#.#.#", "#.#.#", "#.#.#", "#####"]);
    expect(soundPath(sealed, 1.5, 1.5, 3.5, 3.5).blocked).toBe(true);
  });

  test("a hall rings longer than a corridor, and the open village hardly at all", () => {
    const hall = grid(Array.from({ length: 30 }, (_, z) => (z === 0 || z === 29 ? "#".repeat(30) : "#" + ".".repeat(28) + "#")));
    const big = analyzeRoom(hall, 15, 15);
    const corridor = analyzeRoom(L, 4.5, 1.5);
    expect(big.rt60).toBeGreaterThan(corridor.rt60);
    expect(big.area).toBeGreaterThan(corridor.area);
    expect(big.reflections.length).toBe(8);
    const village = analyzeRoom(villageGrid(), 0, 10);
    expect(village.openness).toBeGreaterThan(0.5);
    expect(village.wet).toBeLessThan(big.wet);
    expect(village.ceiling).toBeNull();
  });

  test("the dungeon's grid is its tiles", () => {
    const layout = generateFloor(31, 4);
    const g = gridFromLayout(layout);
    expect(g.cell).toBe(TILE);
    const [sx, , sz] = layout.spawn;
    // The spawn is open; a ray from it hits a wall somewhere.
    expect(traceRay(g, sx, sz, 1, 0, 200)).toBeGreaterThan(0);
    expect(Number.isFinite(traceRay(g, sx, sz, 1, 0, 200))).toBe(true);
    const room = analyzeRoom(g, sx, sz);
    expect(room.rt60).toBeGreaterThan(0.15);
    expect(room.ceiling).not.toBeNull();
  });

  test("the reverb tail: silent pre-delay, then a decay that darkens", () => {
    const sr = 8000;
    const [l, r] = impulseResponse(sr, 1.5, 0.6, 0.02, 3);
    expect(l.length).toBe(Math.ceil((0.02 + 1.5 * 1.1) * sr));
    for (let i = 0; i < Math.floor(0.02 * sr); i++) expect(l[i]).toBe(0);
    const rms = (a: Float32Array, from: number, to: number) => {
      let s = 0;
      for (let i = from; i < to; i++) s += a[i]! * a[i]!;
      return Math.sqrt(s / (to - from));
    };
    const early = rms(l, Math.floor(0.05 * sr), Math.floor(0.25 * sr));
    const late = rms(l, Math.floor(1.2 * sr), Math.floor(1.4 * sr));
    expect(late).toBeLessThan(early * 0.1);
    // The two sides differ (a wide tail).
    expect(l[Math.floor(0.1 * sr)]).not.toBe(r[Math.floor(0.1 * sr)]);
  });
});
