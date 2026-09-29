import { blendFactor, blendVelocity, clamp, type ChaseInput, type Steering } from "./common";

/** Wisp brain — the plain chaser. Bobs in place until a wizard comes near (or
 * something shoots it), then homes in on the nearest wizard, hovering a little
 * above head height with a lazy vertical weave. Velocity is eased toward the
 * desired one rather than set outright, so knockback and collisions read as
 * momentum instead of snapping back instantly. */

export const WISP = {
  /** Wake radius, before the stealth multiplier. */
  aggroRange: 15,
  /** Chase speed at floor 1, and its per-floor growth. */
  speed: 4.3,
  speedPerFloor: 0.07,
  /** Idle bob: frequency (rad/s) and vertical speed amplitude. */
  idleBobFreq: 1.4,
  idleBobAmp: 0.5,
  /** Chase: hover this far above the target, weaving ± chaseBobAmp. */
  hover: 0.5,
  chaseBobFreq: 2.1,
  chaseBobAmp: 0.4,
  /** Vertical correction gain and its cap (m/s). */
  climbGain: 2.4,
  maxClimb: 3.5,
  /** Velocity easing rate (1/s). */
  steerRate: 2.8,
} as const;

export function wispSpeed(floor: number, speedMult: number): number {
  return (WISP.speed + floor * WISP.speedPerFloor) * speedMult;
}

/** One frame of wisp thinking. `phase` desynchronises the bobbing of
 * neighbouring wisps. Writes the decision into `out` and returns it. */
export function tickWisp(phase: number, i: ChaseInput, out: Steering): Steering {
  if (!i.aggro) {
    // Waking still spends this frame idling — the chase starts next frame.
    out.aggro = i.targetDist < WISP.aggroRange * i.aggroMult;
    out.vel.x = 0;
    out.vel.y = Math.sin(i.time * WISP.idleBobFreq + phase) * WISP.idleBobAmp;
    out.vel.z = 0;
    out.apply = true;
    return out;
  }
  out.aggro = true;
  if (i.knocked) {
    out.apply = false;
    return out;
  }

  // Planar heading toward the target. Within 10 cm it isn't normalised (the
  // tiny residual keeps it from jittering around a point directly below).
  let hx = i.target.x - i.pos.x;
  let hz = i.target.z - i.pos.z;
  const l2 = hx * hx + hz * hz;
  if (l2 > 0.01) {
    const l = Math.sqrt(l2);
    hx /= l;
    hz /= l;
  }
  const speed = wispSpeed(i.floor, i.speedMult);
  const targetY = i.target.y + WISP.hover + Math.sin(i.time * WISP.chaseBobFreq + phase) * WISP.chaseBobAmp;

  out.vel.x = hx * speed;
  out.vel.y = clamp((targetY - i.pos.y) * WISP.climbGain, -WISP.maxClimb, WISP.maxClimb);
  out.vel.z = hz * speed;
  blendVelocity(i.vel, out.vel, blendFactor(WISP.steerRate, i.dt), out.vel);
  out.apply = true;
  return out;
}
