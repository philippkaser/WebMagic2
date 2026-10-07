import type { RigidBody } from "@dimforge/rapier3d-compat";
import { aimDir, createChaseInput, createMove, createSteering, type Vec } from "../../enemies/brains/common";
import { createSentryBrain, createSentryTick, SENTRY, sentryLead, tickSentry } from "../../enemies/brains/sentry";
import { createShadowBrain, tickShadow } from "../../enemies/brains/shadow";
import { createSlimeBrain, SLIME_MAX_GEN, slimeGeneration, tickSlime } from "../../enemies/brains/slime";
import {
  createWardenBrain,
  createWardenMoveInput,
  isEnraged,
  tickWardenAttack,
  tickWardenMove,
  WARDEN,
  wardenChargeVelocity,
  wardenRingBolt,
  wardenRingCount,
  wardenVolleyAim,
  wardenVolleyBolt,
  wardenVolleyCount,
} from "../../enemies/brains/warden";
import { tickWisp } from "../../enemies/brains/wisp";
import type { EnemyId } from "../../enemies/roster";
import { PLAYER } from "../../core/config";
import type { Vec3 } from "../../world/types";
import { EnemyCore, type EnemyCoreOptions } from "./core";
import type { SimWorld } from "../world";

/** Each enemy kind's authority half: what it senses, how its brain (the pure
 * state machines in enemies/brains) decides, and what it does about it —
 * steer its body, fire, slam, split. Its looks, sounds and replication live
 * in its view (enemies/kinds); this runs wherever the floor's authority does,
 * in a host's browser or on a server, through the core's SimWorld. */

export interface EnemyController {
  readonly core: EnemyCore;
  /** One authority frame of the living enemy (`time`: the scene clock, s). */
  think(b: RigidBody, dt: number, time: number): void;
}

/** Sentry bolt colour. */
export const SENTRY_BOLT_COLOR = "#ff5136";
/** The Warden's colour: its volleys, its slam, its charge. */
export const WARDEN_COLOR = "#ff3d2e";
/** The Warden's ring of embers. */
export const WARDEN_EMBER = "#ff8b3d";
/** The slam's blast radius (before the floor's explosion rule). */
export const WARDEN_SLAM_RADIUS = 5.2;

/** The plain chaser: homes in on the nearest wizard (brains/wisp.ts). */
export class WispController implements EnemyController {
  private senses = createChaseInput();
  private steering = createSteering();
  /** Desynchronises the bobbing of neighbouring wisps. */
  private phase: number;

  constructor(readonly core: EnemyCore) {
    this.phase = core.world.random() * Math.PI * 2;
  }

  think(b: RigidBody, dt: number, time: number): void {
    const c = this.core;
    c.steer(b, tickWisp(this.phase, c.sense(this.senses, b, b.translation(), time, dt), this.steering));
  }
}

/** The stalker: circles, then darts in (brains/shadow.ts). */
export class ShadowController implements EnemyController {
  readonly brain;
  private senses = createChaseInput();
  private steering = createSteering();

  constructor(readonly core: EnemyCore) {
    this.brain = createShadowBrain(() => core.world.random());
  }

  think(b: RigidBody, dt: number, time: number): void {
    const c = this.core;
    c.steer(b, tickShadow(this.brain, c.sense(this.senses, b, b.translation(), time, dt), this.steering));
  }
}

/** The hopping blob that splits on death (brains/slime.ts). */
export class SlimeController implements EnemyController {
  readonly brain;
  readonly generation: number;
  private senses = createChaseInput();
  private steering = createSteering();

  constructor(readonly core: EnemyCore, generation: number) {
    this.generation = Math.min(generation, SLIME_MAX_GEN);
    this.brain = createSlimeBrain(this.generation, () => core.world.random());
    // Dying splits it into two smaller, faster children — down to the last
    // generation, which dies for good (and carries the item drop).
    core.onSlain = (at) => {
      if (this.generation >= SLIME_MAX_GEN) return;
      for (const dx of [-0.7, 0.7]) {
        core.world.act({
          type: "spawn",
          kind: "slime" satisfies EnemyId,
          generation: this.generation + 1,
          pos: [at.x + dx, at.y + 0.2, at.z],
          floor: core.opts.floor,
        });
      }
    };
  }

  think(b: RigidBody, dt: number): void {
    const c = this.core;
    const v = b.linvel();
    c.steer(b, tickSlime(this.brain, c.sense(this.senses, b, b.translation(), 0, dt, v), this.steering));
  }
}

/** The fixed turret: winds up, then lobs a leading bolt at the nearest
 * wizard it can see (brains/sentry.ts). */
export class SentryController implements EnemyController {
  readonly brain;
  /** This frame's reload state (`charge` drives the view's glow). */
  readonly tick = createSentryTick();
  private head: Vec = { x: 0, y: 0, z: 0 };
  private aim: Vec = { x: 0, y: 0, z: 0 };

