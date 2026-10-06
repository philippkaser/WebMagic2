import { beforeAll, describe, expect, test } from "bun:test";
import RAPIER from "@dimforge/rapier3d-compat";
import { Rng } from "../core/rng";
import type { Vec } from "../enemies/brains/common";
import { SENTRY } from "../enemies/brains/sentry";
import { SLIME_MAX_GEN } from "../enemies/brains/slime";
import { hitCapForFloor } from "../weapons/hits";
import { generateFloor } from "../world/gen";
import { FloorSim } from "./floorSim";
import type { SimAction } from "./world";

beforeAll(async () => {
  await RAPIER.init();
});

const DT = 1 / 60;
const ZERO: Vec = { x: 0, y: 0, z: 0 };

function sim(seed: number, floor: number, rngSeed = 1) {
  const rng = new Rng(rngSeed);
  return new FloorSim(RAPIER, generateFloor(seed, floor), floor, { random: () => rng.next() });
}

function run(s: FloorSim, seconds: number): void {
  for (let t = 0; t < seconds; t += DT) s.step(DT);
}

function where(s: FloorSim, id: string): Vec {
  const t = s.physics.bodies.get(id)!.translation();
  return { x: t.x, y: t.y, z: t.z };
}

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** A spot `range` metres from `id` in a direction the floor leaves open (so
 * a wizard placed there is neither in a wall nor out of sight). */
function openSpot(s: FloorSim, id: string, range: number, lift = 0): Vec {
  const body = s.physics.bodies.get(id)!;
  const from = where(s, id);
  from.y += lift;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const dir = { x: Math.cos(a), y: 0, z: Math.sin(a) };
    if (s.world.clearShot(from, dir, range + 1.5, body)) {
      return { x: from.x + dir.x * range, y: from.y, z: from.z + dir.z * range };
    }
  }
  throw new Error(`no open spot around ${id}`);
}

const ofType = <T extends SimAction["type"]>(actions: SimAction[], type: T) =>
  actions.filter((a) => a.type === type) as Extract<SimAction, { type: T }>[];

const firstOf = (s: FloorSim, kind: string) => s.living().find((id) => s.enemy(id)!.opts.kind === kind)!;

