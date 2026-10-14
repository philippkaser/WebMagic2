import { wrapAngle } from "./brains/common";
import type { EnemyId } from "./roster";

/** The puppet: what makes a creature look alive instead of a rigid ornament
 * on a physics ball. Every body's model sits on a view group inside its
 * RigidBody; the body's own rotations stay locked (physics never sees any
 * of this) and only the view moves — it breathes, turns to face its prey,
 * snaps away from a blow and wobbles back on a spring, coils before it
 * strikes, lists when it's dying.
 *
 * A puppet is seven underdamped springs — lean (x, z), offset (x, y, z),
 * squash and swell — that chase targets the caller sets each frame (a wound's
 * list, a wind-up's pull-back) and take kicks (a hit, a landing, a birth).
 * Squash preserves volume (sx = sz = 1/√sy), so a blob flattens instead of
 * shrinking.
 *
 * Pure numbers: no three.js, no clock of its own, allocation-free; the shell
 * (useEnemy) writes the pose onto the view group. Tested in puppet.test.ts. */

export interface PuppetTune {
  /** Spring stiffness (1/s²) and damping ratio (< 1 overshoots: jelly ≈ 0.2,
   * a stone thing ≈ 0.5). */
  k: number;
  zeta: number;
  /** Per unit of hit strength: view recoil (m), lean (rad), squash. */
  recoil: number;
  lean: number;
  squash: number;
  /** Breathing: vertical scale amplitude and rate (Hz). */
  breathe: number;
  hz: number;
  /** Turns its whole view toward its prey (the sentry's head tracks on its own). */
  faces: boolean;
  /** Turn rate (1/s). */
  turn: number;
}

/** Each kind's body: wisps snap, slimes wobble like jelly, the Warden barely flinches. */
export const PUPPET: Record<EnemyId, PuppetTune> = {
  wisp: { k: 260, zeta: 0.35, recoil: 0.2, lean: 0.55, squash: 0.28, breathe: 0.04, hz: 0.9, faces: true, turn: 6 },
  shadow: { k: 200, zeta: 0.4, recoil: 0.24, lean: 0.45, squash: 0.22, breathe: 0.06, hz: 0.45, faces: true, turn: 5 },
  slime: { k: 150, zeta: 0.17, recoil: 0.1, lean: 0.35, squash: 0.5, breathe: 0.05, hz: 1.1, faces: true, turn: 4 },
  sentry: { k: 420, zeta: 0.3, recoil: 0.04, lean: 0.16, squash: 0.12, breathe: 0.015, hz: 0.6, faces: false, turn: 0 },
  boss: { k: 110, zeta: 0.5, recoil: 0.07, lean: 0.14, squash: 0.08, breathe: 0.025, hz: 0.35, faces: true, turn: 1.6 },
};

// Spring slots.
export const RX = 0;
export const RZ = 1;
export const OX = 2;
export const OY = 3;
export const OZ = 4;
/** Squash: sy = 1 + sq. */
export const SQ = 5;
/** Swell: uniform scale = 1 + sc. */
export const SC = 6;
const N = 7;

export interface Puppet {
  tune: PuppetTune;
  /** Spring positions, velocities and targets, indexed by slot. */
  x: Float64Array;
  v: Float64Array;
  t: Float64Array;
  /** Facing (rad, world yaw; 0 = model +z faces world +z) and where it's turning. */
  yaw: number;
  yawTarget: number;
  /** Breathing phase offset (desyncs neighbours). */
  phase: number;
  /** Extra pose layered on at output, not sprung: a shiver's jitter (m). */
  jitter: number;
}

export function createPuppet(tune: PuppetTune, phase = 0): Puppet {
  return {
    tune,
    x: new Float64Array(N),
    v: new Float64Array(N),
    t: new Float64Array(N),
    yaw: 0,
    yawTarget: 0,
    phase,
    jitter: 0,
  };
}

/** Clear this frame's targets (callers re-add wounds, wind-ups, sags). */
export function clearTargets(p: Puppet): void {
  p.t.fill(0);
}

/** A blow pushing the body along (dirX, dirZ) (unit, planar) with strength
 * 0…1: the view snaps along it, its top tips the same way, and it squashes
 * — then the springs bring it back with one overshoot. */
export function kickHit(p: Puppet, dirX: number, dirZ: number, strength: number): void {
  const w = Math.sqrt(p.tune.k);
  const s = strength * w;
  // Tipping the top toward +x is a negative turn about z; toward +z a
  // positive turn about x.
  p.v[RX] += dirZ * p.tune.lean * s;
  p.v[RZ] -= dirX * p.tune.lean * s;
  p.v[OX] += dirX * p.tune.recoil * s;
  p.v[OZ] += dirZ * p.tune.recoil * s;
  p.v[SQ] -= p.tune.squash * s;
}

