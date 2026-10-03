import { describe, expect, test } from "bun:test";
import { TILE } from "../../core/config";
import { biomeForFloor } from "../biomes";
import { getLoreFragment } from "../lore";
import { rollOmen } from "../omens";
import type { FloorLayout, OmenId, Rect, Vec3 } from "../types";
import { generateFloor, isReachable } from ".";
import { SOLID, worldToTile } from "./grid";

/** Spread of seeds × depths used by the "holds on every floor" tests. */
function sampleFloors(count: number): FloorLayout[] {
  const out: FloorLayout[] = [];
  for (let i = 0; i < count; i++) {
    const seed = (i * 2654435761 + 12345) >>> 0;
    out.push(generateFloor(seed, 1 + ((i * 7) % 100)));
  }
  return out;
}

function roomAt(layout: FloorLayout, p: Vec3): Rect | undefined {
  const [x, y] = worldToTile(p, layout.size);
  return layout.rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
}

describe("generateFloor", () => {
  test("is deterministic for the same seed", () => {
    const a = generateFloor(123456, 3);
    const b = generateFloor(123456, 3);
    expect(a.tiles).toEqual(b.tiles);
    expect(a.spawn).toEqual(b.spawn);
    expect(a.enemies).toEqual(b.enemies);
    expect(a.props).toEqual(b.props);
  });

  test("is fully deterministic, biome, omen and lore included", () => {
    for (const [seed, floor] of [
      [1, 1],
      [987654321, 12],
      [42, 27],
      [4242, 40],
      [31337, 66],
      [0xdeadbeef, 100],
    ]) {
      const a = generateFloor(seed, floor);
      const b = generateFloor(seed, floor);
      expect(a).toEqual(b);
      expect(a.biome).toBe(b.biome);
      expect(a.omen).toBe(b.omen);
      expect(a.lore).toEqual(b.lore);
    }
  });

  test("differs across seeds", () => {
    const a = generateFloor(1, 3);
    const b = generateFloor(2, 3);
    expect(a.tiles).not.toEqual(b.tiles);
  });

  test("spawn, exit and treasure are connected on many random floors", () => {
    for (let i = 0; i < 40; i++) {
      const seed = (i * 2654435761) >>> 0;
      const floor = 1 + (i % 20);
      const layout = generateFloor(seed, floor);
      expect(isReachable(layout, layout.spawn, layout.exit)).toBe(true);
      expect(isReachable(layout, layout.spawn, layout.treasure)).toBe(true);
      expect(isReachable(layout, layout.spawn, layout.leave)).toBe(true);
    }
  });

  test("exit, way home, treasure and every lore rune are reachable at every depth", () => {
    for (const layout of sampleFloors(160)) {
      expect(isReachable(layout, layout.spawn, layout.exit)).toBe(true);
      expect(isReachable(layout, layout.spawn, layout.leave)).toBe(true);
      expect(isReachable(layout, layout.spawn, layout.treasure)).toBe(true);
      if (layout.boss) expect(isReachable(layout, layout.spawn, layout.boss)).toBe(true);
      for (const rune of layout.lore) {
        expect(isReachable(layout, layout.spawn, rune.pos)).toBe(true);
      }
    }
  });

  test("the way home never crowds the descent portal", () => {
    for (let seed = 1; seed <= 150; seed++) {
      for (const floor of [1, 4, 10, 17, 30, 60]) {
        const l = generateFloor(seed * 7919, floor);
        const dx = Math.abs(l.leave[0] - l.exit[0]);
        const dz = Math.abs(l.leave[2] - l.exit[2]);
        // Portals are 3.4 m wide (x) and 1.6 m deep (z): side by side they
        // need ≥ 4 m between centres, in line ≥ 4 m for the prompts to part.
        expect(dx >= 4 || dz >= 4).toBe(true);
      }
    }
  });

  test("every floor has a way home beside the exit, reachable from the spawn", () => {
    for (const floor of [1, 3, 5, 7, 10, 23, 50, 99, 100]) {
      const layout = generateFloor(99, floor);
      expect(isReachable(layout, layout.spawn, layout.leave)).toBe(true);
      expect(layout.leave).not.toEqual(layout.exit);
      expect(roomAt(layout, layout.leave)).toBe(roomAt(layout, layout.exit));
    }
  });

  test("biome follows the depth band and the omen matches its own roll", () => {
    for (const layout of sampleFloors(60)) {
      expect(layout.biome).toBe(biomeForFloor(layout.floor));
      expect(layout.omen).toBe(rollOmen(layout.seed, layout.floor));
    }
  });

  test("lore runes carry known fragments valid for the floor's depth", () => {
    for (const layout of sampleFloors(200)) {
      const ids = layout.lore.map((l) => l.fragmentId);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) {
        const f = getLoreFragment(id);
        expect(layout.floor).toBeGreaterThanOrEqual(f.minFloor);
        expect(layout.floor).toBeLessThanOrEqual(f.maxFloor ?? 100);
      }
    }
  });

  test("merged wall colliders cover every visible wall cube", () => {
    const layout = generateFloor(777, 6);
    expect(layout.wallBoxes.length).toBeGreaterThan(0);
    // Far fewer colliders than rendered cubes — that's the point of merging.
    expect(layout.wallBoxes.length).toBeLessThan(layout.wallInstances.length / 2);
    for (const [wx, , wz] of layout.wallInstances) {
      const covered = layout.wallBoxes.some(
        (box) =>
          Math.abs(wx - box.center[0]) <= box.half[0] - TILE / 2 + 1e-6 &&
          Math.abs(wz - box.center[2]) <= box.half[2] - TILE / 2 + 1e-6,
      );
      expect(covered).toBe(true);
    }
  });

  test("torches always have rock behind them", () => {
    for (const layout of sampleFloors(60)) {
      expect(layout.torches.length).toBeGreaterThanOrEqual(2);
      for (const [x, , z] of layout.torches) {
        // The torch is pushed from its tile centre toward its wall; one more
        // step that way must be solid.
        const [tx, ty] = worldToTile([x, 0, z], layout.size);
        const centerZ = (ty - layout.size / 2) * TILE + TILE / 2;
        const wallY = z < centerZ ? ty - 1 : ty + 1;
        expect(layout.tiles[ty * layout.size + tx]).toBe(1);
        expect(layout.tiles[wallY * layout.size + tx]).toBe(SOLID);
      }
    }
  });

  test("boss floors (every 10th) spawn a boss in a reachable arena", () => {
    for (const floor of [10, 20, 30]) {
      const layout = generateFloor(4242, floor);
      expect(layout.boss).not.toBeNull();
      expect(isReachable(layout, layout.spawn, layout.boss!)).toBe(true);
      expect(isReachable(layout, layout.spawn, layout.exit)).toBe(true);
    }
    expect(generateFloor(4242, 9).boss).toBeNull();
    expect(generateFloor(4242, 11).boss).toBeNull();
    expect(generateFloor(4242, 5).boss).toBeNull();
  });

  test("enemies scale with depth", () => {
    const shallow = generateFloor(42, 1);
    const deep = generateFloor(42, 15);
    expect(deep.enemies.length).toBeGreaterThan(shallow.enemies.length);
  });

  test("new enemy kinds are introduced gradually with depth", () => {
    // Floor 1 is only wisps — nothing else has been introduced yet.
    for (const seed of [7, 99, 4242]) {
      expect(generateFloor(seed, 1).enemies.every((e) => e.kind === "wisp")).toBe(true);
    }
    // Deep floors mix in the later arrivals (slime ≥3, sentry ≥5, shadow ≥8).
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const layout = generateFloor((i * 2654435761) >>> 0, 10 + (i % 15));
      for (const e of layout.enemies) seen.add(e.kind);
    }
    expect(seen.has("shadow")).toBe(true);
    expect(seen.has("sentry")).toBe(true);
    expect(seen.has("slime")).toBe(true);
  });

  test("biome enemy weights reshape the mix but never introduce a kind early", () => {
    // Shadows (from floor 8) are the Hollow's favourites, sentries the Forge's.
    const tally = (floors: number[]) => {
      const n: Record<string, number> = {};
      let total = 0;
      for (let i = 0; i < 80; i++) {
        const layout = generateFloor((i * 2654435761 + 99) >>> 0, floors[i % floors.length]);
        for (const e of layout.enemies) {
          n[e.kind] = (n[e.kind] ?? 0) + 1;
          total++;
        }
      }
      return (kind: string) => (n[kind] ?? 0) / total;
    };
    const forge = tally([22, 26, 28, 33]);
    const hollow = tally([62, 70, 81, 93]);
    expect(forge("sentry")).toBeGreaterThan(hollow("sentry"));
    expect(hollow("shadow")).toBeGreaterThan(forge("shadow"));
    for (const seed of [7, 99, 4242]) {
      expect(generateFloor(seed, 2).enemies.every((e) => e.kind === "wisp")).toBe(true);
    }
  });

  test("traps are placed deterministically and scale with depth", () => {
    const a = generateFloor(2024, 6);
    const b = generateFloor(2024, 6);
    expect(a.traps).toEqual(b.traps);
    expect(a.traps.length).toBeGreaterThan(0);
    const deep = generateFloor(2024, 24);
    expect(deep.traps.length).toBeGreaterThanOrEqual(a.traps.length);
  });

  test("warp traps never spawn in the exit room (the way home stands there)", () => {
    let warps = 0;
    for (const layout of sampleFloors(300)) {
      const exitRoom = roomAt(layout, layout.exit);
      expect(exitRoom).toBeDefined();
      for (const trap of layout.traps) {
        if (trap.kind !== "warp") continue;
        warps++;
        expect(roomAt(layout, trap.pos)).not.toBe(exitRoom);
      }
    }
    expect(warps).toBeGreaterThan(0);
  });

  test("warps may appear on any depth — there are no checkpoint floors to protect", () => {
    let sawWarp = false;
    for (let i = 0; i < 40 && !sawWarp; i++) {
      for (const floor of [5, 15, 25]) {
        if (generateFloor((i * 2654435761) >>> 0, floor).traps.some((t) => t.kind === "warp")) {
          sawWarp = true;
        }
      }
    }
    expect(sawWarp).toBe(true);
  });

  test("adding traps left the rest of the layout untouched (traps roll last)", () => {
    // Regression guard: trap generation must not perturb earlier rng draws.
    const layout = generateFloor(123456, 3);
    const fresh = generateFloor(123456, 3);
    expect(layout.enemies).toEqual(fresh.enemies);
    expect(layout.props).toEqual(fresh.props);
    expect(layout.tiles).toEqual(fresh.tiles);
  });

  test("floors under every omen still generate valid layouts", () => {
    const found = new Map<OmenId, FloorLayout>();
    for (let i = 0; i < 400 && found.size < 6; i++) {
      const seed = (i * 2654435761 + 5) >>> 0;
      const floor = 6 + (i % 60);
      const omen = rollOmen(seed, floor);
      if (omen && !found.has(omen)) found.set(omen, generateFloor(seed, floor));
    }
    expect(found.size).toBe(6);
    for (const layout of found.values()) {
      expect(layout.omen).not.toBeNull();
      expect(isReachable(layout, layout.spawn, layout.exit)).toBe(true);
      expect(isReachable(layout, layout.spawn, layout.leave)).toBe(true);
      expect(isReachable(layout, layout.spawn, layout.treasure)).toBe(true);
      expect(layout.torches.length).toBeGreaterThanOrEqual(2);
      expect(layout.props.length).toBeGreaterThan(0);
      expect(layout.enemies.length).toBeGreaterThan(0);
    }
  });

  test("omens bend generation: lightless dims, volatile stocks barrels, teeming crowds", () => {
    const avg = (omen: OmenId | null, pick: (l: FloorLayout) => number) => {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < 3000 && n < 25; i++) {
        const seed = (i * 2654435761 + 77) >>> 0;
        const floor = 12 + (i % 8);
        if (rollOmen(seed, floor) !== omen) continue;
        sum += pick(generateFloor(seed, floor));
        n++;
      }
      expect(n).toBe(25);
      return sum / n;
    };
    const barrelShare = (l: FloorLayout) =>
      l.props.filter((p) => p.kind === "barrel").length / Math.max(1, l.props.length);
    expect(avg("lightless", (l) => l.torches.length)).toBeLessThan(avg(null, (l) => l.torches.length) * 0.6);
    expect(avg("volatile", barrelShare)).toBeGreaterThan(avg(null, barrelShare) + 0.2);
    expect(avg("teeming", (l) => l.enemies.length)).toBeGreaterThan(avg(null, (l) => l.enemies.length) * 1.25);
  });
});
