/** How a hit reads on a body — pure numbers, no three.js, no clock of its
 * own (callers pass seconds). The shell (useEnemy) turns these into a white
 * frame, a flinch, sparks and a yelp; tested in hitFx.test.ts.
 *
 * Three jobs:
 *  - weight: how hard a blow lands relative to the creature (a rail through
 *    a wisp is everything; a beam tick on the Warden is a pinprick);
 *  - the gate: a Prism Ray ticks a dozen times a second, so sparks and
 *    voices pop at most once per GATE_S per body, and the damage nobody saw
 *    yet rides along into the next pop (so a beam's spray still grows with
 *    what it's doing);
 *  - the stagger budget: a bolt still knocks a creature off its stride, but
 *    a stream of chip damage can't hold it there forever. */

/** Seconds between cosmetic pops (sparks, voice) on one body. */
export const GATE_S = 0.07;

/** Strength of a blow, 0.12…1: how far the body flinches. */
export function hitStrength(damage: number, maxHp: number): number {
  const s = maxHp > 0 ? (damage / maxHp) * 2.5 : 1;
  return s < 0.12 ? 0.12 : s > 1 ? 1 : s;
}

/** Hit weight tiers: a chip (< 4% of life), a solid hit, a heavy one (≥ 25%). */
export type HitTier = 0 | 1 | 2;

export function hitTier(damage: number, maxHp: number): HitTier {
  const f = maxHp > 0 ? damage / maxHp : 1;
  return f >= 0.25 ? 2 : f >= 0.04 ? 1 : 0;
}

/** Size of a spark spray for this much damage (0.6 for a scratch, 2 for a
 * creature's whole life). */
export function sparkScale(damage: number, maxHp: number): number {
  const f = maxHp > 0 ? Math.min(1, Math.max(0, damage / maxHp)) : 1;
  return 0.6 + 1.4 * Math.sqrt(f);
}

export interface HitGate {
  /** Seconds (caller's clock) of the last pop. */
  last: number;
  /** Damage landed since the last pop, not yet shown. */
  pending: number;
}

export function createHitGate(): HitGate {
  return { last: -Infinity, pending: 0 };
}

/** A blow of `damage` lands at `now`: returns the damage to show NOW (this
 * one plus any carried over), or 0 if the body popped too recently — in
 * which case it's carried into the next pop. */
export function passGate(g: HitGate, damage: number, now: number, interval = GATE_S): number {
  g.pending += damage;
  if (now - g.last < interval) return 0;
  g.last = now;
  const shown = g.pending;
  g.pending = 0;
  return shown;
}

// ── Stagger ─────────────────────────────────────────────────────────────────

export const STAGGER = {
  /** The longest a single blow knocks a creature off its stride (s). */
  max: 0.4,
  /** Seconds of stagger a body can bank, and how fast it banks them back. */
  bank: 0.6,
  refill: 0.35,
  /** Less than this isn't worth breaking stride for. */
  min: 0.05,
} as const;

export interface StaggerBudget {
  banked: number;
  /** Seconds (caller's clock) when `banked` was last brought up to date. */
  at: number;
}

export function createStagger(): StaggerBudget {
  return { banked: STAGGER.bank, at: 0 };
}

/** Knockback seconds a blow of `damage` earns at `now`, spent from the
 * budget: a heavy bolt earns the full STAGGER.max, a beam tick a sliver
 * (strength²), and once the bank is dry chip damage earns nothing. */
export function staggerFor(s: StaggerBudget, damage: number, maxHp: number, now: number): number {
  const dt = Math.max(0, now - s.at);
  s.at = now;
  s.banked = Math.min(STAGGER.bank, s.banked + dt * STAGGER.refill);
  const st = maxHp > 0 ? Math.min(1, (damage / maxHp) * 2.5) : 1;
  const want = STAGGER.max * st * st;
  const given = Math.min(want, s.banked);
  if (given < STAGGER.min) return 0;
  s.banked -= given;
  return given;
}

// ── The blow's direction on the wire ────────────────────────────────────────

/** Directions are sent as one of 16 compass steps; 16 = no planar push
 * (a strike from straight above). */
export const DIR_STEPS = 16;
export const NO_DIR = DIR_STEPS;

/** Quantise an impulse's planar direction. */
export function quantDir(ix: number, iz: number): number {
  if (!(ix * ix + iz * iz > 1e-6)) return NO_DIR;
  const a = Math.atan2(iz, ix); // −π…π
  return ((Math.round((a / (Math.PI * 2)) * DIR_STEPS) % DIR_STEPS) + DIR_STEPS) % DIR_STEPS;
}

/** Unit planar direction of a quantised step, into `out`; false (and `out`
 * untouched) for NO_DIR or garbage. */
export function dirOf(k: number, out: { x: number; z: number }): boolean {
  if (!Number.isInteger(k) || k < 0 || k >= DIR_STEPS) return false;
  const a = (k / DIR_STEPS) * Math.PI * 2;
  out.x = Math.cos(a);
  out.z = Math.sin(a);
  return true;
}

// ── What a hit command carries besides damage ───────────────────────────────

/** Extras the shell adds to a networked "hit" command (beside
 * weapons/hits.ts#HitData's damage and impulse): where it landed, whether
 * it was the sender's own magic, a quiet tug. Untrusted — read through
 * readHitExtras. */
export interface HitExtras {
  at: [number, number, number] | null;
  mine: boolean;
  quiet: boolean;
  crit: boolean;
}

/** Points further than this from the origin are nonsense (no floor is that big). */
const MAX_COORD = 5000;

export function readHitExtras(data: unknown): HitExtras {
  const out: HitExtras = { at: null, mine: false, quiet: false, crit: false };
  if (typeof data !== "object" || data === null) return out;
  const d = data as { at?: unknown; m?: unknown; q?: unknown; c?: unknown };
  const a = d.at;
  if (
    Array.isArray(a) &&
    a.length === 3 &&
    a.every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < MAX_COORD)
  ) {
    out.at = [a[0], a[1], a[2]];
  }
  out.mine = d.m === 1;
  out.quiet = d.q === 1;
  out.crit = d.c === 1;
  return out;
}
