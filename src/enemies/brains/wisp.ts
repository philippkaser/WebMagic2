import { blendFactor, blendVelocity, clamp, desperate, type ChaseInput, type RandomSource, type Steering } from "./common";

/** Wisp brain — the plain chaser. Bobs in place until a wizard comes near (or
 * something shoots it), then homes in on the nearest wizard, hovering a little
 * above head height with a lazy vertical weave. Velocity is eased toward the
 * desired one rather than set outright, so knockback and collisions read as
 * momentum instead of snapping back instantly.
 *
 * At death's door (past the knee — it has visibly broken first) a wisp
 * fights for its life: it chases a little faster and darts sideways every
 * so often (a jink), so the finishing shot has to be earned. */

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
  /** Death's door: chase speed multiplier, and its jinks — a sideways dart
   * of `jinkSpeed` for `jinkTime`, every `jinkEvery` + random·`jinkSpread` s. */
  desperateSpeed: 1.15,
  jinkSpeed: 5,
  jinkTime: 0.18,
  jinkEvery: 0.6,
  jinkSpread: 0.4,
} as const;

/** A wisp's jink clock (only a desperate wisp runs it). */
export interface WispJink {
  /** Seconds until the next jink. */
  timer: number;
  /** Seconds left in the current one (> 0 while darting). */
  left: number;
  side: 1 | -1;
  rand: RandomSource;
}

export function createWispJink(rand: RandomSource = Math.random): WispJink {
  return { timer: WISP.jinkEvery * 0.5, left: 0, side: 1, rand };
}

export function wispSpeed(floor: number, speedMult: number): number {
  return (WISP.speed + floor * WISP.speedPerFloor) * speedMult;
}

/** One frame of wisp thinking. `phase` desynchronises the bobbing of
 * neighbouring wisps; `jink` (optional) is its death's-door dodge clock.
 * Writes the decision into `out` and returns it. */
export function tickWisp(phase: number, i: ChaseInput, out: Steering, jink?: WispJink): Steering {
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
  const cornered = desperate(i.vigor);
  const speed = wispSpeed(i.floor, i.speedMult) * (cornered ? WISP.desperateSpeed : 1);
  const targetY = i.target.y + WISP.hover + Math.sin(i.time * WISP.chaseBobFreq + phase) * WISP.chaseBobAmp;

  out.vel.x = hx * speed;
  out.vel.y = clamp((targetY - i.pos.y) * WISP.climbGain, -WISP.maxClimb, WISP.maxClimb);
  out.vel.z = hz * speed;
  blendVelocity(i.vel, out.vel, blendFactor(WISP.steerRate, i.dt), out.vel);
  if (cornered && jink) {
    jink.timer -= i.dt;
    if (jink.timer <= 0) {
      jink.timer = WISP.jinkEvery + jink.rand() * WISP.jinkSpread;
      jink.left = WISP.jinkTime;
      jink.side = jink.rand() < 0.5 ? 1 : -1;
    }
    if (jink.left > 0) {
      // Darting sideways, across its own line of chase — unblended, so it snaps.
      jink.left -= i.dt;
      const j = WISP.jinkSpeed * i.speedMult * jink.side;
      out.vel.x += -hz * j;
      out.vel.z += hx * j;
    }
  } else if (jink) {
    jink.left = 0;
  }
  out.apply = true;
  return out;
}
