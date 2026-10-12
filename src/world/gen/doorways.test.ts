import { describe, expect, test } from "bun:test";
import { ARCHITECTURE, TILE } from "../../core/config";
import type { DoorwaySpawn, FloorLayout, Rect, Vec3 } from "../types";
import { generateFloor } from ".";
import { MAX_DOOR_TILES, doorwayPoint, findMouths, frameExtent, leafExtent, touchesDoorway } from "./doorways";
import { FLOOR, Grid, SOLID, worldToTile } from "./grid";

/** Doorways frame where corridors meet rooms. The promises: a frame only
 * ever stands on rock beside a real opening, nothing about it changes the
 * carved grid (so nothing can be blocked by it), a broken door only leans
 * on unbroken wall clear of torches and runes, and the whole thing is a
 * pure function of (seed, floor). */

function floors(count: number): FloorLayout[] {
  const out: FloorLayout[] = [];
  for (let i = 0; i < count; i++) out.push(generateFloor((i * 2246822519 + 77) >>> 0, 1 + ((i * 13) % 100)));
  return out;
}
const SAMPLE = floors(160);

const tileAt = (l: FloorLayout, p: Vec3) => {
  const [x, y] = worldToTile(p, l.size);
  return x < 0 || y < 0 || x >= l.size || y >= l.size ? SOLID : l.tiles[y * l.size + x];
};

/** A 20×20 grid with one 6×6 room at (7,7) and hand-dug openings. */
function testGrid(dig: (g: Grid) => void): { grid: Grid; room: Rect } {
  const grid = new Grid(20);
  const room: Rect = { x: 7, y: 7, w: 6, h: 6 };
  for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) grid.carve(x, y);
  dig(grid);
  return { grid, room };
}

describe("finding corridor mouths", () => {
  test("a one-wide corridor north and a two-wide one east are doorways", () => {
    const { grid, room } = testGrid((g) => {
      for (let y = 2; y < 7; y++) g.carve(9, y); // north, one wide
      for (let x = 13; x < 18; x++) {
        g.carve(x, 9);
        g.carve(x, 10); // east, two wide
      }
    });
    const mouths = findMouths(grid, [room]);
    expect(mouths.length).toBe(2);
    const [north, east] = mouths;
    expect(north.axis).toBe("x");
    expect(north.inward).toBe(1);
    expect(north.face).toBe((7 - 10) * TILE);
    expect([north.from, north.to]).toEqual([(9 - 10) * TILE, (10 - 10) * TILE]);
    expect(east.axis).toBe("z");
    expect(east.inward).toBe(-1);
    expect(east.face).toBe((13 - 10) * TILE);
    expect(east.to - east.from).toBe(2 * TILE);
  });

  test("a corridor running along the wall, a gap at the corner and a dead pocket are not", () => {
    const { grid, room } = testGrid((g) => {
      for (let x = 7; x < 13; x++) g.carve(x, 6); // along the whole north wall
      g.carve(7, 13); // south-west corner gap (touches the corner)
      g.carve(7, 14);
      g.carve(13, 10); // a one-tile pocket east, going nowhere
    });
    expect(findMouths(grid, [room])).toEqual([]);
  });

  test("openings wider than two tiles stay unframed", () => {
    const { grid, room } = testGrid((g) => {
      for (let x = 8; x < 11; x++) for (let y = 2; y < 7; y++) g.carve(x, y);
    });
    expect(MAX_DOOR_TILES).toBe(2);
    expect(findMouths(grid, [room])).toEqual([]);
  });
});

