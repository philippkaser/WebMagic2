import { beforeAll, describe, expect, test } from "bun:test";
import RAPIER from "@dimforge/rapier3d-compat";
import { floorScale, PLAYER } from "../core/config";
import { Rng } from "../core/rng";
import type { Vec } from "../enemies/brains/common";
import { getTrapDef } from "../world/trapCatalog";
import { generateFloor } from "../world/gen";
import { contactOf } from "./enemies/controllers";
import { FloorSim } from "./floorSim";
import type { SimAction } from "./world";

/** The dungeon's harm to wizards, as a server host judges it. */

beforeAll(async () => {
  await RAPIER.init();
});

const DT = 1 / 60;
const STILL: Vec = { x: 0, y: 0, z: 0 };
const SEED = 1;
const FLOOR = 6; // spikes, sentries, barrels, slimes and wisps
const layout = generateFloor(SEED, FLOOR);

function sim() {
  const rng = new Rng(4);
  return new FloorSim(RAPIER, layout, FLOOR, { random: () => rng.next() });
}

function run(s: FloorSim, seconds: number): void {
  for (let t = 0; t < seconds; t += DT) s.step(DT);
}

type Hurt = Extract<SimAction, { type: "wizardHurt" }>;
const hurts = (s: FloorSim) => s.drain().filter((a): a is Hurt => a.type === "wizardHurt");

function where(s: FloorSim, id: string): Vec {
  const t = s.physics.bodies.get(id)!.translation();
  return { x: t.x, y: t.y, z: t.z };
}

describe("the dungeon's harm to wizards", () => {
  test("a wisp's touch burns, once per its cooldown, at the floor's damage", () => {
    const s = sim();
    const wisp = s.living().find((id) => s.enemy(id)!.opts.kind === "wisp")!;
    // Alone with it (every other enemy — and every slime's children — gone).
    for (let i = 0; i < 6; i++) for (const id of s.living()) if (id !== wisp) s.hit(id, { damage: 1e9, impulse: STILL });
    expect(s.living()).toEqual([wisp]);
    s.drain();
    // Stand right on it: it burns at once, then again a cooldown later.
    s.setWizard("w1", where(s, wisp), STILL);
    s.step(DT);
    let h = hurts(s);
    expect(h.map((x) => [x.wizard, x.cause])).toEqual([["w1", "enemy"]]);
    expect(h[0].damage).toBeCloseTo(s.enemy(wisp)!.damage(contactOf("wisp")!.damage), 6);
    const spec = contactOf("wisp")!;
    for (let t = 0; t < spec.cooldown - 2 * DT; t += DT) {
      s.setWizard("w1", where(s, wisp), STILL);
      s.step(DT);
    }
    expect(hurts(s)).toEqual([]);
    for (let i = 0; i < 6; i++) {
      s.setWizard("w1", where(s, wisp), STILL);
      s.step(DT);
    }
    expect(hurts(s)).toHaveLength(1);
    s.free();
  });

  test("a spike plate stabs whoever steps on it, then re-arms", () => {
    const s = sim();
    const plate = layout.traps.find((t) => t.kind === "spike")!.pos;
    s.setWizard("w1", { x: plate[0], y: plate[1] + PLAYER.halfHeight + PLAYER.radius, z: plate[2] }, STILL);
    s.step(DT);
    const h = hurts(s).filter((x) => x.cause === "world");
    expect(h).toHaveLength(1);
    expect(h[0].damage).toBeCloseTo(getTrapDef("spike").baseDamage * floorScale(FLOOR).enemyDamage, 6);
    s.step(DT);
    expect(hurts(s).filter((x) => x.cause === "world")).toEqual([]);
    s.free();
  });

  test("a sentry's bolt flies here too, and its burst hurts the wizard it reaches", () => {
    const s = sim();
    const sentry = s.living().find((id) => s.enemy(id)!.opts.kind === "sentry")!;
    const at = where(s, sentry);
    const body = s.physics.bodies.get(sentry)!;
    const head = { x: at.x, y: at.y + 1.05, z: at.z };
    let spot: Vec | null = null;
    for (let i = 0; i < 16 && !spot; i++) {
      const a = (i / 16) * Math.PI * 2;
      const d = { x: Math.cos(a), y: 0, z: Math.sin(a) };
      if (s.world.clearShot(head, d, 7.5, body)) spot = { x: head.x + d.x * 6, y: head.y, z: head.z + d.z * 6 };
    }
    let got: Hurt[] = [];
    for (let t = 0; t < 8 && got.length === 0; t += DT) {
      s.setWizard("w1", spot!, STILL);
      s.step(DT);
      got = hurts(s).filter((x) => x.cause === "enemy");
    }
    expect(got.length).toBeGreaterThan(0);
    expect(got[0].wizard).toBe("w1");
    s.free();
  });

  test("a barrel's blast hurts the wizards beside it — blamed on the world", () => {
    const s = sim();
    const i = layout.props.findIndex((p) => p.kind === "barrel");
    const at = where(s, `p${i}`);
    s.setWizard("w1", { x: at.x + 1, y: at.y + 0.5, z: at.z }, STILL);
    s.step(DT);
    s.drain();
    s.hit(`p${i}`, { damage: 1e9, impulse: STILL });
    const h = hurts(s).filter((x) => x.cause === "world");
    expect(h.map((x) => x.wizard)).toEqual(["w1"]);
    expect(h[0].damage).toBeGreaterThan(0);
    s.free();
  });

  test("nobody on the floor: nothing to hurt", () => {
    const s = sim();
    run(s, 3);
    expect(hurts(s)).toEqual([]);
    s.free();
  });
});
