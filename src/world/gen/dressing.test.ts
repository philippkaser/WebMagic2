import { describe, expect, test } from "bun:test";
import { PLAYER, TILE, WALL_HEIGHT } from "../../core/config";
import { DRESSING, allDecorDefs, getDecorDef } from "../decor";
import type { BiomeId, DecorSpawn, FloorLayout, Vec3 } from "../types";
import { generateFloor } from ".";
import { doorwayLocal } from "./doorways";
import { DECOR_CLEARANCE, HANG_FLOOR } from "./dressing";
import { FLOOR, SOLID, floodFill, worldToTile } from "./grid";

/** Dressing must add texture without ever getting in the way: never on a
 * landmark, never in a doorway's lane, nothing bulky outside a dead-end
 * corner, nothing hanging low enough to touch, and all of it a pure
 * function of (seed, floor) on its own stream. */

function floors(count: number): FloorLayout[] {
  const out: FloorLayout[] = [];
  for (let i = 0; i < count; i++) out.push(generateFloor((i * 2654435761 + 31337) >>> 0, 1 + ((i * 7) % 100)));
  return out;
}
const SAMPLE = floors(220);
const all = SAMPLE.flatMap((layout) => layout.dressing.map((d) => ({ layout, d })));

const tile = (l: FloorLayout, x: number, y: number) =>
  x < 0 || y < 0 || x >= l.size || y >= l.size ? SOLID : l.tiles[y * l.size + x];
const tileAt = (l: FloorLayout, p: Vec3) => tile(l, ...worldToTile(p, l.size));
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const onGround = (d: DecorSpawn) => {
  const m = getDecorDef(d.kind).mounts;
  return m.includes("corner") || m.includes("wallBase") || m.includes("floor");
};
/** Distance from a point to the nearest wall face of its tile's
 * 4-neighbourhood (inf if none is rock). */
function wallDistance(l: FloorLayout, p: Vec3): number {
  const [x, y] = worldToTile(p, l.size);
  const cx = (x - l.size / 2) * TILE;
  const cz = (y - l.size / 2) * TILE;
  let best = Infinity;
  if (tile(l, x - 1, y) === SOLID) best = Math.min(best, p[0] - cx);
  if (tile(l, x + 1, y) === SOLID) best = Math.min(best, cx + TILE - p[0]);
  if (tile(l, x, y - 1) === SOLID) best = Math.min(best, p[2] - cz);
  if (tile(l, x, y + 1) === SOLID) best = Math.min(best, cz + TILE - p[2]);
  return best;
}

