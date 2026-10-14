import { KNEE } from "../../../game/vitality";

/** The rules of the life marks (LifeMarks.tsx) — pure, allocation-free,
 * tested. A creature has no health readout until you hurt it; then a small
 * pixel bar hangs over it, bent by Destiny's knee (game/vitality): your
 * first good blows knock it down to the notch fast, and past the notch it
 * is an ember sliver that throbs like a death rattle and lasts as long as
 * everything before it — the sliver that pulls you into finishing it. It
 * goes away a while after the last blow (longer once it's past the knee:
 * a dying thing stays marked so you can hunt it down), and the kill
 * shatters it into sparks. */

export const MARK = {
  /** Seconds a mark stays after the last blow… */
  hold: 4.5,
  /** …and once past the knee. */
  holdPast: 9,
  /** Its fade, in hard steps. */
  fade: 0.45,
  fadeSteps: 3,
  /** Marks further than this (m) aren't drawn; past `dimFrom` one step dimmer. */
  range: 24,
  dimFrom: 16,
  /** At most this many creatures marked at once (the nearest). */
  enemies: 12,
  /** The shooter's own blow shows before the authority's word, this long
   * (ms) — and never bounces back up on a stale snapshot. */
  predictMs: 350,
  /** A bar, in art pixels: a one-pixel ink frame round a 24×4 track. */
  w: 26,
  h: 6,
  /** A heart (a floor-mate in the last stand), in art pixels. */
  heartW: 9,
  heartH: 8,
  /** Art pixels between the top of the body and the mark. */
  lift: 4,
  /** A death rattle's rate past the knee: at the notch → at the end (bpm). */
  rattle: [84, 180] as const,
} as const;

/** Seconds a mark holds after its last blow, at real life `real` (0…1). */
export function markHold(real: number): number {
  return real <= KNEE.real ? MARK.holdPast : MARK.hold;
}

/** A mark's visibility `since` seconds after its last blow: whole while it
 * holds, then gone in a few hard steps. */
export function markAlpha(since: number, hold: number): number {
  if (since <= hold) return 1;
  const t = (since - hold) / MARK.fade;
  if (t >= 1) return 0;
  return Math.ceil((1 - t) * MARK.fadeSteps) / MARK.fadeSteps;
}

/** The life a mark shows (real share, 0…1): the authority's, or the
 * shooter's own prediction while it's fresh and lower. */
export function markLife(real: number, predicted: number, predictedAgeMs: number): number {
  return predictedAgeMs >= 0 && predictedAgeMs < MARK.predictMs ? Math.min(real, predicted) : real;
}

/** A death rattle's rate at real life `real`: 0 (none) above the knee,
 * quickening from the notch to the end. */
export function rattleBpm(real: number): number {
  if (real > KNEE.real || real <= 0) return 0;
  const t = 1 - real / KNEE.real;
  return MARK.rattle[0] + (MARK.rattle[1] - MARK.rattle[0]) * t;
}

/** Screen pixels per art pixel for a drawing buffer this tall: the marks
 * keep one pixel size at any distance, about the HUD's own sprites'. */
export function artPixel(bufferHeight: number): number {
  return Math.max(1, Math.round(bufferHeight / 340));
}

/** The `cap` nearest of whatever is offered, without allocating: offer
 * (item, distance) pairs, read `items[0…n)` nearest first. */
export class Nearest<T> {
  readonly items: (T | null)[];
  readonly dists: Float64Array;
  n = 0;

  constructor(readonly cap: number) {
    this.items = new Array<T | null>(cap).fill(null);
    this.dists = new Float64Array(cap);
  }

  reset(): void {
    for (let i = 0; i < this.n; i++) this.items[i] = null;
    this.n = 0;
  }

  offer(item: T, dist: number): void {
    let i = this.n < this.cap ? this.n : this.cap - 1;
    if (this.n === this.cap && dist >= this.dists[i]!) return;
    if (this.n < this.cap) this.n++;
    while (i > 0 && this.dists[i - 1]! > dist) {
      this.items[i] = this.items[i - 1]!;
      this.dists[i] = this.dists[i - 1]!;
      i--;
    }
    this.items[i] = item;
    this.dists[i] = dist;
  }
}
