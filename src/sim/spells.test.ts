import { beforeAll, describe, expect, test } from "bun:test";
import RAPIER from "@dimforge/rapier3d-compat";
import { Rng } from "../core/rng";
import type { Vec } from "../enemies/brains/common";
import { getSpellDef, type BoltSpell } from "../weapons/spellCatalog";
import { generateFloor } from "../world/gen";
import { FloorSim } from "./floorSim";
import { BLACK_HOLE, boltVolley, SEED, steerHoming, type SpellStats } from "./spells";

beforeAll(async () => {
  await RAPIER.init();
});

const DT = 1 / 60;
const PLAIN: SpellStats = { damageMult: 1, extraProjectiles: 0, homing: 0 };

function sim(seed = 1, floor = 1) {
  const rng = new Rng(9);
  return new FloorSim(RAPIER, generateFloor(seed, floor), floor, { random: () => rng.next() });
}

function run(s: FloorSim, seconds: number): void {
  for (let t = 0; t < seconds; t += DT) s.step(DT);
}

function where(s: FloorSim, id: string): Vec {
  const t = s.physics.bodies.get(id)!.translation();
  return { x: t.x, y: t.y, z: t.z };
}

/** A spot `range` m from `id` along a direction the floor leaves open. */
function openSpot(s: FloorSim, id: string, range: number): { from: Vec; dir: Vec } {
  const at = where(s, id);
  const body = s.physics.bodies.get(id)!;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const dir = { x: Math.cos(a), y: 0, z: Math.sin(a) };
    if (s.world.clearShot(at, dir, range + 1, body)) {
      const from = { x: at.x + dir.x * range, y: at.y, z: at.z + dir.z * range };
      return { from, dir: { x: -dir.x, y: 0, z: -dir.z } }; // aiming back at it
    }
  }
  throw new Error("no open spot");
}

describe("shared spell behaviour", () => {
  test("a volley is the same volley wherever it's fired from the same seed", () => {
    const scatter = getSpellDef("scatter") as BoltSpell;
    const dir = { x: 0, y: 0, z: 1 };
    const a = boltVolley(scatter, dir, 1, 42);
    expect(a).toHaveLength(6);
    expect(boltVolley(scatter, dir, 1, 42)).toEqual(a);
    expect(boltVolley(scatter, dir, 1, 43)).not.toEqual(a);
    for (const d of a) {
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
      expect(d.z).toBeGreaterThan(0.9); // spread, not scattered everywhere
    }
  });

  test("homing curves toward a target ahead, keeps its speed, ignores one behind", () => {
    const vel = { x: 0, y: 0, z: 10 };
    steerHoming({ x: 0, y: 0, z: 0 }, vel, { x: 5, y: 0, z: 10 }, 1, 0.05);
    expect(vel.x).toBeGreaterThan(0);
    expect(Math.hypot(vel.x, vel.y, vel.z)).toBeCloseTo(10, 6);
    const back = { x: 0, y: 0, z: 10 };
    steerHoming({ x: 0, y: 0, z: 0 }, back, { x: 0, y: 0, z: -10 }, 1, 0.05);
    expect(back).toEqual({ x: 0, y: 0, z: 10 });
  });
});

