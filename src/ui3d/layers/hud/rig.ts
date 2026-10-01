import { Euler, Quaternion, Vector3 } from "three";

/** The HUD is carried, not painted on the glass: everything held in front
 * of the eye (vitals, belt, gear, location, messages) hangs on one shared
 * rig that moves like something in your hands.
 *
 *  - Turning: the rig trails the view on a soft spring — it lags behind
 *    the turn, catches up, and settles with a small overshoot when you
 *    stop. The lag grows with the turn's speed but eases into a cap, so a
 *    flick never throws the HUD off screen and never hits a hard stop.
 *  - Walking: it swings in step with the view bob (one sway left and right
 *    per two steps, a dip on every footfall, a beat behind the head).
 *  - Strafing leans it against the motion; a hard landing drops it a
 *    little further than the eye and lets it bounce back.
 *
 * Pure and allocation-free: `stepRig` advances the state (unit-tested);
 * `rigQuaternion` turns it into the view-space rotation every HUD anchor
 * applies about the eye, so all pieces move as one sheet. Only yaw and
 * pitch — never roll, which would twist the pixel art off its grid. */

const DEG = Math.PI / 180;

export const RIG = {
  /** Seconds of turn the rig trails by (target lag = turn rate × this). */
  lagTime: 0.055,
  /** Soft cap on the turn lag, radians. */
  maxLag: 3 * DEG,
  /** Spring natural frequency, rad/s (~2.3 Hz), and damping ratio: under 1
   * for one soft overshoot when a turn stops. */
  omega: 14.5,
  zeta: 0.58,
  /** Walk bob amplitudes at a full run, radians. */
  bobPitch: 0.42 * DEG,
  bobYaw: 0.32 * DEG,
  /** How far the held HUD's step trails the head's, radians of stride. */
  bobLag: 0.7,
  /** Lean against sideways motion, radians per m/s (view space). */
  strafe: 0.07 * DEG,
  /** Extra drop on landing, radians per metre of the eye's landing dip. */
  landing: 7 * DEG,
} as const;

export interface RigState {
  /** Spring-driven lag, radians (yaw: + = rig left of view; pitch: + = up). */
  yaw: number;
  pitch: number;
  vyaw: number;
  vpitch: number;
  /** Low-passed turn rates, rad/s (camera frame). */
  wYaw: number;
  wPitch: number;
  /** Low-passed sideways speed, m/s (view space, + = right). */
  side: number;
  /** The final offsets after bob and lean, radians. */
  outYaw: number;
  outPitch: number;
}

export function makeRig(): RigState {
  return { yaw: 0, pitch: 0, vyaw: 0, vpitch: 0, wYaw: 0, wPitch: 0, side: 0, outYaw: 0, outPitch: 0 };
}

export interface RigInput {
  /** Camera turn rates in its own frame, rad/s (+yaw = turning left,
   * +pitch = looking up). */
  wYaw: number;
  wPitch: number;
  /** Sideways speed in view space, m/s. */
  side: number;
  /** playerGait: stride phase (rad), amplitude 0…~1.2, landing dip (m). */
  phase: number;
  amp: number;
  landDip: number;
}

/** Soft cap: linear near zero, easing into ±max. */
function soft(x: number, max: number): number {
  return max * Math.tanh(x / max);
}

/** Advance the rig by `dt` seconds. */
export function stepRig(s: RigState, input: RigInput, rawDt: number): void {
  const dt = Math.max(0, Math.min(rawDt, 0.1));
  // Mouse-look arrives in uneven steps: smooth the rates a little first.
  const k = 1 - Math.exp(-dt * 24);
  s.wYaw += (Math.max(-30, Math.min(30, input.wYaw)) - s.wYaw) * k;
  s.wPitch += (Math.max(-30, Math.min(30, input.wPitch)) - s.wPitch) * k;
  s.side += (input.side - s.side) * (1 - Math.exp(-dt * 6));

  // The rig keeps pointing where the view WAS: turning left (+yaw rate)
  // leaves it to the right of the view (−yaw), and so on.
  const tYaw = soft(-s.wYaw * RIG.lagTime, RIG.maxLag);
  const tPitch = soft(-s.wPitch * RIG.lagTime, RIG.maxLag);
  const w2 = RIG.omega * RIG.omega;
  const c = 2 * RIG.zeta * RIG.omega;
  let remaining = dt;
  while (remaining > 1e-6) {
    const h = Math.min(remaining, 1 / 240);
    remaining -= h;
    s.vyaw += (w2 * (tYaw - s.yaw) - c * s.vyaw) * h;
    s.vpitch += (w2 * (tPitch - s.pitch) - c * s.vpitch) * h;
    s.yaw += s.vyaw * h;
    s.pitch += s.vpitch * h;
  }

  // Walking: the head bobs twice per stride (PlayerController's sin 2φ);
  // the held rig follows a beat late, and sways once per stride.
  const amp = Math.min(1.2, Math.max(0, input.amp));
  const bobPitch = -Math.sin(input.phase * 2 - RIG.bobLag) * RIG.bobPitch * amp;
  const bobYaw = Math.sin(input.phase - RIG.bobLag * 0.5) * RIG.bobYaw * amp;
  const lean = soft(-s.side * RIG.strafe, 1.2 * DEG);
  const drop = -Math.max(0, input.landDip) * RIG.landing;
  s.outYaw = s.yaw + bobYaw + lean;
  s.outPitch = s.pitch + bobPitch + drop;
}

const euler = new Euler(0, 0, 0, "YXZ");

/** The rig's rotation relative to the view (apply as camera.q × this). */
export function rigQuaternion(s: RigState, out: Quaternion): Quaternion {
  euler.set(s.outPitch, s.outYaw, 0, "YXZ");
  return out.setFromEuler(euler);
}

// ── The shared rig ───────────────────────────────────────────────────────────

/** The one rig every HUD anchor hangs from, stepped once per UI frame by
 * `<HudRig>` (UiRoot) before the anchors read it. */
export const hudRig = { state: makeRig(), q: new Quaternion(), enabled: true };

const prevQ = new Quaternion();
const rel = new Quaternion();
const inv = new Quaternion();
const vel = new Vector3();
let primed = false;

/** Step the shared rig from the camera's motion and the player's gait. */
export function driveHudRig(
  cameraQ: Quaternion,
  playerVelocity: Vector3,
  gait: { phase: number; amp: number; landDip: number },
  dt: number,
): void {
  if (!primed || dt <= 0) {
    prevQ.copy(cameraQ);
    primed = true;
    return;
  }
  // Angular velocity in the camera's own frame: prev⁻¹ · current.
  rel.copy(prevQ).invert().multiply(cameraQ);
  if (rel.w < 0) rel.set(-rel.x, -rel.y, -rel.z, -rel.w);
  prevQ.copy(cameraQ);
  vel.copy(playerVelocity).applyQuaternion(inv.copy(cameraQ).invert());
  const input: RigInput = {
    wYaw: (rel.y * 2) / dt,
    wPitch: (rel.x * 2) / dt,
    side: vel.x,
    phase: gait.phase,
    amp: gait.amp,
    landDip: gait.landDip,
  };
  if (!hudRig.enabled) {
    input.wYaw = input.wPitch = input.side = input.amp = input.landDip = 0;
  }
  stepRig(hudRig.state, input, dt);
  rigQuaternion(hudRig.state, hudRig.q);
}
