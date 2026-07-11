/** Soft-sync steering: how a PREDICTED dynamic replica follows authority.
 *
 * Replicas are real dynamic bodies (so local shoves, blasts and the player
 * capsule act on them instantly — pure client feel). Each frame this module
 * decides how to reconcile the local body with the authoritative snapshot
 * stream:
 *
 *  - rest:  body and target agree and the target is still → leave the body
 *           alone so rapier can put it to sleep.
 *  - drive: set velocity = target velocity + error × gain (capped) — the
 *           body chases authority without ever teleporting mid-view.
 *  - snap:  the error exceeds the budget (spawn, teleport, long occlusion) →
 *           hard-set the pose.
 *
 * The gain is the leash tightness. It drops to `softGain` while the local
 * player is plausibly interacting with the body (recent predicted impulse or
 * standing next to it), so local physics wins the tug-of-war for the round
 * trip it takes authority to agree.
 *
 * Pure math — no physics or React imports — so the tuning is unit-testable. */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface QuatLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const STEER = {
  /** 1/s — how hard replicas chase authority normally. */
  gain: 10,
  /** 1/s — while the local player is plausibly interacting with the body. */
  softGain: 2.5,
  /** m/s cap on the correction term (excludes the target's own velocity). */
  maxCorrection: 10,
  /** Beyond this positional error we hard-snap instead of chasing. */
  snapDistance: 2.5,
  /** rad — beyond this rotational error we hard-snap the rotation. */
  snapAngle: 2.4,
  /** 1/s for rotational chasing. */
  rotGain: 8,
  /** 1/s — how fast the body's velocity BLENDS toward the steering's desired
   * velocity. Blending (instead of overwriting linvel) is what makes local
   * contact pushes feel continuous: the shove's velocity survives and decays
   * toward authority rather than being stomped every frame. */
  blendRate: 25,
  /** 1/s blend while interacting — local contact forces dominate for the
   * round trip it takes the authority to see the same push. */
  softBlendRate: 4,
  /** Body counts as settled within this of the target (m). */
  restPosEps: 0.05,
  /** …and the target itself is at most this fast (m/s). */
  restVelEps: 0.1,
  /** …and (when rotation is synced) quat dot is at least this. */
  restQuatDot: 0.9995,
  /** Radius around the local player that counts as "plausibly interacting". */
  interactRadius: 2.6,
} as const;

export type SteerCommand =
  | { kind: "rest" }
  | { kind: "snap" }
  | {
      kind: "drive";
      linvel: Vec3Like;
      /** Present when rotation is being steered. */
      angvel: Vec3Like | null;
    };

const drive: Extract<SteerCommand, { kind: "drive" }> = {
  kind: "drive",
  linvel: { x: 0, y: 0, z: 0 },
  angvel: null,
};
const angvelScratch: Vec3Like = { x: 0, y: 0, z: 0 };
const REST: SteerCommand = { kind: "rest" };
const SNAP: SteerCommand = { kind: "snap" };

export interface SteerProfile {
  /** Positional correction gain (1/s). */
  gain: number;
  /** Velocity blend rate (1/s) — how fast we approach the desired velocity.
   * Low = local physics wins short-term; high = authority tracks tightly. */
  blend: number;
}

export const HARD_PROFILE: SteerProfile = { gain: STEER.gain, blend: STEER.blendRate };
export const SOFT_PROFILE: SteerProfile = { gain: STEER.softGain, blend: STEER.softBlendRate };

/** Decide this frame's reconciliation. The drive velocity is a BLEND from the
 * body's current velocity toward (target velocity + error × gain), so local
 * contact forces are never stomped — pushing a replicated crate feels like
 * pushing a crate. NOTE: the returned drive command is shared scratch —
 * consume it before the next steer() call. */
