import type { RapierRigidBody } from "@react-three/rapier";
import { GRAVITY } from "../../core/config";

/** Small reusable movement helpers for host-side enemy brains. Everything
 * works on plain numbers so the per-frame paths allocate nothing. */

/** Ease the body's horizontal velocity toward (vx, vz). Vertical velocity is
 * left to gravity (walkers) unless `vy` is given (fliers). */
export function steer(
  b: RapierRigidBody,
  vx: number,
  vz: number,
  rate: number,
  dt: number,
  vy?: number,
): void {
  const v = b.linvel();
  const k = 1 - Math.exp(-rate * dt);
  b.setLinvel(
    {
      x: v.x + (vx - v.x) * k,
      y: vy === undefined ? v.y : v.y + (vy - v.y) * k,
      z: v.z + (vz - v.z) * k,
    },
    true,
  );
}

/** Wrap an angle into (-π, π]. */
export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Turn `from` toward `to` by at most `maxStep` radians. */
export function turnToward(from: number, to: number, maxStep: number): number {
  const d = wrapAngle(to - from);
  return from + Math.max(-maxStep, Math.min(maxStep, d));
}

/** Launch velocity that carries a body from `from` to `to` in `time` seconds
 * under `gravityScale` × world gravity. Written into `out`. */
export function ballistic(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  time: number,
  gravityScale: number,
  out: [number, number, number],
): [number, number, number] {
  const g = GRAVITY * gravityScale;
  out[0] = (to.x - from.x) / time;
  out[1] = (to.y - from.y) / time - 0.5 * g * time;
  out[2] = (to.z - from.z) / time;
  return out;
}

/** Velocity estimated from position deltas — lets replicas (whose kinematic
 * bodies report no velocity) animate gaits and facing like the host does. */
export class MotionTracker {
  vx = 0;
  vy = 0;
  vz = 0;
  speed = 0;
  private px = NaN;
  private py = 0;
  private pz = 0;

  update(x: number, y: number, z: number, dt: number): void {
    if (Number.isNaN(this.px) || dt <= 0) {
      this.px = x;
      this.py = y;
      this.pz = z;
      return;
    }
    const k = Math.min(1, dt * 10);
    this.vx += ((x - this.px) / dt - this.vx) * k;
    this.vy += ((y - this.py) / dt - this.vy) * k;
    this.vz += ((z - this.pz) / dt - this.vz) * k;
    this.px = x;
    this.py = y;
    this.pz = z;
    this.speed = Math.hypot(this.vx, this.vz);
  }
}
