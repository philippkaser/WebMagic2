import { clamp, type ChaseInput, type RandomSource, type Steering } from "./common";

/** Slime brain — the hopper. Unlike the fliers it lives on the floor with
 * gravity on: it sits still until woken, then bounds toward its prey in short
 * springs off the ground, steering its planar velocity directly (a blob has
 * no finesse to ease into).
 *
 * The per-generation table lives here too: each split makes a smaller,
 * faster, weaker slime, and the hop brain and the component both key off the
 * same row. */

/** Deepest split: a generation-2 slime dies for good instead of splitting. */
export const SLIME_MAX_GEN = 2;

export interface SlimeGeneration {
  /** Visual + collider scale (radius = 0.5 × size). */
  size: number;
  /** Planar hop speed at floor 1. */
  speed: number;
  /** Fraction of the roster's baseHealth. */
  hp: number;
  /** Contact damage at floor 1. */
  contact: number;
  /** Vertical launch speed of each hop. */
  hop: number;
}

export const SLIME_GENERATIONS: readonly SlimeGeneration[] = [
  { size: 1.0, speed: 3.2, hp: 1.0, contact: 12, hop: 5.4 },
  { size: 0.66, speed: 4.6, hp: 0.5, contact: 9, hop: 5.0 },
  { size: 0.44, speed: 6.2, hp: 0.3, contact: 6, hop: 4.6 },
];

export function slimeGeneration(generation: number): SlimeGeneration {
  return SLIME_GENERATIONS[clamp(Math.floor(generation), 0, SLIME_MAX_GEN)];
}

export const SLIME = {
  aggroRange: 14,
  speedPerFloor: 0.03,
  /** Seconds between hops: min + random·spread. */
  hopIntervalMin: 0.55,
  hopIntervalSpread: 0.4,
  /** Only spring off when (nearly) grounded — no double jumps mid-air. */
  groundedVy: 0.9,
  /** First hop within this many seconds of waking (desyncs a fresh split). */
  firstHopSpread: 0.6,
  /** Squash & stretch: vertical scale per m/s of vertical speed, and limits. */
  squashPerVy: 0.03,
  squashMin: 0.72,
  squashMax: 1.28,
} as const;

export interface SlimeBrain {
  gen: SlimeGeneration;
  hopTimer: number;
  rand: RandomSource;
}

export function createSlimeBrain(generation: number, rand: RandomSource = Math.random): SlimeBrain {
  return { gen: slimeGeneration(generation), hopTimer: rand() * SLIME.firstHopSpread, rand };
}

export function slimeSpeed(gen: SlimeGeneration, floor: number, speedMult: number): number {
  return (gen.speed + floor * SLIME.speedPerFloor) * speedMult;
}

/** One frame of slime thinking. Asleep or reeling it leaves the body alone
 * (gravity and friction settle it); awake it drives the planar velocity at
 * the target and, when the hop timer is up and it's on the ground, springs. */
export function tickSlime(b: SlimeBrain, i: ChaseInput, out: Steering): Steering {
  if (!i.aggro) {
    out.aggro = i.targetDist < SLIME.aggroRange * i.aggroMult;
    out.apply = false;
    return out;
  }
  out.aggro = true;
  if (i.knocked) {
    out.apply = false;
    return out;
  }

  const tx = i.target.x - i.pos.x;
  const tz = i.target.z - i.pos.z;
  const planar = Math.hypot(tx, tz) || 1;
  const speed = slimeSpeed(b.gen, i.floor, i.speedMult);
  let vy = i.vel.y;
  b.hopTimer -= i.dt;
  if (b.hopTimer <= 0 && Math.abs(i.vel.y) < SLIME.groundedVy) {
    b.hopTimer = SLIME.hopIntervalMin + b.rand() * SLIME.hopIntervalSpread;
    vy = b.gen.hop; // a spring off the floor
  }
  out.vel.x = (tx / planar) * speed;
  out.vel.y = vy;
  out.vel.z = (tz / planar) * speed;
  out.apply = true;
  return out;
}

/** Squash & stretch from vertical motion — reads as a bouncing blob. Returns
 * the vertical scale factor; the horizontal factor is 1/√sy so the blob keeps
 * (roughly) its volume. */
export function slimeSquash(vy: number): number {
  return clamp(1 + vy * SLIME.squashPerVy, SLIME.squashMin, SLIME.squashMax);
}
