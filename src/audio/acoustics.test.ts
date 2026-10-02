import { describe, expect, test } from "bun:test";
import { TILE } from "../core/config";
import { generateFloor } from "../world/gen";
import {
  analyzeRoom,
  gridFromLayout,
  hearing,
  impulseResponse,
  lineOfSight,
  openAt,
  openPoint,
  soundPath,
  traceRay,
  villageGrid,
  type AcousticGrid,
} from "./acoustics";

/** A grid from ASCII rows: '#' solid, '.' open; 1 m cells, origin at 0. */
function grid(rows: string[], outside: "solid" | "open" = "solid", ceiling = 4): AcousticGrid {
  const size = rows.length;
  const solid = new Uint8Array(size * size);
  rows.forEach((r, z) => [...r].forEach((c, x) => (solid[z * size + x] = c === "#" ? 1 : 0)));
  return { cell: 1, size, x0: 0, z0: 0, solid, ceiling, outside, surfaces: { absorption: 0.25, brightness: 0.5 } };
}

/** An empty w × h room (1 m cells) walled in, 6 m to the vault. */
function box(w: number, h: number): AcousticGrid {
  const s = Math.max(w, h) + 2;
  const rows = Array.from({ length: s }, (_, z) => Array.from({ length: s }, (_, x) => (x >= 1 && z >= 1 && x <= w && z <= h ? "." : "#")).join(""));
  return grid(rows, "solid", 6);
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

  test("a way round through cells first reached diagonally is still a way round", () => {
    // (Costs are kept in float64, like the heap's keys: in float32 a
    // diagonal step's cost rounds below the key it was pushed with, the
    // cell looks stale, and everything beyond it goes unheard.)
    // An open hall with a pillar between listener and source.
    const rows = Array.from({ length: 24 }, (_, z) =>
      Array.from({ length: 24 }, (_, x) => (x === 0 || z === 0 || x === 23 || z === 23 || (x >= 10 && x <= 13 && z >= 10 && z <= 13) ? "#" : ".")).join(""),
    );
    const hall = grid(rows);
    for (const [sx, sz] of [[20.5, 20.5], [17.5, 12.5], [12.5, 20.5], [20.5, 14.5]] as const) {
      expect(lineOfSight(hall, 5.5, 5.5, sx, sz) || !soundPath(hall, 5.5, 5.5, sx, sz).blocked).toBe(true);
    }
    // A corridor into a hall on a real floor (where it was found).
    const g = gridFromLayout(generateFloor(1234, 3));
    const p = soundPath(g, -1, 1, 17, 11);
    expect(p.blocked).toBe(false);
    expect(p.length).toBeLessThan(30);
  });

  test("in plain sight it's direct", () => {
    const p = soundPath(L, 1.5, 1.5, 6.5, 1.5);
    expect(p).toEqual({ length: 5, apparent: [6.5, 1.5], corners: 0, bend: 0, blocked: false });
  });

  test("sealed off: heard only through the rock", () => {
    const sealed = grid(["#####", "#.#.#", "#.#.#", "#.#.#", "#####"]);
    expect(soundPath(sealed, 1.5, 1.5, 3.5, 3.5).blocked).toBe(true);
  });

  test("a point in a wall is moved just out of it; deep rock has none", () => {
    // Brushing the corridor's north wall from inside it (y 0.9: the wall row).
    const p = openPoint(L, 3.5, 0.9)!;
    expect(p[0]).toBeCloseTo(3.5, 6);
    expect(p[1]).toBeGreaterThan(1);
    expect(p[1]).toBeLessThan(1.1);
    expect(openPoint(L, 3.5, 5.5)).toBeNull();
    // A listener pressed into the wall still hears down the corridor.
    expect(soundPath(L, 3.5, 0.95, 7.5, 1.5).corners).toBe(0);
  });

  test("round the corner it bends — and gets through less clearly the further", () => {
    // A quarter turn round the L.
    const quarter = soundPath(L, 1.5, 1.5, 8.5, 7.5);
    expect(quarter.bend).toBeGreaterThan(Math.PI / 4);
    expect(quarter.bend).toBeLessThan(Math.PI * 0.75);
    const clear = hearing(L, null, 1.5, 1.5, 6.5, 1.5);
    const round = hearing(L, null, 1.5, 1.5, 8.5, 7.5);
    const sealed = grid(["#####", "#.#.#", "#.#.#", "#.#.#", "#####"]);
    const rock = hearing(sealed, null, 1.5, 1.5, 3.5, 3.5);
    expect(clear.clarity).toBe(1);
    expect(round.clarity).toBeGreaterThan(0.25);
    expect(round.clarity).toBeLessThan(0.7);
    expect(rock.blocked).toBe(true);
    expect(rock.clarity).toBe(0);
  });

  test("a sound the room's rays can see comes through clearer than one they can't", () => {
    // Two rooms side by side, joined by a wide arch: a source in the next
    // room, out of sight, is seen by many of the places the rays bounced.
    const arch = grid([
      "#############",
      "#.....#.....#",
      "#...........#",
      "#...........#",
      "#...........#",
      "#.....#.....#",
      ...Array(7).fill("#############"),
    ]);
    expect(lineOfSight(arch, 2.5, 1.5, 10.5, 1.5)).toBe(false);
    const room = analyzeRoom(arch, 2.5, 1.5);
    const h = hearing(arch, room, 2.5, 1.5, 10.5, 1.5);
    const bare = hearing(arch, null, 2.5, 1.5, 10.5, 1.5);
    expect(h.clarity).toBeGreaterThan(bare.clarity);
    expect(h.clarity).toBeLessThan(1);
  });

  test("the room's size is its mean free path; a hall rings longer than a corridor", () => {
    // 4V/S of a 14 × 16 m room 6 m high is 6.7 m; a 2 m wide corridor 2.9 m.
    const hall = analyzeRoom(box(14, 16), 8, 9);
    const corridor = analyzeRoom(box(2, 30), 2, 16);
    expect(hall.size).toBeGreaterThan(6.7 * 0.85);
    expect(hall.size).toBeLessThan(6.7 * 1.15);
    expect(corridor.size).toBeGreaterThan(2.9 * 0.85);
    expect(corridor.size).toBeLessThan(2.9 * 1.25);
    expect(hall.rt60).toBeGreaterThan(corridor.rt60 * 1.5);
    // Closed rooms send everything back.
    expect(hall.openness).toBe(0);
    expect(hall.wet).toBeGreaterThan(0.9);
    // A game's reverb, not a cathedral's: about a second in a mid hall.
    expect(hall.rt60).toBeGreaterThan(0.7);
    expect(hall.rt60).toBeLessThan(1.5);
  });

  test("the open village hardly answers, and the open air leans away from walls", () => {
    const village = analyzeRoom(villageGrid(), 0, 10);
    const hall = analyzeRoom(box(14, 16), 8, 9);
    expect(village.openness).toBeGreaterThan(0.5);
    expect(village.wet).toBeLessThan(hall.wet * 0.3);
    // Against a wall on the east, open to the west: the air leans west.
    const yard = grid(Array.from({ length: 20 }, () => ".".repeat(15) + "#####"), "open");
    const r = analyzeRoom(yard, 13.5, 10);
    expect(r.escape[0]).toBeLessThan(-0.1);
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
    expect(room.rt60).toBeLessThanOrEqual(2.4);
    expect(room.probes.length).toBeGreaterThan(0);
  });

  test("the reverb tail: silent pre-delay, a decay that darkens, unit energy", () => {
    const sr = 24000;
    const [l, r] = impulseResponse(sr, 1.5, 0.6, 0.02, 3);
    expect(l.length).toBe(Math.ceil((0.02 + 1.5) * sr));
    for (let i = 0; i < Math.floor(0.02 * sr); i++) expect(l[i]).toBe(0);
    const rms = (a: Float32Array, from: number, to: number) => {
      let s = 0;
      for (let i = from; i < to; i++) s += a[i]! * a[i]!;
      return Math.sqrt(s / (to - from));
    };
    const early = rms(l, Math.floor(0.05 * sr), Math.floor(0.25 * sr));
    const late = rms(l, Math.floor(1.2 * sr), Math.floor(1.4 * sr));
    expect(late).toBeLessThan(early * 0.1);
    // Darker as it fades: the share of sample-to-sample change (the top
    // end) drops.
    const edge = (a: Float32Array, from: number, to: number) => {
      let d = 0;
      let s = 0;
      for (let i = from + 1; i < to; i++) {
        d += (a[i]! - a[i - 1]!) ** 2;
        s += a[i]! ** 2;
      }
      return d / s;
    };
    expect(edge(l, Math.floor(0.8 * sr), Math.floor(1.2 * sr))).toBeLessThan(edge(l, Math.floor(0.05 * sr), Math.floor(0.3 * sr)) * 0.7);
    // Each side carries unit energy, whatever the room.
    for (const ch of [l, r, impulseResponse(sr, 0.4, 0.2, 0.01, 9)[0]]) {
      let e = 0;
      for (const v of ch) e += v * v;
      expect(e).toBeCloseTo(1, 4);
    }
    // The two sides differ (a wide tail).
    expect(l[Math.floor(0.1 * sr)]).not.toBe(r[Math.floor(0.1 * sr)]);
  });
});
