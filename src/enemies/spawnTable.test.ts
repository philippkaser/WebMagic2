import { describe, expect, test } from "bun:test";
import { DUNGEON } from "../core/config";
import { Rng } from "../core/rng";
import { bossFor } from "./bosses/bossTable";
import { bandFor, ENEMY_BANDS, pickEnemy, SPAWN_HEIGHT } from "./spawnTable";

/** Every kind a floor can roll (many picks, fixed seed). */
function kindsOn(floor: number, picks = 600): Set<string> {
  const rng = new Rng(1234 + floor);
  const kinds = new Set<string>();
  for (let i = 0; i < picks; i++) kinds.add(pickEnemy(floor, rng).kind);
  return kinds;
}

describe("spawnTable", () => {
  test("bands start at the biome floors and cover the whole dungeon", () => {
    expect(ENEMY_BANDS.map((b) => b.fromFloor)).toEqual([1, 15, 30, 50, 75]);
    expect(bandFor(1).id).toBe("catacombs");
    expect(bandFor(14).id).toBe("catacombs");
    expect(bandFor(15).id).toBe("drowned");
    expect(bandFor(49).id).toBe("ember");
    expect(bandFor(74).id).toBe("crystal");
    expect(bandFor(DUNGEON.maxFloor).id).toBe("abyss");
  });

  test("every floor can spawn something, with its band's height", () => {
    for (let f = 1; f <= DUNGEON.maxFloor; f++) {
      const row = pickEnemy(f, new Rng(f));
      expect(row.y).toBe(SPAWN_HEIGHT[row.kind]);
    }
  });

  test("each band has a signature enemy the band above lacks", () => {
    expect(kindsOn(20).has("drowned")).toBe(true);
    expect(kindsOn(10).has("drowned")).toBe(false);
    expect(kindsOn(35).has("imp")).toBe(true);
    expect(kindsOn(25).has("imp")).toBe(false);
    expect(kindsOn(60).has("golem")).toBe(true);
    expect(kindsOn(45).has("golem")).toBe(false);
    expect(kindsOn(90).has("shade")).toBe(true);
  });

  test("early floors stay approachable", () => {
    expect([...kindsOn(1)]).toEqual(["wisp"]);
    for (const f of [2, 3]) {
      for (const k of kindsOn(f)) expect(["wisp", "skitter"]).toContain(k);
    }
    for (let f = 1; f <= 14; f++) {
      for (const k of kindsOn(f, 200)) expect(["drowned", "shade", "imp", "golem"]).not.toContain(k);
    }
  });

  test("the Choir takes the odd deep tens, the Warden the rest", () => {
    expect([10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(bossFor)).toEqual(
      ["warden", "warden", "choir", "warden", "choir", "warden", "choir", "warden", "choir", "warden"],
    );
  });

  test("picks are deterministic for a given rng", () => {
    const a = new Rng(99);
    const b = new Rng(99);
    for (let i = 0; i < 200; i++) {
      const floor = 1 + (i % DUNGEON.maxFloor);
      expect(pickEnemy(floor, a)).toEqual(pickEnemy(floor, b));
    }
  });
});