  constructor(readonly core: EnemyCore) {
    this.brain = createSentryBrain(() => core.world.random());
  }

  think(b: RigidBody, dt: number): void {
    const c = this.core;
    const t = b.translation();
    const head = this.head;
    head.x = t.x;
    head.y = t.y + SENTRY.headHeight;
    head.z = t.z;
    tickSentry(this.brain, dt, c.opts.floor, this.tick);
    if (!this.tick.fire) return;

    // Fire at the nearest wizard on the floor, leading their motion — every
    // wizard's pose carries velocity, so everyone gets led equally.
    const target = c.world.nearestWizard(head.x, head.y, head.z);
    const dist = target.dist;
    if (dist > SENTRY.range) return;
    const aim = aimDir(head, target.pos, this.aim);
    if (!c.world.clearShot(head, aim, dist - 0.6, b)) return; // wall or prop in the way
    sentryLead(aim, dist, target.vel, aim);
    const m = SENTRY.muzzleLead;
    c.world.act({
      type: "cast",
      data: {
        origin: [head.x + aim.x * m, head.y + aim.y * m, head.z + aim.z * m],
        velocity: [aim.x, aim.y, aim.z],
        damage: c.damage(11),
        color: SENTRY_BOLT_COLOR,
        size: 0.16,
        blastRadius: 1.9,
        blastImpulse: 11,
      },
    });
    c.cue({ type: "flare", at: head, dir: aim, color: SENTRY_BOLT_COLOR });
  }
}

/** The boss (brains/warden.ts): asleep until a wizard comes near (or hurts
 * it), then it fights the nearest — volleys, rings, charges and slams. Its
 * hoard is the loot book's roll. */
export class WardenController implements EnemyController {
  readonly brain;
  private move = createWardenMoveInput();
  private moveOut = createMove();
  private aim: Vec = { x: 0, y: 0, z: 0 };
  private dir: Vec = { x: 0, y: 0, z: 0 };
  private bolt: Vec = { x: 0, y: 0, z: 0 };

  constructor(readonly core: EnemyCore) {
    this.brain = createWardenBrain(() => core.world.random());
    core.onSlain = (at) =>
      core.world.act({ type: "loot", id: core.id, source: { kind: "boss" }, at: [at.x, Math.max(at.y, 0.8), at.z] });
  }

  get enraged(): boolean {
    return isEnraged(this.core.hp, this.core.maxHp);
  }

  think(b: RigidBody, dt: number, time: number): void {
    const c = this.core;
    const world = c.world;
    const t = b.translation();
    const target = world.nearestWizard(t.x, t.y + WARDEN.aimLift, t.z);
    const aim = this.aim;
    aim.x = target.pos.x - t.x;
    aim.y = target.pos.y + WARDEN.aimLift - t.y;
    aim.z = target.pos.z - t.z;
    const dist = target.dist;

    if (!c.aggro) {
      if (dist < WARDEN.wakeRange) {
        c.aggro = true;
        c.cue({ type: "wake", at: { x: t.x, y: t.y, z: t.z } });
      }
      return;
    }

    // ── Movement ─────────────────────────────────────────────────────────────
    const enraged = this.enraged;
    const speedMult = world.rules().enemySpeedMult;
    const move = this.move;
    move.pos = t;
    move.vel = b.linvel();
    move.aim = aim;
    move.dist = dist;
    move.homeY = c.opts.position[1];
    move.time = time;
    move.dt = dt;
    move.enraged = enraged;
    move.speedMult = speedMult;
    if (tickWardenMove(this.brain, move, this.moveOut).apply) b.setLinvel(this.moveOut.vel, true);

    // ── Attacks ──────────────────────────────────────────────────────────────
    const attack = tickWardenAttack(this.brain, dist, enraged, dt);
    if (!attack) return;
    if (attack === "boom") {
      world.act({
        type: "boom",
        data: { pos: [t.x, t.y, t.z], radius: WARDEN_SLAM_RADIUS, damage: c.damage(20), impulse: 46, color: WARDEN_COLOR },
      });
      return;
    }
    const origin: Vec3 = [t.x, t.y + WARDEN.aimLift, t.z];
    const bolt = this.bolt;
    const cast = (damage: number, color: string, size: number) =>
      world.act({
        type: "cast",
        data: {
          origin,
          velocity: [bolt.x, bolt.y, bolt.z],
          damage,
          color,
          size,
          blastRadius: size > 0.16 ? 1.9 : 1.5,
          blastImpulse: size > 0.16 ? 12 : 9,
        },
      });
    switch (attack) {
      case "volley": {
        // Lead the shot — every wizard's pose carries velocity.
        wardenVolleyAim(aim, dist, target.vel, this.dir);
        const damage = c.damage(10);
        for (let i = 0, n = wardenVolleyCount(enraged); i < n; i++) {
          wardenVolleyBolt(this.dir, this.brain.rand, bolt);
          cast(damage, WARDEN_COLOR, 0.17);
        }
        break;
      }
      case "ring": {
        const damage = c.damage(8);
        for (let i = 0, n = wardenRingCount(enraged); i < n; i++) {
          wardenRingBolt(i, n, bolt);
          cast(damage, WARDEN_EMBER, 0.15);
        }
        c.cue({ type: "ring", at: origin, color: WARDEN_EMBER });
        break;
      }
      case "charge":
        b.setLinvel(wardenChargeVelocity(aim, speedMult, bolt), true);
        c.cue({ type: "charge", at: origin, vel: bolt, color: WARDEN_COLOR });
        break;
      case "slam":
        // Telegraph: flare up; the brain detonates it ("boom") later. The
        // warning circle is drawn at the blast's real (omen-scaled) radius,
        // so what you see is what hits.
        c.flash = 1;
        c.cue({
          type: "telegraph",
          at: { x: t.x, y: t.y, z: t.z },
          radius: WARDEN_SLAM_RADIUS * world.rules().explosionRadiusMult,
          color: WARDEN_COLOR,
          seconds: WARDEN.slamTelegraph,
        });
        break;
    }
  }
}

