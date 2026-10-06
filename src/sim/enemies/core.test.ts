import { beforeAll, describe, expect, test } from "bun:test";
import RAPIER from "@dimforge/rapier3d-compat";
import { NEUTRAL_FLOOR_RULES } from "../../game/floorRules";
import { enemyBody, ENEMY_BODIES, slimeBody, type BodySpec } from "../bodies";
import type { SimAction, SimTarget, SimWorld } from "../world";
import { EnemyCore, type EnemyCoreOptions } from "./core";
import { SentryController, SlimeController, WardenController, WispController } from "./controllers";

beforeAll(async () => {
  await RAPIER.init();
});

/** A scripted world: one wizard where the test puts it, sight as the test says. */
function scriptedWorld() {
  const actions: SimAction[] = [];
  const target: SimTarget = { pos: { x: 0, y: 1, z: 6 }, vel: { x: 0, y: 0, z: 0 }, dist: 6 };
  let clear = true;
  let roll = 0;
  const world: SimWorld = {
    rules: () => NEUTRAL_FLOOR_RULES,
    nearestWizard(x, y, z) {
      target.dist = Math.hypot(target.pos.x - x, target.pos.y - y, target.pos.z - z);
      return target;
    },
    aggroMult: () => 1,
    clearShot: () => clear,
    random: () => ((roll = (roll * 9301 + 49297) % 233280) / 233280),
    act: (a) => actions.push(a),
    cue: () => {},
  };
  return { world, actions, target, setClear: (c: boolean) => (clear = c) };
}

/** A real Rapier body for `spec` at `pos`, in a world of its own. */
function bodyOf(spec: BodySpec, pos: [number, number, number]) {
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const desc = (spec.type === "fixed" ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic())
    .setTranslation(...pos)
    .setGravityScale(0);
  const body = w.createRigidBody(desc);
  w.createCollider(RAPIER.ColliderDesc.ball(0.4).setMass(spec.mass || 1), body);
  return { w, body };
}

function core(world: SimWorld, over: Partial<EnemyCoreOptions> = {}) {
  const opts: EnemyCoreOptions = { id: "e0", kind: "wisp", floor: 1, position: [0, 1, 0], drops: { minY: 0.6 }, ...over };
  const { w, body } = bodyOf(enemyBody(opts.kind, opts.generation), opts.position);
  return { c: new EnemyCore(world, opts, () => body), body, w };
}

describe("enemy core", () => {
  test("a hit hurts, staggers, wakes and shoves; a lethal one reports the death and the loot once", () => {
    const { world, actions } = scriptedWorld();
    const { c, body } = core(world);
    const hpEvents: number[] = [];
    const deaths: boolean[] = [];
    c.onHp = (hp) => hpEvents.push(hp);
    c.onDeath = (_, silent) => deaths.push(silent);
    c.hit(1, { x: 3, y: 0, z: 0 });
    expect(c.hp).toBe(c.maxHp - 1);
    expect(c.aggro).toBe(true);
    expect(c.flash).toBe(1);
    expect(c.knockTimer).toBeGreaterThan(0);
    expect(body.linvel().x).toBeGreaterThan(0);
    c.hit(c.maxHp, { x: 0, y: 0, z: 0 });
    c.hit(5, { x: 0, y: 0, z: 0 }); // already dead
    expect(hpEvents).toHaveLength(2);
    expect(deaths).toEqual([false]);
    expect(actions.map((a) => a.type)).toEqual(["died", "loot"]);
    const loot = actions[1] as Extract<SimAction, { type: "loot" }>;
    expect(loot.source).toEqual({ kind: "enemy", enemy: "wisp", gen: 0 });
    expect(loot.at[1]).toBeGreaterThanOrEqual(0.6);
  });

  test("a death the authority announced is shown, never re-reported", () => {
    const { world, actions } = scriptedWorld();
    const { c } = core(world);
    const deaths: boolean[] = [];
    c.onDeath = (_, silent) => deaths.push(silent);
    c.despawned(true);
    expect(deaths).toEqual([true]);
    expect(actions).toEqual([]);
  });
});

describe("enemy controllers", () => {
  test("a woken wisp heads for the nearest wizard", () => {
    const { world } = scriptedWorld();
    const { c, body } = core(world);
    const wisp = new WispController(c);
    c.aggro = true;
    for (let i = 0; i < 30; i++) wisp.think(c.beginFrame(1 / 30)!, 1 / 30, i / 30);
    expect(body.linvel().z).toBeGreaterThan(1); // the wizard stands at +z
  });

  test("a sentry fires only at a wizard it can see, in range", () => {
    const { world, actions, target, setClear } = scriptedWorld();
    const { c } = core(world, { kind: "sentry", id: "e1" });
    const sentry = new SentryController(c);
    const run = (seconds: number) => {
      for (let t = 0; t < seconds; t += 0.1) sentry.think(c.beginFrame(0.1)!, 0.1);
    };
    setClear(false);
    run(10);
    expect(actions.filter((a) => a.type === "cast")).toHaveLength(0);
    setClear(true);
    target.pos = { x: 0, y: 1, z: 60 }; // out of range
    run(10);
    expect(actions.filter((a) => a.type === "cast")).toHaveLength(0);
    target.pos = { x: 0, y: 1, z: 8 };
    run(10);
    const casts = actions.filter((a) => a.type === "cast") as Extract<SimAction, { type: "cast" }>[];
    expect(casts.length).toBeGreaterThan(1);
    expect(casts[0].data.velocity[2]).toBeGreaterThan(0); // toward the wizard
  });

  test("a slime splits in two until its last generation", () => {
    for (const [gen, children] of [[0, 2], [1, 2], [2, 0]] as const) {
      const { world, actions } = scriptedWorld();
      const { c } = core(world, { kind: "slime", generation: gen });
      new SlimeController(c, gen);
      c.hit(c.maxHp + 1, { x: 0, y: 0, z: 0 });
      const spawns = actions.filter((a) => a.type === "spawn") as Extract<SimAction, { type: "spawn" }>[];
      expect(spawns).toHaveLength(children);
      for (const s of spawns) expect(s.generation).toBe(gen + 1);
    }
    expect(slimeBody(2).mass).toBeLessThan(slimeBody(0).mass);
  });

  test("the Warden wakes when a wizard comes near, fights, and leaves its hoard to the loot book", () => {
    const { world, actions, target } = scriptedWorld();
    const { c } = core(world, { kind: "boss", id: "boss", floor: 10, drops: undefined });
    expect(ENEMY_BODIES.boss.mass).toBe(30);
    const warden = new WardenController(c);
    const cues: string[] = [];
    c.onCue = (cue) => cues.push(cue.type);
    target.pos = { x: 0, y: 1, z: 40 };
    for (let t = 0; t < 3; t += 0.1) warden.think(c.beginFrame(0.1)!, 0.1, t);
    expect(c.aggro).toBe(false); // nobody near
    target.pos = { x: 0, y: 1, z: 6 };
    for (let t = 0; t < 20; t += 0.05) warden.think(c.beginFrame(0.05)!, 0.05, t);
    expect(cues[0]).toBe("wake");
    expect(actions.some((a) => a.type === "cast" || a.type === "boom")).toBe(true);
    actions.length = 0;
    c.hit(c.maxHp * 2, { x: 0, y: 0, z: 0 });
    expect(actions.map((a) => a.type)).toEqual(["died", "loot"]);
    expect((actions[1] as Extract<SimAction, { type: "loot" }>).source).toEqual({ kind: "boss" });
  });
});