describe("dressing", () => {
  test("is deterministic", () => {
    for (const l of SAMPLE.slice(0, 15)) expect(generateFloor(l.seed, l.floor).dressing).toEqual(l.dressing);
  });

  test("dresses every band with its own things, within each recipe's cap", () => {
    expect(all.length / SAMPLE.length).toBeGreaterThan(20);
    for (const l of SAMPLE) {
      const recipes = DRESSING[l.biome];
      const kinds = new Set(recipes.map((r) => r.kind));
      const counts = new Map<string, number>();
      for (const d of l.dressing) {
        expect(kinds.has(d.kind)).toBe(true);
        counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1);
      }
      for (const r of recipes) expect(counts.get(r.kind) ?? 0).toBeLessThanOrEqual(r.cap);
      // Tasteful: a handful per room, not a junk shop.
      expect(l.dressing.length / l.rooms.length).toBeLessThan(6);
    }
    const seen = (biome: BiomeId, kind: string) =>
      SAMPLE.some((l) => l.biome === biome && l.dressing.some((d) => d.kind === kind));
    expect(seen("catacombs", "bones") && seen("catacombs", "candles") && seen("catacombs", "cobweb")).toBe(true);
    expect(seen("drowned", "kelp") && seen("drowned", "barnacles")).toBe(true);
    expect(seen("forge", "anvil") && seen("forge", "brazier") && seen("forge", "slag")).toBe(true);
    expect(seen("crystal", "spur")).toBe(true);
    expect(seen("hollow", "roots") && seen("hollow", "chime")).toBe(true);
  });

  test("every piece is well formed: a known variant, a sane scale, finite numbers", () => {
    for (const { d } of all) {
      const def = getDecorDef(d.kind);
      expect(d.variant).toBeGreaterThanOrEqual(0);
      expect(d.variant).toBeLessThan(def.variants);
      expect(d.scale).toBeGreaterThanOrEqual(def.scale[0]);
      expect(d.scale).toBeLessThanOrEqual(def.scale[1]);
      for (const v of [...d.pos, d.yaw]) expect(Number.isFinite(v)).toBe(true);
    }
    for (const def of allDecorDefs()) if (def.collider) expect(def.mounts).toEqual(["corner"]);
  });

  test("ground decor stands on open floor, off every landmark, trap and spawned body", () => {
    const c = DECOR_CLEARANCE;
    for (const { layout: l, d } of all) {
      if (!onGround(d)) continue;
      const def = getDecorDef(d.kind);
      const r = def.radius * d.scale;
      expect(d.pos[1]).toBe(0);
      expect(tileAt(l, d.pos)).toBe(FLOOR);
      // Never on a landmark's tile.
      const landmarks = [l.spawn, l.exit, l.leave, l.treasure, ...(l.boss ? [l.boss] : [])];
      for (const p of landmarks) expect(worldToTile(d.pos, l.size)).not.toEqual(worldToTile(p, l.size));
      expect(dist(d.pos, l.spawn)).toBeGreaterThanOrEqual(c.spawn + r - 1e-9);
      expect(dist(d.pos, l.exit)).toBeGreaterThanOrEqual(c.portal + r - 1e-9);
      expect(dist(d.pos, l.leave)).toBeGreaterThanOrEqual(c.portal + r - 1e-9);
      expect(dist(d.pos, l.treasure)).toBeGreaterThanOrEqual(c.treasure + r - 1e-9);
      if (l.boss) expect(dist(d.pos, l.boss)).toBeGreaterThanOrEqual(c.boss + r - 1e-9);
      for (const t of l.traps) expect(dist(d.pos, t.pos)).toBeGreaterThanOrEqual(c.trap + r - 1e-9);
      for (const q of [...l.props, ...l.enemies]) expect(dist(d.pos, q.pos)).toBeGreaterThanOrEqual(c.body + r - 1e-9);
    }
  });

  test("nothing with bulk stands in the open: only flat pieces leave the walls", () => {
    for (const { layout: l, d } of all) {
      if (!onGround(d)) continue;
      const mounts = getDecorDef(d.kind).mounts;
      if (mounts.includes("floor")) continue; // grates and puddles lie flat
      // Tucked against a wall (corner or foot of a wall).
      expect(wallDistance(l, d.pos)).toBeLessThan(1);
      // …and out of every doorway's lane.
      for (const dw of l.architecture.doorways) {
        const { along, into } = doorwayLocal(dw, d.pos);
        const inLane = into > 0 && into < DECOR_CLEARANCE.doorLane && along > dw.from - 0.3 && along < dw.to + 0.3;
        expect(inLane).toBe(false);
      }
    }
  });

  test("collider pieces only fill dead-end corners — every path stays open", () => {
    let solid = 0;
    for (const l of SAMPLE) {
      const blocked = new Set<number>();
      for (const d of l.dressing) {
        const col = getDecorDef(d.kind).collider;
        if (!col) continue;
        solid++;
        const half = Math.hypot(col[0], col[2]) * d.scale + PLAYER.radius;
        const [x0, y0] = worldToTile([d.pos[0] - half, 0, d.pos[2] - half], l.size);
        const [x1, y1] = worldToTile([d.pos[0] + half, 0, d.pos[2] + half], l.size);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (tile(l, x, y) === FLOOR) blocked.add(y * l.size + x);
      }
      if (blocked.size === 0) continue;
      const before = floodFill(l.tiles, l.size, worldToTile(l.spawn, l.size));
      const tiles = l.tiles.slice();
      for (const i of blocked) tiles[i] = SOLID;
      const after = floodFill(tiles, l.size, worldToTile(l.spawn, l.size));
      for (let i = 0; i < tiles.length; i++) if (before[i] && !blocked.has(i)) expect(after[i]).toBe(1);
    }
    expect(solid).toBeGreaterThan(10);
  });

  test("hanging decor hangs from the vault, high above any wizard, clear of ribs and shafts", () => {
    for (const { layout: l, d } of all) {
      const def = getDecorDef(d.kind);
      if (!def.mounts.includes("ceiling")) continue;
      expect(d.pos[1]).toBe(WALL_HEIGHT);
      expect(WALL_HEIGHT - def.hang! * d.scale).toBeGreaterThanOrEqual(HANG_FLOOR);
      expect(tileAt(l, d.pos)).toBe(FLOOR);
      for (const s of l.architecture.shafts) expect(dist(d.pos, s.pos)).toBeGreaterThan(s.radius);
      for (const rib of l.architecture.ribs) {
        const s = rib.axis === "x" ? d.pos[0] : d.pos[2];
        const along = rib.axis === "x" ? d.pos[2] : d.pos[0];
        if (s > rib.from && s < rib.to) expect(Math.abs(along - rib.at)).toBeGreaterThan(0.5);
      }
    }
  });

  test("wall decor hangs on a real wall face, clear of torches, runes and door frames", () => {
    let hung = 0;
    for (const { layout: l, d } of all) {
      const def = getDecorDef(d.kind);
      if (!def.wall) continue;
      hung++;
      // Facing into the room: one step forward is floor, one step back rock.
      const f: Vec3 = [Math.sin(d.yaw), 0, Math.cos(d.yaw)];
      const ahead: Vec3 = [d.pos[0] + f[0] * 0.5, 0, d.pos[2] + f[2] * 0.5];
      const behind: Vec3 = [d.pos[0] - f[0] * 0.5, 0, d.pos[2] - f[2] * 0.5];
      for (const side of [-1, 1]) {
        const off = side * def.wall.halfWidth * d.scale;
        const r: Vec3 = [f[2], 0, -f[0]];
        expect(tileAt(l, [ahead[0] + r[0] * off, 0, ahead[2] + r[2] * off])).toBe(FLOOR);
        expect(tileAt(l, [behind[0] + r[0] * off, 0, behind[2] + r[2] * off])).toBe(SOLID);
      }
      for (const t of l.torches) expect(dist(t, d.pos)).toBeGreaterThanOrEqual(def.wall.halfWidth * d.scale + 0.55);
      for (const rune of l.lore) expect(dist(rune.pos, d.pos)).toBeGreaterThan(def.wall.halfWidth * d.scale + 0.5);
      for (const dw of l.architecture.doorways) {
        const { along, into } = doorwayLocal(dw, d.pos);
        if (Math.abs(into) < 0.05) expect(along < dw.from - 0.6 || along > dw.to + 0.6).toBe(true);
      }
    }
    expect(hung).toBeGreaterThan(50);
  });

  test("webs fill true room corners under the vault, one per corner", () => {
    for (const l of SAMPLE) {
      const keys = new Set<string>();
      for (const d of l.dressing) {
        if (d.kind !== "cobweb") continue;
        expect(d.pos[1]).toBe(WALL_HEIGHT);
        const k = `${d.pos[0]},${d.pos[2]}`;
        expect(keys.has(k)).toBe(false);
        keys.add(k);
        // The corner point: two of its four diagonal tiles' quadrants are rock.
        let rock = 0;
        for (const [dx, dz] of [
          [-0.5, -0.5],
          [0.5, -0.5],
          [-0.5, 0.5],
          [0.5, 0.5],
        ])
          if (tileAt(l, [d.pos[0] + dx, 0, d.pos[2] + dz]) === SOLID) rock++;
        expect(rock).toBe(3);
      }
    }
  });
});