export function steer(
  currentPos: Vec3Like,
  currentVel: Vec3Like,
  currentQuat: QuatLike | null,
  targetPos: Vec3Like,
  targetVel: Vec3Like,
  targetQuat: QuatLike | null,
  profile: SteerProfile,
  dt: number,
): SteerCommand {
  const ex = targetPos.x - currentPos.x;
  const ey = targetPos.y - currentPos.y;
  const ez = targetPos.z - currentPos.z;
  const errSq = ex * ex + ey * ey + ez * ez;

  if (errSq > STEER.snapDistance * STEER.snapDistance) return SNAP;

  let quatDot = 1;
  if (currentQuat && targetQuat) {
    quatDot = Math.abs(
      currentQuat.x * targetQuat.x +
        currentQuat.y * targetQuat.y +
        currentQuat.z * targetQuat.z +
        currentQuat.w * targetQuat.w,
    );
    // 2·acos(|dot|) = rotation error angle.
    if (quatDot < Math.cos(STEER.snapAngle / 2)) return SNAP;
  }

  const targetSpeedSq =
    targetVel.x * targetVel.x + targetVel.y * targetVel.y + targetVel.z * targetVel.z;
  const currentSpeedSq =
    currentVel.x * currentVel.x + currentVel.y * currentVel.y + currentVel.z * currentVel.z;
  if (
    errSq < STEER.restPosEps * STEER.restPosEps &&
    targetSpeedSq < STEER.restVelEps * STEER.restVelEps &&
    currentSpeedSq < STEER.restVelEps * STEER.restVelEps &&
    quatDot > STEER.restQuatDot
  ) {
    return REST;
  }

  // Correction velocity toward the target, capped so a big (but sub-snap)
  // error never turns into a rocket.
  let cx = ex * profile.gain;
  let cy = ey * profile.gain;
  let cz = ez * profile.gain;
  const cLen = Math.hypot(cx, cy, cz);
  if (cLen > STEER.maxCorrection) {
    const k = STEER.maxCorrection / cLen;
    cx *= k;
    cy *= k;
    cz *= k;
  }
  // Exponential approach from the body's own velocity toward the desired one
  // — never a hard overwrite, so a local shove keeps its momentum.
  const a = 1 - Math.exp(-profile.blend * dt);
  drive.linvel.x = currentVel.x + (targetVel.x + cx - currentVel.x) * a;
  drive.linvel.y = currentVel.y + (targetVel.y + cy - currentVel.y) * a;
  drive.linvel.z = currentVel.z + (targetVel.z + cz - currentVel.z) * a;

  drive.angvel = null;
  if (currentQuat && targetQuat) {
    drive.angvel = steerAngular(currentQuat, targetQuat, angvelScratch);
  }
  return drive;
}

/** Angular velocity that rotates `current` toward `target` at rotGain.
 * delta = target ⊗ current⁻¹; its axis·angle scaled by the gain. */
function steerAngular(current: QuatLike, target: QuatLike, out: Vec3Like): Vec3Like {
  // q_delta = target ⊗ conj(current), with conj(current) = (-x, -y, -z, w).
  const cx = -current.x;
  const cy = -current.y;
  const cz = -current.z;
  const cw = current.w;
  const dx = target.w * cx + target.x * cw + target.y * cz - target.z * cy;
  const dy = target.w * cy - target.x * cz + target.y * cw + target.z * cx;
  const dz = target.w * cz + target.x * cy - target.y * cx + target.z * cw;
  let dw = target.w * cw - target.x * cx - target.y * cy - target.z * cz;

  let sx = dx;
  let sy = dy;
  let sz = dz;
  if (dw < 0) {
    sx = -sx;
    sy = -sy;
    sz = -sz;
    dw = -dw;
  }
  const sinHalf = Math.hypot(sx, sy, sz);
  if (sinHalf < 1e-6) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return out;
  }
  const angle = 2 * Math.atan2(sinHalf, dw);
  const scale = (angle / sinHalf) * STEER.rotGain;
  out.x = sx * scale;
  out.y = sy * scale;
  out.z = sz * scale;
  return out;
}
