import { describe, expect, test } from "bun:test";
import { generateFloor } from "../../world/gen";
import { discOffset, ditherPhase, gridVisible, isOpen, lightVisibility, type OccupancyGrid, toCell, unstick } from "./gridRay";

/** A grid from rows of text: '.' open, '#' rock. Row k is grid y = k. */
function grid(rows: string[]): OccupancyGrid {
  const size = rows.length;
  const tiles = new Uint8Array(size * size);
  rows.forEach((r, y) => {
    for (let x = 0; x < size; x++) tiles[y * size + x] = r[x] === "." ? 1 : 0;
  });
  return { tiles, size };
}

// Two rooms split by a wall with a doorway at x = 4.
const ROOMS = grid([
  "##########",
  "#........#",
  "#........#",
  "#........#",
  "####.#####",
  "#........#",
  "#........#",
  "#........#",
  "#........#",
  "##########",
]);

/** Brute force: sample the segment finely and look for rock. */
function sampled(g: OccupancyGrid, ax: number, ay: number, bx: number, by: number): boolean {
  const ex = Math.floor(bx);
  const ey = Math.floor(by);
  const sx = Math.floor(ax);
  const sy = Math.floor(ay);
  for (let i = 1; i < 4000; i++) {
    const t = i / 4000;
    const cx = Math.floor(ax + (bx - ax) * t);
    const cy = Math.floor(ay + (by - ay) * t);
    if ((cx === ex && cy === ey) || (cx === sx && cy === sy)) continue;
    if (!isOpen(g, cx, cy)) return false;
  }
  return true;
}

