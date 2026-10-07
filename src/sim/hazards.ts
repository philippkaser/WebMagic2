import type RAPIER from "@dimforge/rapier3d-compat";
import { floorScale, GROUPS, PLAYER } from "../core/config";
import type { Vec } from "../enemies/brains/common";
import { getTrapDef } from "../world/trapCatalog";
import type { Vec3 } from "../world/types";
import { interactionGroups } from "./bodies";
import { BOLT_LIFETIME_S } from "./spells";
import { sweepBallCapsule, type Capsule } from "./sweep";
import type { CastData } from "./world";

/** The dungeon's harm to wizards, as a floor's authority judges it on a
 * floor the server hosts — where a wizard's own client no longer decides
 * what hurt them (their health is the server's there):
 *
 *  - HostileBolts: every enemy and trap bolt (a sentry's shot, the
 *    Warden's volleys and rings, a dart), flown here as each client flies
 *    its copy, bursting on walls, props and wizards;
 *  - SpikeTraps: the floor plates that stab whoever steps on them.
 *
 * Contact burns and the blasts (the Warden's slam, barrels, bolt bursts)
 * are judged by FloorSim itself. Pure TypeScript over Rapier; the shared
 * numbers are the browser's (projectiles.tsx, world/traps.tsx). */

/** A wizard as the dungeon meets them: the player's capsule, now. */
export interface WizardAt {
  id: string;
  pos: Vec;
}

export type HarmCause = "enemy" | "world";

interface Bolt {
  pos: Vec;
  vel: Vec;
  size: number;
  damage: number;
  blastRadius: number;
  blastImpulse: number;
  cause: HarmCause;
  age: number;
}

/** Enemy bolts fly into walls, wizards and props — never enemies (as on the
 * clients: allegiance.ts PROJECTILE_GROUPS.dungeon). Wizards are met as
 * capsules (they aren't bodies the world knows). */
const BOLT_FILTER = interactionGroups(GROUPS.ENEMY_PROJECTILE, [GROUPS.WORLD, GROUPS.PROP]);

export class HostileBolts {
  private bolts: Bolt[] = [];
  private readonly shapes = new Map<number, RAPIER.Ball>();
  private readonly noRotation = { x: 0, y: 0, z: 0, w: 1 };
  private readonly move: Vec = { x: 0, y: 0, z: 0 };
  private readonly capsule: Capsule = { center: { x: 0, y: 0, z: 0 }, halfHeight: PLAYER.halfHeight, radius: PLAYER.radius };

  constructor(
    private readonly R: typeof RAPIER,
    private readonly world: RAPIER.World,
    /** A bolt bursts: its blast is the floor's to judge. */
    private readonly burst: (at: Vec, radius: number, damage: number, impulse: number, cause: HarmCause) => void,
  ) {}

  get live(): number {
    return this.bolts.length;
  }

  fire(d: CastData): void {
    this.bolts.push({
      pos: { x: d.origin[0], y: d.origin[1], z: d.origin[2] },
      vel: { x: d.velocity[0], y: d.velocity[1], z: d.velocity[2] },
      size: d.size,
      damage: d.damage,
      blastRadius: d.blastRadius,
      blastImpulse: d.blastImpulse,
      cause: d.source === "world" ? "world" : "enemy",
      age: 0,
    });
  }

  step(dt: number, wizards: readonly WizardAt[]): void {
    this.bolts = this.bolts.filter((b) => this.fly(b, dt, wizards));
  }

  private fly(b: Bolt, dt: number, wizards: readonly WizardAt[]): boolean {
    b.age += dt;
    if (b.age >= BOLT_LIFETIME_S) {
      this.pop(b);
      return false;
    }
    const wall = this.world.castShape(b.pos, this.noRotation, b.vel, this.ball(b.size), 0, dt, true, undefined, BOLT_FILTER);
    let toi = wall ? wall.time_of_impact : dt;
    const move = this.move;
    move.x = b.vel.x * dt;
    move.y = b.vel.y * dt;
    move.z = b.vel.z * dt;
    for (const w of wizards) {
      this.capsule.center = w.pos;
      const f = sweepBallCapsule(b.pos, move, b.size, this.capsule);
      if (f !== null && f * dt < toi) toi = f * dt;
    }
    b.pos.x += b.vel.x * toi;
    b.pos.y += b.vel.y * toi;
    b.pos.z += b.vel.z * toi;
    if (toi >= dt && !wall) return true;
    this.pop(b);
    return false;
  }

  private pop(b: Bolt): void {
    this.burst(b.pos, b.blastRadius, b.damage, b.blastImpulse, b.cause);
  }

  private ball(radius: number): RAPIER.Ball {
    let shape = this.shapes.get(radius);
    if (!shape) {
      shape = new this.R.Ball(radius);
      this.shapes.set(radius, shape);
    }
    return shape;
  }
}

/** How far above or below a spike plate a wizard's centre may be and still
 * be standing on it (world/traps.tsx). */
const SPIKE_REACH_Y = 1.7;
/** A sprung plate re-arms after this long — per wizard, as each wizard's
 * own client times it. */
const SPIKE_REARM_S = 1.2;

export class SpikeTraps {
  private readonly plates: Vec3[];
  private readonly radiusSq: number;
  private readonly damage: number;
  /** "plate|wizard" → seconds until it can stab them again. */
  private readonly armed = new Map<string, number>();

  constructor(traps: readonly { kind: string; pos: Vec3 }[], floor: number) {
    const def = getTrapDef("spike");
    this.plates = traps.filter((t) => t.kind === "spike").map((t) => t.pos);
    this.radiusSq = def.radius * def.radius;
    this.damage = def.baseDamage * floorScale(floor).enemyDamage;
  }

  /** One step: who stepped on a plate that's armed for them. */
  step(dt: number, wizards: readonly WizardAt[], hurt: (wizard: string, damage: number) => void): void {
    for (const [key, left] of this.armed) {
      if (left - dt <= 0) this.armed.delete(key);
      else this.armed.set(key, left - dt);
    }
    this.plates.forEach((p, i) => {
      for (const w of wizards) {
        const dx = w.pos.x - p[0];
        const dz = w.pos.z - p[2];
        if (dx * dx + dz * dz >= this.radiusSq || Math.abs(w.pos.y - p[1]) >= SPIKE_REACH_Y) continue;
        const key = `${i}|${w.id}`;
        if (this.armed.has(key)) continue;
        this.armed.set(key, SPIKE_REARM_S);
        hurt(w.id, this.damage);
      }
    });
  }
}