describe("doorways on generated floors", () => {
  test("are deterministic", () => {
    for (const l of SAMPLE.slice(0, 12)) {
      expect(generateFloor(l.seed, l.floor).architecture.doorways).toEqual(l.architecture.doorways);
    }
  });

  test("frame most corridor mouths, with portcullises and broken doors among them", () => {
    let doors = 0;
    const styles = { open: 0, portcullis: 0, door: 0 };
    for (const l of SAMPLE) {
      doors += l.architecture.doorways.length;
      for (const d of l.architecture.doorways) styles[d.style]++;
    }
    expect(doors / SAMPLE.length).toBeGreaterThan(6);
    expect(styles.open).toBeGreaterThan(styles.portcullis);
    expect(styles.portcullis / doors).toBeGreaterThan(0.1);
    expect(styles.door / doors).toBeGreaterThan(0.05);
  });

  test("stand on rock beside a real opening, one or two tiles wide", () => {
    for (const l of SAMPLE) {
      for (const d of l.architecture.doorways) {
        const width = d.to - d.from;
        expect(width === TILE || width === 2 * TILE).toBe(true);
        // The opening: open floor just outside the face and just inside it.
        for (let a = d.from + TILE / 2; a < d.to; a += TILE) {
          expect(tileAt(l, doorwayPoint(d, a, 0, -0.5))).toBe(FLOOR);
          expect(tileAt(l, doorwayPoint(d, a, 0, 0.5))).toBe(FLOOR);
        }
        // Rock behind both jambs, room floor in front of them.
        for (const a of [d.from - TILE / 2, d.to + TILE / 2]) {
          expect(tileAt(l, doorwayPoint(d, a, 0, -0.5))).toBe(SOLID);
          expect(tileAt(l, doorwayPoint(d, a, 0, 0.5))).toBe(FLOOR);
        }
      }
    }
  });

  test("never overlap each other on a wall", () => {
    for (const l of SAMPLE) {
      const ds = l.architecture.doorways;
      for (let i = 0; i < ds.length; i++) {
        for (let j = i + 1; j < ds.length; j++) {
          const [lo, hi] = [ds[j].from, ds[j].to];
          // No doorway's opening lies inside another's frame.
          expect(touchesDoorway({ ...ds[i], style: "open" }, ds[j].axis, ds[j].face, lo, hi, -ARCHITECTURE.jambWidth)).toBe(
            false,
          );
        }
      }
    }
  });

  test("a broken door leans on unbroken wall inside its room, clear of torches and runes", () => {
    let leaves = 0;
    for (const l of SAMPLE) {
      for (const d of l.architecture.doorways) {
        const leaf = leafExtent(d);
        if (d.style !== "door") {
          expect(leaf).toBeNull();
          continue;
        }
        leaves++;
        const [lo, hi] = leaf!;
        expect(hi - lo).toBeCloseTo(ARCHITECTURE.doorLeaf, 6);
        for (let a = lo; a <= hi; a += 0.25) {
          expect(tileAt(l, doorwayPoint(d, a, 0, -0.5))).toBe(SOLID);
          expect(tileAt(l, doorwayPoint(d, a, 0, 0.5))).toBe(FLOOR);
        }
        const nearLeaf = (p: Vec3) => {
          const along = d.axis === "x" ? p[0] : p[2];
          const into = ((d.axis === "x" ? p[2] : p[0]) - d.face) * d.inward;
          return into > -0.2 && into < 1 && along > lo - 0.4 && along < hi + 0.4;
        };
        for (const t of l.torches) expect(nearLeaf(t)).toBe(false);
        for (const r of l.lore) expect(nearLeaf(r.pos)).toBe(false);
        for (const o of l.architecture.doorways) {
          if (o === d) continue;
          expect(touchesDoorway({ ...o, style: "open" }, d.axis, d.face, lo, hi)).toBe(false);
        }
      }
    }
    expect(leaves).toBeGreaterThan(20);
  });

  test("rib piers keep off every frame and leaf; no pillar stands in a doorway's lane", () => {
    const pierHalf = ARCHITECTURE.pierWidth / 2;
    for (const l of SAMPLE) {
      const ds: DoorwaySpawn[] = l.architecture.doorways;
      for (const rib of l.architecture.ribs) {
        const wallAxis = rib.axis === "x" ? "z" : "x";
        for (const face of [rib.from, rib.to]) {
          for (const d of ds) expect(touchesDoorway(d, wallAxis, face, rib.at - pierHalf, rib.at + pierHalf)).toBe(false);
        }
      }
      for (const { pos } of l.architecture.pillars) {
        for (const d of ds) {
          const along = d.axis === "x" ? pos[0] : pos[2];
          const into = ((d.axis === "x" ? pos[2] : pos[0]) - d.face) * d.inward;
          const [lo, hi] = frameExtent(d);
          const inLane = into > 0 && into < 4 && along > lo && along < hi;
          expect(inLane).toBe(false);
        }
      }
    }
  });
});