describe("grid ray (DDA)", () => {
  test("sees across an open room", () => {
    expect(gridVisible(ROOMS, 1.5, 1.5, 8.5, 3.5)).toBe(true);
    expect(gridVisible(ROOMS, 8.2, 3.9, 1.1, 1.1)).toBe(true);
  });

  test("a wall blocks; the doorway lets the line through", () => {
    // Straight down through the wall row at x = 2: blocked.
    expect(gridVisible(ROOMS, 2.5, 2.5, 2.5, 6.5)).toBe(false);
    // Straight down through the doorway at x = 4: clear.
    expect(gridVisible(ROOMS, 4.5, 2.5, 4.5, 6.5)).toBe(true);
    // A diagonal that clips the wall beside the door: blocked.
    expect(gridVisible(ROOMS, 1.5, 1.5, 7.5, 8.2)).toBe(false);
  });

  test("symmetric, and agrees with brute-force sampling", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let blocked = 0;
    for (let i = 0; i < 3000; i++) {
      const ax = 1 + rnd() * 8;
      const ay = 1 + rnd() * 8;
      const bx = 1 + rnd() * 8;
      const by = 1 + rnd() * 8;
      const v = gridVisible(ROOMS, ax, ay, bx, by, 64);
      expect(v).toBe(sampled(ROOMS, ax, ay, bx, by));
      expect(gridVisible(ROOMS, bx, by, ax, ay, 64)).toBe(v);
      if (!v) blocked++;
    }
    expect(blocked).toBeGreaterThan(300);
  });

  test("never tests the end cells (a face point, a light's own cell)", () => {
    // From inside the wall row to the room above: the start cell is rock.
    expect(gridVisible(ROOMS, 2.5, 4.5, 2.5, 1.5)).toBe(true);
    // To a light inside rock: its cell isn't held against it.
    expect(gridVisible(ROOMS, 2.5, 2.5, 2.5, 4.2)).toBe(true);
  });

  test("bounded: gives up (lit) past the step cap", () => {
    const open = grid(Array.from({ length: 40 }, () => ".".repeat(40)));
    expect(gridVisible(open, 0.5, 0.5, 39.5, 39.5, 4)).toBe(true);
    const walled = grid(Array.from({ length: 40 }, (_, y) => (y === 30 ? "#".repeat(40) : ".".repeat(40))));
    expect(gridVisible(walled, 0.5, 0.5, 39.5, 39.5, 100)).toBe(false);
    expect(gridVisible(walled, 0.5, 0.5, 39.5, 39.5, 8)).toBe(true);
  });

  test("unstick: a light in rock steps out through its nearest face", () => {
    // In the wall row just below room 1 (y 4.04): out through the top face.
    const [x1, y1] = unstick(ROOMS, 2.5, 4.04);
    expect(x1).toBe(2.5);
    expect(y1).toBeLessThan(4);
    expect(isOpen(ROOMS, Math.floor(x1), Math.floor(y1))).toBe(true);
    // Open points don't move.
    expect(unstick(ROOMS, 3.3, 2.2)).toEqual([3.3, 2.2]);
  });

  test("a torch lights its own room and not the room behind its wall", () => {
    // Torch on the wall row's north face (hanging in room 1, a hair into rock).
    const torch: [number, number] = [2.5, 4.03];
    expect(lightVisibility(ROOMS, 2.5, 2.5, ...torch, 0.2, 0.5)).toBe(1);
    expect(lightVisibility(ROOMS, 2.5, 6.0, ...torch, 0.2, 0.5)).toBe(0);
    // Through the doorway, into the lower room: the spill, lit.
    expect(lightVisibility(ROOMS, 4.5, 6.5, 4.5, 3.0, 0.2, 0.5)).toBe(1);
  });

  test("penumbra: a dithered band at a shadow's edge, lit to unlit in quarters", () => {
    // A light in room 1 seen from room 2 past the doorway's jamb: average
    // the four dither phases (a 2×2 block of texels) along the floor.
    const levels: number[] = [];
    for (let x = 1.5; x < 8.5; x += 0.02) {
      let v = 0;
      for (const phase of [0, 0.25, 0.5, 0.75]) v += lightVisibility(ROOMS, x, 7.5, 4.5, 2.0, 0.3, phase) / 4;
      levels.push(v);
    }
    const seen = new Set(levels);
    expect(seen.has(0)).toBe(true);
    expect(seen.has(1)).toBe(true);
    // In-between levels exist (the soft band), and only in quarters.
    const mid = [...seen].filter((v) => v > 0 && v < 1);
    expect(mid.length).toBeGreaterThan(0);
    for (const v of mid) expect([0.25, 0.5, 0.75]).toContain(v);
    // Each texel on its own is all or nothing.
    for (const phase of [0, 0.25, 0.5, 0.75]) expect([0, 1]).toContain(lightVisibility(ROOMS, 3.1, 7.5, 4.5, 2.0, 0.3, phase));
  });

  test("the disc offsets spread evenly across the diameter", () => {
    const o = [0, 0.25, 0.5, 0.75].map(discOffset);
    expect(o).toEqual([-0.75, -0.25, 0.25, 0.75]);
  });

  test("dither phase: a 2×2 ordered pattern over the texels", () => {
    const block = [ditherPhase(0, 0), ditherPhase(1, 0), ditherPhase(0, 1), ditherPhase(1, 1)];
    expect(new Set(block).size).toBe(4);
    expect(ditherPhase(2, 2)).toBe(ditherPhase(0, 0));
    expect(ditherPhase(-1, 0)).toBe(ditherPhase(1, 0));
  });

  test("real floors: every torch sees the floor in front of it", () => {
    for (let s = 1; s <= 6; s++) {
      const layout = generateFloor(s * 977, 1 + s * 3);
      const g = { tiles: layout.tiles, size: layout.size };
      for (const [x, , z] of layout.torches) {
        const [cx, cy] = toCell(layout.size, 2, x, z);
        // the tile the torch stands in (torches hang inside floor tiles)
        const tx = Math.floor(cx);
        const ty = Math.floor(cy);
        expect(isOpen(g, tx, ty)).toBe(true);
        // its light, nudged like the pool light (+0.2 m on z), still sees it
        expect(lightVisibility(g, tx + 0.5, ty + 0.5, cx, cy + 0.1, 0.2, 0.5)).toBe(1);
      }
    }
  });
});
