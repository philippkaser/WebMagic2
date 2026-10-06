/** Shared vocabulary for the enemy brains.
 *
 * Brains are the pure half of an enemy: given what the body senses this frame
 * (its own pose, the nearest wizard, the clock) they decide how it should
 * move and when it should attack. They never import three, Rapier or React —
 * inputs are plain {x,y,z} records (structurally satisfied by a three Vector3
 * or a Rapier translation()/linvel() result, so controllers pass those
 * straight in) — which keeps every state machine and every piece of steering math
 * unit-testable under `bun test` with no scene, no physics and no clock.
 *
 * Allocation rule: brains run every frame for every enemy, so they write into
 * caller-owned output objects instead of returning fresh ones. A controller
 * (sim/enemies/controllers.ts) allocates its input/output records once and
 * reuses them. */

export interface Vec {
  x: number;
  y: number;
  z: number;
}

/** A uniform [0, 1) source — Math.random in the game, a scripted sequence in
 * tests. Injected wherever a brain rolls dice so its choices are testable. */
export type RandomSource = () => number;

/** What a chasing enemy senses each frame. Shared by the wisp, shadow and
 * slime so a controller fills one record and hands it to its brain. */
export interface ChaseInput {
  /** The body's position and velocity this frame. */
  pos: Vec;
  vel: Vec;
  /** The nearest wizard on the floor (game/targets.ts) and its 3D distance. */
  target: Vec;
  targetDist: number;
  /** Seconds: the scene clock (drives bobbing) and this frame's delta. */
  time: number;
  dt: number;
  /** Already awake — latched by damage (the shell) or by a previous frame. */
  aggro: boolean;
  /** Stealth scaling of the wake radius (the local player's aggroMult). */
  aggroMult: number;
  /** Knockback is in flight — leave the body to physics this frame. */
  knocked: boolean;
  floor: number;
  /** Floor-rule multiplier on every movement speed (enemySpeedMult). */
  speedMult: number;
}

/** A brain's movement decision. `apply` false means "don't touch the body"
 * (coasting through knockback, lying still, mid-charge) — distinct from a
 * zero velocity, which would actively brake it. */
export interface Move {
  vel: Vec;
  apply: boolean;
}

/** A chaser's decision: the move plus the latched wake state, which the
 * controller stores back into its core (EnemyCore.steer). */
export interface Steering extends Move {
  aggro: boolean;
}

export function createChaseInput(): ChaseInput {
  return {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 0 },
    targetDist: Infinity,
    time: 0,
    dt: 0,
    aggro: false,
    aggroMult: 1,
    knocked: false,
    floor: 1,
    speedMult: 1,
  };
}

export function createSteering(): Steering {
  return { vel: { x: 0, y: 0, z: 0 }, apply: false, aggro: false };
}

export function createMove(): Move {
  return { vel: { x: 0, y: 0, z: 0 }, apply: false };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Fraction of the gap to close this frame for an exponential approach at
 * `rate` per second — frame-rate independent, so 30 fps and 144 fps clients
 * steer identically. */
export function blendFactor(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** out = v + (desired − v)·k. `out` may alias either input. */
export function blendVelocity(v: Vec, desired: Vec, k: number, out: Vec): Vec {
  out.x = v.x + (desired.x - v.x) * k;
  out.y = v.y + (desired.y - v.y) * k;
  out.z = v.z + (desired.z - v.z) * k;
  return out;
}

/** Unit vector from → to, written into `out`. A zero-length span yields the
 * zero vector (three's normalize() semantics) rather than NaNs. */
export function aimDir(from: Vec, to: Vec, out: Vec): Vec {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  out.x = dx / len;
  out.y = dy / len;
  out.z = dz / len;
  return out;
}

/** An angle folded into [−π, π] — the short way round, for turning toward a
 * heading without spinning a full circle across the ±π seam. */
export function wrapAngle(a: number): number {
  return a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
}

/** The idle → aggro latch: an enemy wakes once a wizard comes within range
 * and never falls back asleep. */
export function wakes(aggro: boolean, dist: number, range: number): boolean {
  return aggro || dist < range;
}
