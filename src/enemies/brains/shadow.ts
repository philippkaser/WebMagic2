import {
  blendFactor,
  blendVelocity,
  clamp,
  type ChaseInput,
  type RandomSource,
  type Steering,
} from "./common";

/** Shadow brain — the lurker. Where the wisp charges straight in, the shadow
 * plays keep-away: it prowls a ring around its target (stalk), and once its
 * patience runs out AND the target is close enough it darts in (lunge), then
 * shrinks back into the dark (recoil) before prowling again.
 *
 *   stalk ──(lungeTimer ≤ 0 and dist < lungeRange)──▶ lunge
 *     ▲                                                 │ lungeTime
 *     └────────── recoilTime ◀──────── recoil ◀─────────┘
 */

export type ShadowMode = "stalk" | "lunge" | "recoil";

export const SHADOW = {
  aggroRange: 15,
  /** Radius of the prowling ring. */
  lurkRadius: 6,
  /** Only lunge at targets closer than this (a lunge from afar just whiffs). */
  lungeRange: 10,
  stalkSpeed: 2.4,
  stalkSpeedPerFloor: 0.03,
  /** Weight of the tangential (orbit) term against the radial (ring) term. */
  orbitWeight: 0.7,
  lungeSpeed: 11,
  lungeSpeedPerFloor: 0.12,
  lungeTime: 0.55,
  recoilSpeed: 6,
  recoilTime: 0.45,
  /** Stalk time before a lunge is allowed: min + random·spread seconds. */
  patienceMin: 2,
  patienceSpread: 2,
  idleBobFreq: 1.2,
  idleBobAmp: 0.4,
  hover: 0.3,
  bobFreq: 1.8,
  bobAmp: 0.3,
  climbGain: 2,
  maxClimb: 3,
  /** Velocity easing rate (1/s) — snappier while lunging. */
  steerRate: 3,
  lungeSteerRate: 6,
} as const;

export interface ShadowBrain {
  mode: ShadowMode;
  /** Time left in the current lunge/recoil. */
  modeTimer: number;
  /** Stalk time left before a lunge is allowed. */
  lungeTimer: number;
  /** Fixed orbit direction, so a given shadow prowls one way, not jittering. */
  spin: 1 | -1;
  /** Desynchronises the bobbing of neighbouring shadows. */
  phase: number;
  rand: RandomSource;
}

export function createShadowBrain(rand: RandomSource = Math.random): ShadowBrain {
  return {
    mode: "stalk",
    modeTimer: 0,
    lungeTimer: patience(rand),
    spin: rand() < 0.5 ? 1 : -1,
    phase: rand() * Math.PI * 2,
    rand,
  };
}

function patience(rand: RandomSource): number {
  return SHADOW.patienceMin + rand() * SHADOW.patienceSpread;
}

/** One frame of shadow thinking: advances the lurk state machine and writes
 * the resulting velocity decision into `out`. Timers only run while awake and
 * not reeling from knockback — a shot shadow loses its rhythm. */
export function tickShadow(b: ShadowBrain, i: ChaseInput, out: Steering): Steering {
  if (!i.aggro) {
    out.aggro = i.targetDist < SHADOW.aggroRange * i.aggroMult;
    out.vel.x = 0;
    out.vel.y = Math.sin(i.time * SHADOW.idleBobFreq + b.phase) * SHADOW.idleBobAmp;
    out.vel.z = 0;
    out.apply = true;
    return out;
  }
  out.aggro = true;
  if (i.knocked) {
    out.apply = false;
    return out;
  }

  // Planar unit vector toward the target, plus its perpendicular (for orbit).
  const px = i.target.x - i.pos.x;
  const pz = i.target.z - i.pos.z;
  const planar = Math.hypot(px, pz) || 1;
  const nx = px / planar;
  const nz = pz / planar;
  const targetY = i.target.y + SHADOW.hover + Math.sin(i.time * SHADOW.bobFreq + b.phase) * SHADOW.bobAmp;
  const climb = clamp((targetY - i.pos.y) * SHADOW.climbGain, -SHADOW.maxClimb, SHADOW.maxClimb);
  const d = out.vel;

  b.modeTimer -= i.dt;
  if (b.mode === "stalk") {
    b.lungeTimer -= i.dt;
    // Radial term closes/opens toward the lurk ring; tangential term prowls
    // around it. The radial pull is clamped so it eases onto the ring.
    const radial = clamp((i.targetDist - SHADOW.lurkRadius) * 0.5, -1, 1);
    const w = b.spin * SHADOW.orbitWeight;
    d.x = nx * radial - nz * w;
    d.z = nz * radial + nx * w;
    const l2 = d.x * d.x + d.z * d.z;
    if (l2 > 1e-4) {
      const s = stalkSpeed(i.floor, i.speedMult) / Math.sqrt(l2);
      d.x *= s;
      d.z *= s;
    }
    d.y = climb;
    if (b.lungeTimer <= 0 && i.targetDist < SHADOW.lungeRange) {
      b.mode = "lunge";
      b.modeTimer = SHADOW.lungeTime;
    }
  } else if (b.mode === "lunge") {
    const speed = lungeSpeed(i.floor, i.speedMult);
    d.x = nx * speed;
    d.y = climb;
    d.z = nz * speed;
    if (b.modeTimer <= 0) {
      b.mode = "recoil";
      b.modeTimer = SHADOW.recoilTime;
    }
  } else {
    // Recoil — shrink back into the dark before prowling again.
    const speed = SHADOW.recoilSpeed * i.speedMult;
    d.x = -nx * speed;
    d.y = 0;
    d.z = -nz * speed;
    if (b.modeTimer <= 0) {
      b.mode = "stalk";
      b.lungeTimer = patience(b.rand);
    }
  }

  const rate = b.mode === "lunge" ? SHADOW.lungeSteerRate : SHADOW.steerRate;
  blendVelocity(i.vel, d, blendFactor(rate, i.dt), d);
  out.apply = true;
  return out;
}

export function stalkSpeed(floor: number, speedMult: number): number {
  return (SHADOW.stalkSpeed + floor * SHADOW.stalkSpeedPerFloor) * speedMult;
}

export function lungeSpeed(floor: number, speedMult: number): number {
  return (SHADOW.lungeSpeed + floor * SHADOW.lungeSpeedPerFloor) * speedMult;
}
