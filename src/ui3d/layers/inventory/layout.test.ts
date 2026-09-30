import { describe, expect, test } from "bun:test";
import { BAG_SLOTS, BELT_SLOTS, CHEST_SLOTS } from "../../../items/inventory";
import { MERCHANT_STOCK } from "../../../items/economy";
import {
  altarLayout,
  arrangement,
  chestLayout,
  fitScale,
  GAMBLE_WARE,
  onTablet,
  placePlaque,
  SCENE_DISTANCE,
  socketAt,
  stallLayout,
  viewHalfExtent,
  type TabletSpec,
} from "./layout";

const tablets = [altarLayout(), chestLayout(), stallLayout()];

function overlaps(spec: TabletSpec): string[] {
  const bad: string[] = [];
  for (const a of spec.sockets)
    for (const b of spec.sockets) {
      if (a === b) continue;
      const gap = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) - (a.size + b.size) / 2;
      if (gap < 0.02) bad.push(`${a.key}/${b.key}`);
    }
  return bad;
}

describe("tablet layouts", () => {
  test("the altar has every gear, belt and bag cell exactly once", () => {
    const keys = altarLayout().sockets.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const slot of ["staff", "amulet", "cloak", "boots"]) expect(keys).toContain(`equipment:${slot}`);
    for (let i = 0; i < BELT_SLOTS; i++) expect(keys).toContain(`belt:${i}`);
    for (let i = 0; i < BAG_SLOTS; i++) expect(keys).toContain(`bag:${i}`);
  });

  test("the chest has all 30 cells, the stall every ware plus the orb", () => {
    expect(chestLayout().sockets.map((s) => s.key)).toEqual(
      Array.from({ length: CHEST_SLOTS }, (_, i) => `chest:${i}`),
    );
    const wares = stallLayout().sockets.map((s) => s.ware);
    expect(wares).toEqual([...MERCHANT_STOCK.map((w) => w.id), GAMBLE_WARE]);
    expect(stallLayout().sockets.every((s) => s.ref === null)).toBe(true);
  });

  test("sockets sit fully on their tablet and never crowd each other", () => {
    for (const spec of tablets) {
      for (const s of spec.sockets) {
        expect(Math.abs(s.x) + s.size / 2).toBeLessThan(spec.width / 2 - 0.04);
        expect(Math.abs(s.y) + s.size / 2).toBeLessThan(spec.height / 2 - 0.04);
        expect(s.order).toBeGreaterThanOrEqual(0);
        expect(s.order).toBeLessThanOrEqual(1);
      }
      expect(overlaps(spec)).toEqual([]);
    }
  });

  test("the belt stands apart from the bag", () => {
    const row = altarLayout().sockets.filter((s) => s.variant !== "gear");
    const e = row.find((s) => s.key === "belt:1")!;
    const bag0 = row.find((s) => s.key === "bag:0")!;
    const bag1 = row.find((s) => s.key === "bag:1")!;
    expect(bag0.x - e.x).toBeGreaterThan(bag1.x - bag0.x);
  });
});

describe("socketAt / onTablet (pointer hit-testing on a tablet face)", () => {
  const altar = altarLayout();

  test("finds the socket under the point, forgiving a little past its rim", () => {
    for (const s of altar.sockets) {
      expect(socketAt(altar, s.x, s.y)?.key).toBe(s.key);
      expect(socketAt(altar, s.x + s.size / 2 + 0.008, s.y)?.key).toBe(s.key);
    }
  });

  test("misses between sockets and on bare stone", () => {
    const [a, b] = [altar.sockets.find((s) => s.key === "bag:0")!, altar.sockets.find((s) => s.key === "bag:1")!];
    expect(socketAt(altar, (a.x + b.x) / 2, a.y)).toBeNull();
    expect(socketAt(altar, 0, 0.1)).toBeNull(); // the wizard's niche
  });

  test("onTablet knows the edge", () => {
    expect(onTablet(altar, altar.width / 2 - 0.01, 0)).toBe(true);
    expect(onTablet(altar, altar.width / 2 + 0.01, 0)).toBe(false);
    expect(onTablet(altar, 0, -altar.height / 2 - 0.05, 0.08)).toBe(true);
  });
});

describe("arrangement (tablets in the scene)", () => {
  test("inventory: the altar alone, centred and facing you", () => {
    const a = arrangement("inventory");
    expect(a.side).toBeNull();
    expect(a.altar.x).toBe(0);
    expect(a.altar.yaw).toBe(0);
  });

  test("chest/merchant: altar left, second tablet right, both turned inward, not touching", () => {
    for (const mode of ["chest", "merchant"] as const) {
      const a = arrangement(mode);
      expect(a.side?.id).toBe(mode === "chest" ? "chest" : "stall");
      expect(a.altar.x).toBeLessThan(0);
      expect(a.side!.placement.x).toBeGreaterThan(0);
      expect(a.altar.yaw).toBeGreaterThan(0);
      expect(a.side!.placement.yaw).toBeLessThan(0);
      const altarRight = a.altar.x + altarLayout().width / 2;
      const sideLeft = a.side!.placement.x - a.side!.width / 2;
      expect(sideLeft - altarRight).toBeGreaterThan(0.05);
    }
  });

  test("everything fits a 16:10 screen at full size; narrower screens scale down", () => {
    const wide = viewHalfExtent(78, 1280 / 800, SCENE_DISTANCE);
    for (const mode of ["inventory", "chest", "merchant"] as const) {
      expect(fitScale(arrangement(mode).halfWidth, wide.halfW)).toBe(1);
    }
    const square = viewHalfExtent(78, 1, SCENE_DISTANCE);
    const s = fitScale(arrangement("merchant").halfWidth, square.halfW);
    expect(s).toBeLessThan(1);
    expect(s).toBeGreaterThan(0.5);
  });
});

describe("placePlaque (where the item plaque hangs)", () => {
  const bounds = { halfW: 2, halfH: 1.2 };
  const size = { w: 1, h: 0.5 };

  test("hangs on the preferred side, level with the socket", () => {
    const p = placePlaque({ x: -0.5, y: 0.2, half: 0.1 }, size, bounds, -1);
    expect(p.side).toBe(-1);
    expect(p.x + size.w / 2).toBeLessThan(-0.5 - 0.1);
    expect(p.y).toBeCloseTo(0.2);
  });

  test("flips when the preferred side would leave the view", () => {
    const p = placePlaque({ x: -1.5, y: 0, half: 0.1 }, size, bounds, -1);
    expect(p.side).toBe(1);
    expect(p.x - size.w / 2).toBeGreaterThan(-1.5 + 0.1);
  });

  test("clamps inside the view when neither side fits", () => {
    const p = placePlaque({ x: 0, y: -1.1, half: 0.1 }, { w: 3.9, h: 0.5 }, bounds, 1);
    expect(Math.abs(p.x) + 3.9 / 2).toBeLessThanOrEqual(bounds.halfW + 1e-9);
    expect(p.y - 0.25).toBeGreaterThanOrEqual(-bounds.halfH - 1e-9);
  });
});