/** Squash (amount < 0) or stretch (> 0) the body in one beat. */
export function kickSquash(p: Puppet, amount: number): void {
  p.v[SQ] += amount * Math.sqrt(p.tune.k);
}

/** A jolt straight up (a startle, a hop of fright). */
export function kickHop(p: Puppet, height: number): void {
  p.v[OY] += height * Math.sqrt(p.tune.k);
}

/** Born small: start at `from` of full size and spring up through an
 * overshoot (a slime squeezing out of its parent's puddle). */
export function emerge(p: Puppet, from = 0.15): void {
  p.x[SC] = from - 1;
  p.v[SC] = 0;
}

/** Lean toward (angle > 0) or away from (< 0) the planar unit direction
 * (fx, fz), as a target — a wind-up's pull-back, a charge's lean in. */
export function leanToward(p: Puppet, fx: number, fz: number, angle: number): void {
  p.t[RX] += fz * angle;
  p.t[RZ] -= fx * angle;
}

/** Turn to face a world point from (x, z). */
export function faceToward(p: Puppet, fromX: number, fromZ: number, toX: number, toZ: number): void {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  if (dx * dx + dz * dz < 1e-4) return;
  p.yawTarget = Math.atan2(dx, dz);
}

/** Longest step the springs take at once (stays stable for any tune here). */
const MAX_SUB = 1 / 120;

/** Advance the springs by `dt` (seconds; 0 is a no-op, big frames are
 * sub-stepped) — semi-implicit Euler, stable and allocation-free. */
export function stepPuppet(p: Puppet, dt: number): void {
  if (!(dt > 0)) return;
  const { k, zeta, turn } = p.tune;
  const c = 2 * zeta * Math.sqrt(k);
  const steps = Math.min(8, Math.ceil(dt / MAX_SUB));
  const h = Math.min(dt, 1 / 15) / steps;
  for (let s = 0; s < steps; s++) {
    for (let i = 0; i < N; i++) {
      const a = -k * (p.x[i] - p.t[i]) - c * p.v[i];
      p.v[i] += a * h;
      p.x[i] += p.v[i] * h;
    }
  }
  // Never squash through itself or swell into a balloon, whatever kicks stack.
  if (p.x[SQ] < -0.7) p.x[SQ] = -0.7;
  if (p.x[SC] < -0.95) p.x[SC] = -0.95;
  if (turn > 0) {
    const d = wrapAngle(p.yawTarget - p.yaw);
    p.yaw = wrapAngle(p.yaw + d * Math.min(1, dt * turn));
  }
  p.phase += dt * p.tune.hz * Math.PI * 2;
  if (p.phase > Math.PI * 2) p.phase -= Math.PI * 2;
}

export interface PuppetPose {
  x: number;
  y: number;
  z: number;
  /** Lean about world x and z (rad), and facing yaw. */
  rx: number;
  rz: number;
  yaw: number;
  sx: number;
  sy: number;
  sz: number;
}

export function createPose(): PuppetPose {
  return { x: 0, y: 0, z: 0, rx: 0, rz: 0, yaw: 0, sx: 1, sy: 1, sz: 1 };
}

/** The pose to draw: springs plus breathing (`breath` scales it: a dying
 * thing breathes ragged and deep) and the shiver's jitter. */
export function puppetPose(p: Puppet, out: PuppetPose, breath = 1, rand: () => number = Math.random): PuppetPose {
  const j = p.jitter;
  out.x = p.x[OX] + (j > 0 ? (rand() - 0.5) * j : 0);
  out.y = p.x[OY];
  out.z = p.x[OZ] + (j > 0 ? (rand() - 0.5) * j : 0);
  out.rx = p.x[RX];
  out.rz = p.x[RZ];
  out.yaw = p.yaw;
  const sy = Math.max(0.3, (1 + p.x[SQ]) * (1 + Math.sin(p.phase) * p.tune.breathe * breath));
  const sxz = 1 / Math.sqrt(sy);
  const sc = 1 + p.x[SC];
  out.sx = sxz * sc;
  out.sy = sy * sc;
  out.sz = sxz * sc;
  return out;
}

/** Is it (nearly) at rest on its targets? */
export function settled(p: Puppet, eps = 0.01): boolean {
  for (let i = 0; i < N; i++) {
    if (Math.abs(p.x[i] - p.t[i]) > eps || Math.abs(p.v[i]) > eps * 10) return false;
  }
  return true;
}