/** A kind's authority traits beyond the roster — where its loot lands, how
 * its health scales, how much a hit shoves it. The browser's views and the
 * headless FloorSim both build their cores from here. */
export function enemyOptions(id: string, kind: EnemyId, floor: number, position: Vec3, generation = 0): EnemyCoreOptions {
  const base = { id, kind, floor, position };
  switch (kind) {
    case "wisp":
    case "shadow":
      // Fliers can die skimming the floor: their drops never land below this.
      return { ...base, drops: { minY: 0.6 } };
    case "sentry":
      return { ...base, drops: { lift: 0.5 } };
    case "slime": {
      const gen = Math.min(Math.max(0, Math.floor(generation)), SLIME_MAX_GEN);
      // Every piece reports its death; the loot book only pays out on the
      // last generation, so the whole slime's loot lands once.
      return { ...base, generation: gen, healthScale: slimeGeneration(gen).hp, drops: { minY: 0.4 } };
    }
    case "boss":
      // The Warden leaves its hoard itself (WardenController) and shrugs off
      // most of a shove.
      return { ...base, knockbackScale: 0.25, flashDecay: 4 };
  }
}

/** A kind's contact burn — what touching it costs a wizard (before the
 * floor's damage scaling; its view adds the shove and the sparks). Judged
 * by the floor's authority on a server-hosted floor (sim/floorSim.ts), by
 * each wizard's own client otherwise (enemies/useEnemy.ts). */
export interface ContactSpec {
  /** Touch radius around the enemy's origin, to the wizard's centre. */
  range: number;
  damage: number;
  /** Seconds between burns on the same wizard. */
  cooldown: number;
  /** Measure to this height above the wizard's centre (the Warden aims at
   * the chest). */
  playerLift: number;
  /** Only once it's awake (the Warden sleeps harmlessly). */
  whenAwake: boolean;
}

export function contactOf(kind: EnemyId, generation = 0): ContactSpec | null {
  const base = { cooldown: PLAYER.contactDamageCooldown, playerLift: 0, whenAwake: false };
  switch (kind) {
    case "wisp":
      return { ...base, range: 1.45, damage: 9 };
    case "shadow":
      return { ...base, range: 1.5, damage: 12 };
    case "slime": {
      const cfg = slimeGeneration(generation);
      return { ...base, range: 0.5 * cfg.size + 0.8, damage: cfg.contact };
    }
    case "sentry":
      return null;
    case "boss":
      return { range: 2.3, damage: 16, cooldown: 0.9, playerLift: WARDEN.aimLift, whenAwake: true };
  }
}

/** The controller for a core's kind. */
export function createController(core: EnemyCore): EnemyController {
  switch (core.opts.kind) {
    case "wisp":
      return new WispController(core);
    case "shadow":
      return new ShadowController(core);
    case "slime":
      return new SlimeController(core, core.opts.generation ?? 0);
    case "sentry":
      return new SentryController(core);
    case "boss":
      return new WardenController(core);
  }
}

/** A whole enemy: its core over `body`, and its kind's controller. */
export function createEnemy(
  world: SimWorld,
  opts: EnemyCoreOptions,
  body: () => RigidBody | null,
): { core: EnemyCore; ctl: EnemyController } {
  const core = new EnemyCore(world, opts, body);
  return { core, ctl: createController(core) };
}