describe("FloorSim", () => {
  test("spawns the layout's enemies under the client's ids, and the floor's omen", () => {
    const layout = generateFloor(5, 10);
    const s = sim(5, 10);
    expect(s.living()).toEqual([...layout.enemies.map((_, i) => `e${i}`), "boss"]);
    expect(layout.omen).toBe("volatile");
    expect(s.rules.explosionRadiusMult).toBeGreaterThan(1);
    expect(s.gone()).toEqual([]);
    s.free();
  });

  test("an empty floor idles: nothing wakes, nothing is decided", () => {
    const s = sim(3, 6);
    run(s, 3);
    expect(s.drain()).toEqual([]);
    for (const id of s.living()) expect(s.enemy(id)!.aggro).toBe(false);
    s.free();
  });

  test("a wizard on the floor is hunted", () => {
    const s = sim(1, 1);
    const wisp = s.living()[0];
    const spot = openSpot(s, wisp, 6);
    s.setWizard("w1", spot, ZERO);
    const before = dist(where(s, wisp), spot);
    run(s, 1.5);
    expect(s.enemy(wisp)!.aggro).toBe(true);
    expect(dist(where(s, wisp), spot)).toBeLessThan(before - 1);
    s.free();
  });

  test("hits off the wire are sanitized and capped, and a kill reports its death and loot", () => {
    const s = sim(1, 1);
    const id = s.living()[0];
    const core = s.enemy(id)!;
    expect(s.hit(id, { damage: NaN, impulse: ZERO })).toBe(false);
    expect(s.hit(id, "nonsense")).toBe(false);
    expect(s.hit("e999", { damage: 1, impulse: ZERO })).toBe(false);
    expect(core.hp).toBe(core.maxHp);

    // A hacked client's billion-damage hit lands as this depth's cap.
    const tough = sim(1, 1);
    const big = tough.enemy(id)!;
    big.hp = 1e6;
    tough.hit(id, { damage: 1e9, impulse: ZERO });
    expect(big.hp).toBe(1e6 - hitCapForFloor(1));
    tough.free();

    expect(s.hit(id, { damage: core.maxHp, impulse: { x: 2, y: 0, z: 0 } })).toBe(true);
    expect(s.hit(id, { damage: 1, impulse: ZERO })).toBe(false); // dead
    const actions = s.drain();
    expect(actions.map((a) => a.type)).toEqual(["died", "loot"]);
    expect(ofType(actions, "loot")[0].source).toEqual({ kind: "enemy", enemy: "wisp", gen: 0 });
    expect(s.living()).not.toContain(id);
    expect(s.gone()).toEqual([id]);
    expect(s.physics.bodies.has(id)).toBe(false);
    s.free();
  });

  test("a slime splits into named children down to its last generation", () => {
    const s = sim(3, 6);
    let wave = [firstOf(s, "slime")];
    const deaths: string[] = [];
    for (let gen = 0; gen <= SLIME_MAX_GEN; gen++) {
      const next: string[] = [];
      for (const id of wave) {
        expect(s.enemy(id)!.opts.generation ?? 0).toBe(gen);
        s.hit(id, { damage: 1e9, impulse: ZERO });
        const actions = s.drain();
        deaths.push(...ofType(actions, "died").map((a) => a.id));
        expect(ofType(actions, "loot")[0].source).toEqual({ kind: "enemy", enemy: "slime", gen });
        for (const spawn of ofType(actions, "spawn")) {
          expect(spawn.id).toMatch(/^s\d+$/);
          expect(spawn.generation).toBe(gen + 1);
          expect(s.living()).toContain(spawn.id!);
          next.push(spawn.id!);
        }
      }
      expect(next).toHaveLength(gen < SLIME_MAX_GEN ? wave.length * 2 : 0);
      wave = next;
      run(s, 0.2); // the children land
    }
    expect(deaths).toHaveLength(1 + 2 + 4);
    expect(new Set(deaths).size).toBe(deaths.length);
    s.free();
  });

  test("a sentry shoots a wizard it can see — leading them — and nobody it can't", () => {
    const s = sim(3, 6);
    const sentry = firstOf(s, "sentry");
    const spot = openSpot(s, sentry, 8, SENTRY.headHeight);
    s.setWizard("w1", spot, { x: 0, y: 0, z: 0 });
    run(s, 8);
    const casts = ofType(s.drain(), "cast");
    expect(casts.length).toBeGreaterThan(0);
    const head = where(s, sentry);
    const v = casts[0].data.velocity;
    const toward = (spot.x - head.x) * v[0] + (spot.z - head.z) * v[2];
    expect(toward).toBeGreaterThan(0);

    // Out of range: the same wizard far beyond its reach draws no fire.
    s.setWizard("w1", { x: head.x + SENTRY.range + 20, y: head.y, z: head.z }, ZERO);
    s.drain();
    run(s, 6);
    expect(ofType(s.drain(), "cast")).toEqual([]);
    s.free();
  });

  test("the Warden wakes, fights, and leaves its hoard to the loot book", () => {
    const s = sim(9, 10);
    expect(s.enemy("boss")!.aggro).toBe(false);
    s.setWizard("w1", openSpot(s, "boss", 7), ZERO);
    run(s, 15);
    const fight = s.drain();
    expect(s.enemy("boss")!.aggro).toBe(true);
    expect(fight.some((a) => a.type === "cast" || a.type === "boom")).toBe(true);
    const boss = s.enemy("boss")!;
    while (!boss.dead) s.hit("boss", { damage: 1e9, impulse: ZERO });
    const end = s.drain();
    expect(end.map((a) => a.type)).toEqual(["died", "loot"]);
    expect(ofType(end, "loot")[0].source).toEqual({ kind: "boss" });
    s.free();
  });

  test("snapshots: the full set for a late joiner, then only what changed", () => {
    const s = sim(3, 6);
    run(s, 4); // let everything settle
    const full = s.snapshot(true);
    expect(full.map((e) => e.id).sort()).toEqual([...s.physics.bodies.keys()].sort());
    const sentry = full.find((e) => e.id === firstOf(s, "sentry"))!;
    expect(sentry.v).toBeUndefined(); // fixed: position and fields only
    expect(sentry.f?.hp).toBeGreaterThan(0);
    const prop = full.find((e) => e.id.startsWith("p"))!;
    expect(prop.q).toHaveLength(4); // props tumble
    expect(prop.f).toBeUndefined();

    s.snapshot(); // prime the delta filter
    expect(s.snapshot()).toEqual([]); // nothing moved, nothing changed
    const slime = firstOf(s, "slime");
    s.hit(slime, { damage: 1, impulse: ZERO });
    const delta = s.snapshot();
    expect(delta.map((e) => e.id)).toEqual([slime]);
    expect(delta[0].f?.hp).toBe(s.enemy(slime)!.hp);
    s.free();
  });

  test("the same floor, wizards and dice play out the same way", () => {
    const play = () => {
      const s = sim(5, 10, 42);
      const wisp = s.living()[0];
      s.setWizard("w1", openSpot(s, wisp, 5), ZERO);
      s.setWizard("w2", openSpot(s, "boss", 8), ZERO);
      run(s, 6);
      s.hit(wisp, { damage: 1e9, impulse: { x: 0, y: 5, z: 0 } });
      run(s, 2);
      const out = { actions: s.drain(), snap: s.snapshot(true) };
      s.free();
      return out;
    };
    const a = play();
    expect(a.actions.length).toBeGreaterThan(0);
    expect(play()).toEqual(a);
  });

  test("a wizard who leaves takes their capsule along", () => {
    const s = sim(1, 1);
    s.setWizard("w1", { x: 0, y: 1, z: 0 }, ZERO);
    expect(s.counts().wizards).toBe(1);
    s.removeWizard("w1");
    s.removeWizard("w1");
    expect(s.counts().wizards).toBe(0);
    run(s, 1);
    expect(s.drain()).toEqual([]);
    s.free();
  });
});
