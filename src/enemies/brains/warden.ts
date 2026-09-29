import { blendFactor, blendVelocity, type Move, type RandomSource, type Vec } from "./common";

/** Warden brain — the floor boss. Two independent halves run each frame:
 *
 *  - movement: hold a comfortable duelling band around the target — close in
 *    when far, back off when crowded, hover in between — bobbing around its
 *    spawn height. A charge suspends steering until it has played out.
 *  - attacks: a cooldown clock that, when up and a wizard is in range, picks
 *    an attack by distance (slams and rings up close, charges and volleys at
 *    range). A slam is telegraphed: it arms, and only detonates ("boom") once
 *    the wind-up has elapsed; nothing else fires in between.
 *
 * Below half health it is enraged: faster, shorter cooldowns, denser volleys
 * and rings. Dice come from an injected source so fights are testable. */

export type WardenAttack = "volley" | "ring" | "charge" | "slam";
/** What the component must do this frame: launch an attack, detonate an
 * armed slam, or nothing. */
export type WardenAction = WardenAttack | "boom" | null;

export const WARDEN = {
  /** Wakes (roars, raises its HP bar) when a wizard comes this close. */
  wakeRange: 13,
  /** Enraged below this fraction of max health. */
  enrageFrac: 0.5,
  /** Aim point sits this far above the wizard's pose (chest, not feet). */
  aimLift: 0.4,
  walkSpeed: 2.3,
  enragedWalkSpeed: 3.4,
  /** Duelling band: approach beyond, retreat (at a fraction of speed) within. */
  approachRange: 7.5,
  retreatRange: 4,
  retreatFactor: 0.55,
  hoverFreq: 1.3,
  hoverAmp: 0.5,
  climbGain: 2,
  steerRate: 2,
  /** Attack cadence and reach. */
  firstAttack: 2.5,
  cooldown: 2.6,
  enragedCooldown: 1.7,
  attackRange: 24,
  /** Distance bands for the attack picker. */
  closeRange: 4.5,
  farRange: 12,
  chargeSpeed: 13,
  chargeLift: 0.5,
  chargeTime: 0.7,
  slamTelegraph: 0.6,
  volleySpeed: 14,
  /** Seconds of target motion the volley aims ahead by. */
  volleyLead: 0.4,
  volleyCount: 4,
  enragedVolleyCount: 6,
  volleySpreadXZ: 0.16,
  volleySpreadY: 0.1,
  ringCount: 10,
  enragedRingCount: 14,
  ringSpeed: 9,
  ringLift: 0.4,
} as const;

export interface WardenBrain {
  /** Seconds until the next attack may be picked. */
  attackTimer: number;
  /** Seconds of charge left — steering is suspended while > 0. */
  charging: number;
  /** Seconds until an armed slam detonates (0 = none armed). */
  slamTelegraph: number;
  rand: RandomSource;
}

export function createWardenBrain(rand: RandomSource = Math.random): WardenBrain {
  return { attackTimer: WARDEN.firstAttack, charging: 0, slamTelegraph: 0, rand };
}

export function isEnraged(hp: number, maxHp: number): boolean {
  return hp < maxHp * WARDEN.enrageFrac;
}

/** Choose an attack for a target `dist` away. */
export function pickWardenAttack(dist: number, rand: RandomSource): WardenAttack {
  if (dist < WARDEN.closeRange) return rand() < 0.65 ? "slam" : "ring";
  if (dist > WARDEN.farRange) return rand() < 0.6 ? "charge" : "volley";
  const r = rand();
  return r < 0.45 ? "volley" : r < 0.75 ? "ring" : "charge";
}

export interface WardenMoveInput {
  pos: Vec;
  vel: Vec;
  /** Vector from the body to the (lifted) aim point; only its planar part steers. */
  aim: Vec;
  /** Distance to the target. */
  dist: number;
  /** Spawn height — the Warden hovers around it rather than chasing altitude. */
  homeY: number;
  time: number;
  dt: number;
  enraged: boolean;
  /** Floor-rule multiplier on movement (walk and charge). */
  speedMult: number;
}

export function createWardenMoveInput(): WardenMoveInput {
  return {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    aim: { x: 0, y: 0, z: 0 },
    dist: Infinity,
    homeY: 0,
    time: 0,
    dt: 0,
    enraged: false,
    speedMult: 1,
  };
}

/** Signed fraction of walk speed for the duelling band: +1 close in, −0.55
 * back off, 0 hold. */
export function wardenRangeFactor(dist: number): number {
  return dist > WARDEN.approachRange ? 1 : dist < WARDEN.retreatRange ? -WARDEN.retreatFactor : 0;
}

