import type { RigidBody } from "@dimforge/rapier3d-compat";
import { floorScale } from "../../core/config";
import type { ChaseInput, Steering, Vec } from "../../enemies/brains/common";
import { getEnemyStats, type EnemyId } from "../../enemies/roster";
import type { Vec3 } from "../../world/types";
import type { SimCue, SimWorld } from "../world";

/** One enemy's authority state — everything it is that isn't its brain or
 * its looks: health from the roster and the floor, the hit flash, the wake
 * latch, the knockback timer, and a death that reports its loot.
 *
 * Plain TypeScript over a Rapier body (src/sim/world.ts): the browser's
 * enemy views (enemies/useEnemy.ts) and the headless FloorSim drive the very
 * same core, so a floor run on a server fights exactly like one run in a
 * host's browser. */

export interface EnemyCoreOptions {
  id: string;
  kind: EnemyId;
  floor: number;
  /** Where it spawned — where a death with no body left is placed. */
  position: Vec3;
  /** Multiplier on the roster's baseHealth (slime generations). */
  healthScale?: number;
  /** A slime's split generation (what its loot report says it was). */
  generation?: number;
  /** Fraction of knockback impulses that actually applies (bosses resist). */
  knockbackScale?: number;
  /** How fast the hit flash fades (per second). */
  flashDecay?: number;
  /** Report its death to the loot book, from here (`lift` above the body,
   * never below `minY`). The Warden leaves its hoard itself. */
  drops?: { lift?: number; minY?: number };
}

/** Seconds a hit leaves the body to physics (brains don't steer it). */
export const KNOCK_SECONDS = 0.4;

const ZERO: Readonly<Vec> = Object.freeze({ x: 0, y: 0, z: 0 });

/** Damage an enemy deals at `floor`: depth scaling × the floor's rule. */
export function enemyDamage(base: number, floor: number, damageMult: number): number {
  return base * floorScale(floor).enemyDamage * damageMult;
}

export class EnemyCore {
  readonly maxHp: number;
  hp: number;
  dead = false;
  /** Woken — by damage from anyone, or by its brain seeing a wizard. */
  aggro = false;
  /** Knockback in flight (> 0) — brains leave the body to physics. */
  knockTimer = 0;
  /** Hit flash, 1 on a hit and fading to 0 — a view drives an emissive with it. */
  flash = 0;

  /** The view's hooks (none headless). Health changed — applied here, or
   * replicated. */
  onHp: ((hp: number, maxHp: number) => void) | null = null;
  /** It died, on any machine; `silent` = a late joiner catching up. */
  onDeath: ((at: Vec, silent: boolean) => void) | null = null;
  /** Something only worth showing (see SimCue). */
  onCue: ((cue: SimCue) => void) | null = null;
  /** The kind's own part of a death it decided (a slime splits). Authority only. */
  onSlain: ((at: Vec) => void) | null = null;

  constructor(
    readonly world: SimWorld,
    readonly opts: EnemyCoreOptions,
    /** Its body, while it has one (a view's ref, a headless world's body). */
    readonly body: () => RigidBody | null,
  ) {
    this.maxHp =
      getEnemyStats(opts.kind).baseHealth *
      (opts.healthScale ?? 1) *
      floorScale(opts.floor).enemyHealth *
      world.rules().enemyHealthMult;
    this.hp = this.maxHp;
  }

  get id(): string {
    return this.opts.id;
  }

  /** Damage this enemy deals for a base amount (contact, bolts, slams). */
  damage(base: number): number {
    return enemyDamage(base, this.opts.floor, this.world.rules().enemyDamageMult);
  }

  /** Authority: a hit landed (the caller sanitized anything from the wire).
   * It flashes, staggers, wakes, and dies at zero. */
  hit(damage: number, impulse: Vec): void {
    if (this.dead) return;
    this.hp -= damage;
    this.flash = 1;
    this.knockTimer = KNOCK_SECONDS;
    const k = this.opts.knockbackScale ?? 1;
    this.body()?.applyImpulse({ x: impulse.x * k, y: impulse.y * k, z: impulse.z * k }, true);
    this.onHp?.(this.hp, this.maxHp);
    this.aggro = true;
    if (this.hp <= 0) this.die(false, true);
  }

  /** Replica: the authority's health arrived. */
  syncHp(hp: number): void {
    this.hp = hp;
    if (!this.dead) this.onHp?.(hp, this.maxHp);
  }

  /** Replica or late joiner: the authority says it died. */
  despawned(silent: boolean): void {
    this.die(silent, false);
  }

  /** Per-frame preamble: the body when this enemy should act this frame
   * (mounted, alive, the floor live), else null. Fades the hit flash and runs
   * down the knockback timer. */
  beginFrame(dt: number, live = true): RigidBody | null {
    const b = this.body();
    if (!b || this.dead || !live) return null;
    this.flash = Math.max(0, this.flash - dt * (this.opts.flashDecay ?? 5));
    this.knockTimer -= dt;
    return b;
  }

  /** Fill a chase brain's senses: body pose, nearest wizard, clock, wake and
   * knock state, the floor's speed rule. `vel` defaults to a read of the
   * body's velocity, made only when an awake, unstaggered brain will steer
   * with it (it's a physics-engine round trip). */
  sense(input: ChaseInput, b: RigidBody, pos: Vec, time: number, dt: number, vel?: Vec): ChaseInput {
    const target = this.world.nearestWizard(pos.x, pos.y, pos.z);
    const awake = this.aggro;
    const knocked = this.knockTimer > 0;
    input.pos = pos;
    input.vel = vel ?? (awake && !knocked ? b.linvel() : ZERO);
    input.target = target.pos; // shared scratch — valid until the next query
    input.targetDist = target.dist;
    input.time = time;
    input.dt = dt;
    input.aggro = awake;
    // Only a sleeping enemy needs the stealth factor.
    input.aggroMult = awake ? 1 : this.world.aggroMult();
    input.knocked = knocked;
    input.floor = this.opts.floor;
    input.speedMult = this.world.rules().enemySpeedMult;
    return input;
  }

  /** Apply a chase brain's decision: latch its wake state, set its velocity. */
  steer(b: RigidBody, s: Steering): void {
    this.aggro = s.aggro;
    if (s.apply) b.setLinvel(s.vel, true);
  }

  cue(cue: SimCue): void {
    this.onCue?.(cue);
  }

  /** What replicates beside the pose. */
  fields(): Record<string, number> {
    return { hp: this.hp };
  }

  private die(silent: boolean, authority: boolean): void {
    if (this.dead) return;
    this.dead = true;
    const o = this.opts;
    const t = this.body()?.translation() ?? { x: o.position[0], y: o.position[1], z: o.position[2] };
    const at: Vec = { x: t.x, y: t.y, z: t.z };
    if (authority) {
      this.world.act({ type: "died", id: o.id });
      if (o.drops && o.kind !== "boss") {
        const y = Math.max(at.y + (o.drops.lift ?? 0), o.drops.minY ?? -Infinity);
        this.world.act({
          type: "loot",
          id: o.id,
          source: { kind: "enemy", enemy: o.kind, gen: o.generation ?? 0 },
          at: [at.x, y, at.z],
        });
      }
      this.onSlain?.(at);
    }
    this.onDeath?.(at, silent);
  }
}