describe("the authority's copy of a wizard's spells", () => {
  test("bolts fly, hit and hurt — the cast decides the damage, not the caster", () => {
    const s = sim();
    const wisp = s.living()[0];
    const { from, dir } = openSpot(s, wisp, 5);
    const hp = s.enemy(wisp)!.hp;
    s.castSpell("w1", { abilityId: "bolt", origin: from, dir, seed: 1 }, PLAIN);
    run(s, 0.5);
    expect(s.enemy(wisp)!.hp).toBeLessThan(hp);
    expect(s.spellsLive.projectiles).toBe(0);
    // Its gear decides how hard: twice the damage mult, twice the dent.
    const s2 = sim();
    s2.castSpell("w1", { abilityId: "bolt", origin: from, dir, seed: 1 }, { ...PLAIN, damageMult: 2 });
    run(s2, 0.5);
    expect(hp - s2.enemy(wisp)!.hp).toBeCloseTo(2 * (hp - s.enemy(wisp)!.hp), 1);
    s.free();
    s2.free();
  });

  test("walls stop bolts: nothing behind one gets hurt", () => {
    const s = sim();
    const wisp = s.living()[0];
    const at = where(s, wisp);
    // Fire from just beside it, straight into the nearest wall, away from it.
    const body = s.physics.bodies.get(wisp)!;
    let away: Vec | null = null;
    for (let i = 0; i < 16 && !away; i++) {
      const a = (i / 16) * Math.PI * 2;
      const d = { x: Math.cos(a), y: 0, z: Math.sin(a) };
      if (!s.world.clearShot(at, d, 4, body)) away = d;
    }
    const hp = s.enemy(wisp)!.hp;
    // From the far side of that wall, aimed back through it at the wisp.
    const behind = { x: at.x + away!.x * 12, y: at.y, z: at.z + away!.z * 12 };
    s.castSpell("w1", { abilityId: "lance", origin: behind, dir: { x: -away!.x, y: 0, z: -away!.z }, seed: 1 }, PLAIN);
    run(s, 1);
    expect(s.enemy(wisp)!.hp).toBe(hp);
    s.free();
  });

  test("a blast lands ahead of the staff, a shockwave around the caster", () => {
    const s = sim();
    const wisp = s.living()[0];
    const at = where(s, wisp);
    const hp = s.enemy(wisp)!.hp;
    s.castSpell("w1", { abilityId: "blast", origin: { x: at.x - 1.5, y: at.y, z: at.z }, dir: { x: 1, y: 0, z: 0 }, seed: 0 }, PLAIN);
    const afterBlast = s.enemy(wisp)?.hp ?? 0;
    expect(afterBlast).toBeLessThan(hp);
    s.castSpell("w1", { abilityId: "shockwave", origin: { x: at.x + 2, y: at.y, z: at.z }, dir: { x: 0, y: 0, z: 1 }, seed: 0 }, PLAIN);
    expect(s.enemy(wisp)?.hp ?? 0).toBeLessThan(afterBlast);
    s.free();
  });

  test("seeds wait for their own caster's Collapse, then pull and implode", () => {
    const s = sim();
    const wisp = s.living()[0];
    const at = where(s, wisp);
    const seedAt = { x: at.x + 1.5, y: at.y, z: at.z };
    // A seed thrown straight down plants where it lands.
    s.castSpell("w1", { abilityId: "voidseed", origin: seedAt, dir: { x: 0, y: -1, z: 0 }, seed: 0 }, PLAIN);
    run(s, 0.5);
    expect(s.spellsLive).toEqual({ projectiles: 1, holes: 0 });
    s.castSpell("w2", { abilityId: "collapse", origin: seedAt, dir: { x: 0, y: 0, z: 1 }, seed: 0 }, PLAIN);
    expect(s.spellsLive).toEqual({ projectiles: 1, holes: 0 }); // not w2's seed
    const hp = s.enemy(wisp)!.hp;
    s.castSpell("w1", { abilityId: "collapse", origin: seedAt, dir: { x: 0, y: 0, z: 1 }, seed: 0 }, PLAIN);
    expect(s.spellsLive).toEqual({ projectiles: 0, holes: 1 });
    run(s, BLACK_HOLE.duration + 0.1);
    expect(s.spellsLive.holes).toBe(0);
    expect(s.enemy(wisp)?.hp ?? 0).toBeLessThan(hp - BLACK_HOLE.tugDamage * 3);
    s.free();
  });

  test("an unspent seed fizzles", () => {
    const s = sim();
    const wisp = s.living()[0];
    const at = where(s, wisp);
    s.castSpell("w1", { abilityId: "voidseed", origin: { x: at.x + 3, y: at.y, z: at.z }, dir: { x: 0, y: -1, z: 0 }, seed: 0 }, PLAIN);
    run(s, SEED.lifetime + 0.1);
    expect(s.spellsLive.projectiles).toBe(0);
    s.free();
  });
});