/** One frame of Warden movement. Mid-charge it only runs down the charge
 * clock and leaves the body to its launch velocity. */
export function tickWardenMove(b: WardenBrain, i: WardenMoveInput, out: Move): Move {
  if (b.charging > 0) {
    b.charging -= i.dt;
    out.apply = false;
    return out;
  }
  let hx = i.aim.x;
  let hz = i.aim.z;
  const l2 = hx * hx + hz * hz;
  if (l2 > 0.01) {
    const l = Math.sqrt(l2);
    hx /= l;
    hz /= l;
  }
  const speed = (i.enraged ? WARDEN.enragedWalkSpeed : WARDEN.walkSpeed) * i.speedMult;
  const k = speed * wardenRangeFactor(i.dist);
  out.vel.x = hx * k;
  out.vel.y = (i.homeY + Math.sin(i.time * WARDEN.hoverFreq) * WARDEN.hoverAmp - i.pos.y) * WARDEN.climbGain;
  out.vel.z = hz * k;
  blendVelocity(i.vel, out.vel, blendFactor(WARDEN.steerRate, i.dt), out.vel);
  out.apply = true;
  return out;
}

/** One frame of the attack clock. Returns what to launch (the component owns
 * the effects: announcing bolts/booms, flashes, shakes). Picking "charge" or
 * "slam" arms the matching brain timer here, so movement and the telegraph
 * pick it up on the following frames. */
export function tickWardenAttack(
  b: WardenBrain,
  dist: number,
  enraged: boolean,
  dt: number,
): WardenAction {
  if (b.slamTelegraph > 0) {
    b.slamTelegraph -= dt;
    return b.slamTelegraph <= 0 ? "boom" : null;
  }
  b.attackTimer -= dt;
  if (b.attackTimer > 0 || dist > WARDEN.attackRange) return null;
  b.attackTimer = enraged ? WARDEN.enragedCooldown : WARDEN.cooldown;
  const attack = pickWardenAttack(dist, b.rand);
  if (attack === "slam") b.slamTelegraph = WARDEN.slamTelegraph;
  else if (attack === "charge") b.charging = WARDEN.chargeTime;
  return attack;
}

/** Launch velocity for a charge along the planar aim. */
export function wardenChargeVelocity(aim: Vec, speedMult: number, out: Vec): Vec {
  const l = Math.hypot(aim.x, aim.z) || 1;
  const s = (WARDEN.chargeSpeed * speedMult) / l;
  out.x = aim.x * s;
  out.y = WARDEN.chargeLift;
  out.z = aim.z * s;
  return out;
}

export function wardenVolleyCount(enraged: boolean): number {
  return enraged ? WARDEN.enragedVolleyCount : WARDEN.volleyCount;
}

export function wardenRingCount(enraged: boolean): number {
  return enraged ? WARDEN.enragedRingCount : WARDEN.ringCount;
}

/** Unit direction for a volley: the aim point slid `volleyLead` seconds along
 * the target's motion (peer poses carry velocity, so every wizard is led). */
export function wardenVolleyAim(aim: Vec, dist: number, targetVel: Vec, out: Vec): Vec {
  const l = Math.hypot(aim.x, aim.y, aim.z) || 1;
  const x = (aim.x / l) * dist + targetVel.x * WARDEN.volleyLead;
  const y = (aim.y / l) * dist + targetVel.y * WARDEN.volleyLead;
  const z = (aim.z / l) * dist + targetVel.z * WARDEN.volleyLead;
  const n = Math.hypot(x, y, z) || 1;
  out.x = x / n;
  out.y = y / n;
  out.z = z / n;
  return out;
}

/** One volley bolt's velocity: the shared aim plus a little random spread. */
export function wardenVolleyBolt(dir: Vec, rand: RandomSource, out: Vec): Vec {
  out.x = (dir.x + (rand() - 0.5) * WARDEN.volleySpreadXZ) * WARDEN.volleySpeed;
  out.y = (dir.y + (rand() - 0.5) * WARDEN.volleySpreadY) * WARDEN.volleySpeed;
  out.z = (dir.z + (rand() - 0.5) * WARDEN.volleySpreadXZ) * WARDEN.volleySpeed;
  return out;
}

/** Bolt `index` of `count` in an evenly spaced, slightly rising ring. */
export function wardenRingBolt(index: number, count: number, out: Vec): Vec {
  const a = (index / count) * Math.PI * 2;
  out.x = Math.cos(a) * WARDEN.ringSpeed;
  out.y = WARDEN.ringLift;
  out.z = Math.sin(a) * WARDEN.ringSpeed;
  return out;
}
