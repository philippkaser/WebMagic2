/** Damage numbers: the sum your magic just dealt, popping off the creature
 * in the game's own pixel font — bone-white for a plain hit, gold with a "!"
 * for a precision hit, red-hot for the killing blow.
 *
 * A held beam or flame doesn't spray a cloud of digits: hits on the same
 * creature close together pour into ONE number that keeps climbing (5 → 10
 * → 15…), re-popping each time, so a stream feels like it's filling the
 * creature with damage. Only your own hits get numbers.
 *
 * Pure and pooled: a fixed array of entries, reused oldest-first, nothing
 * allocated per hit or per frame. */

export const NUMBERS = {
  /** Pool size (the renderer draws at most this many). */
  size: 48,
  /** A hit on the same creature within this long of the last pours into
   * its number. */
  merge: 0.35,
  /** Seconds a number lives after its last hit. */
  life: 0.8,
  /** Pop: it lands this much bigger and settles to 1 over `popTime`. */
  pop: 1.6,
  popTime: 0.08,
  /** A pour re-pops it this big. */
  repop: 1.3,
  /** Metres it rises over its life (eased out). */
  rise: 0.5,
  /** It fades over the last share of its life. */
  fade: 0.35,
} as const;

/** 0 plain · 1 precision · 2 the killing blow. A number only ever moves up. */
export type NumberStyle = 0 | 1 | 2;

export interface DamageNumber {
  live: boolean;
  target: string;
  value: number;
  style: NumberStyle;
  x: number;
  y: number;
  z: number;
  /** Seconds since its life (re)started — rise and fade run on it. */
  age: number;
  /** Seconds since the last hit poured in — the pop runs on it. */
  bump: number;
  /** How big the last pop was. */
  popFrom: number;
  /** Sideways nudge (metres, along the view's right) so numbers from
   * neighbouring hits don't stack on one spot. */
  side: number;
}

export interface NumberPool {
  items: DamageNumber[];
  /** Cycles the sideways nudges. */
  turn: number;
}

export function createNumbers(size: number = NUMBERS.size): NumberPool {
  const items: DamageNumber[] = [];
  for (let i = 0; i < size; i++) {
    items.push({ live: false, target: "", value: 0, style: 0, x: 0, y: 0, z: 0, age: 0, bump: 0, popFrom: 1, side: 0 });
  }
  return { items, turn: 0 };
}

const SIDES = [0, 0.18, -0.16, 0.1, -0.22, 0.24, -0.08];

/** Your hit on `target` dealt `damage` at (x, y, z). Returns the entry it
 * landed in (fresh, or the creature's number still pouring). */
export function addNumber(
  pool: NumberPool,
  target: string,
  x: number,
  y: number,
  z: number,
  damage: number,
  style: NumberStyle,
): DamageNumber {
  let into: DamageNumber | null = null;
  let oldest: DamageNumber = pool.items[0]!;
  for (const e of pool.items) {
    if (e.live && e.target === target && e.bump < NUMBERS.merge && e.style < 2) {
      into = e;
      break;
    }
    // Free slots first, else the one nearest its end.
    if (oldest.live && (!e.live || e.age > oldest.age)) oldest = e;
  }
  if (into) {
    into.value += damage;
    if (style > into.style) into.style = style;
    // It follows the stream: halfway toward where the newest hit landed.
    into.x += (x - into.x) * 0.5;
    into.y += (y - into.y) * 0.5;
    into.z += (z - into.z) * 0.5;
    into.age = Math.min(into.age, NUMBERS.popTime);
    into.bump = 0;
    into.popFrom = style === 2 ? NUMBERS.pop : NUMBERS.repop;
    return into;
  }
  const e = oldest;
  e.live = true;
  e.target = target;
  e.value = damage;
  e.style = style;
  e.x = x;
  e.y = y;
  e.z = z;
  e.age = 0;
  e.bump = 0;
  e.popFrom = NUMBERS.pop;
  e.side = SIDES[pool.turn++ % SIDES.length]!;
  return e;
}

/** Age every live number by `dt`; numbers past their life go back to the
 * pool. */
export function stepNumbers(pool: NumberPool, dt: number): void {
  for (const e of pool.items) {
    if (!e.live) continue;
    e.age += dt;
    e.bump += dt;
    if (e.age >= NUMBERS.life) e.live = false;
  }
}

/** How a number looks right now. One scratch object — read it at once. */
export interface NumberLook {
  /** Size multiplier (the renderer rounds it to whole screen pixels). */
  scale: number;
  /** 0…1. */
  alpha: number;
  /** Metres risen. */
  rise: number;
}
const look: NumberLook = { scale: 1, alpha: 1, rise: 0 };

export function numberLook(e: DamageNumber): NumberLook {
  const p = Math.min(1, e.bump / NUMBERS.popTime);
  look.scale = e.popFrom + (1 - e.popFrom) * p;
  const t = Math.min(1, e.age / NUMBERS.life);
  look.rise = NUMBERS.rise * (1 - (1 - t) * (1 - t));
  const fadeFrom = 1 - NUMBERS.fade;
  look.alpha = t <= fadeFrom ? 1 : Math.max(0, 1 - (t - fadeFrom) / NUMBERS.fade);
  return look;
}

/** The text a number shows: whole points (a sliver of damage still shows
 * as 1), a "!" after a precision hit. Written into `out` (a char-code
 * array the renderer owns); returns its length. */
export function numberText(e: DamageNumber, out: number[]): number {
  let v = Math.max(1, Math.round(e.value));
  let n = 0;
  // Digits backwards, then reversed in place.
  do {
    out[n++] = 48 + (v % 10);
    v = Math.floor(v / 10);
  } while (v > 0 && n < out.length);
  for (let i = 0, j = n - 1; i < j; i++, j--) {
    const t = out[i]!;
    out[i] = out[j]!;
    out[j] = t;
  }
  if (e.style === 1 && n < out.length) out[n++] = 33; // "!"
  return n;
}
