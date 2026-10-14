/** Tension curves — how close to death things look, and how long they cling
 * on there. Pure; the one place every "barely alive" system reads from.
 *
 * THE KNEE (enemies, Destiny's trick): a health bar's last third holds half
 * the creature's life. The bar falls fast to a sliver — and then the sliver
 * lasts as long as everything before it. Shown, never changed: the authority
 * still subtracts plain damage from plain hp, so this costs no trust and no
 * traffic (every client derives it from the hp that already replicates).
 *
 * LAST STAND (the wizard): below 30% health, harm is halved — that last 30%
 * lasts as long as the 60% before it. Real, not shown: a wizard's health is
 * decided on their own machine, so the rule is local and fair in co-op and
 * PvP alike.
 *
 * LETHAL GRACE: a blow that would kill a wizard standing at half health or
 * more leaves them at 1 instead — the Brink — at most once a while. You can
 * never be one-shot from healthy. */

/** Real life fraction at the knee, and how much of the bar it shows. */
export const KNEE = { real: 0.5, shown: 1 / 3 } as const;

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/** How full a bar looks for this much real life (0…1 → 0…1, monotonic). */
export function shownFrac(real: number): number {
  const r = clamp01(real);
  return r <= KNEE.real ? (r / KNEE.real) * KNEE.shown : KNEE.shown + ((r - KNEE.real) / (1 - KNEE.real)) * (1 - KNEE.shown);
}

/** The inverse: how much real life a bar this full stands for. */
export function realFrac(shown: number): number {
  const s = clamp01(shown);
  return s <= KNEE.shown ? (s / KNEE.shown) * KNEE.real : KNEE.real + ((s - KNEE.shown) / (1 - KNEE.shown)) * (1 - KNEE.real);
}

/** How wounded a body looks: 0 whole · 1 hurt · 2 broken (past the knee) ·
 * 3 dying. Bodies crack, leak and sputter by stage. */
export type WoundStage = 0 | 1 | 2 | 3;

export function woundStage(real: number): WoundStage {
  if (real > 0.75) return 0;
  if (real > KNEE.real) return 1;
  if (real > 0.2) return 2;
  return 3;
}

/** Did this hit carry it across the knee (the "break" beat)? */
export function crossedKnee(before: number, after: number): boolean {
  return before > KNEE.real && after <= KNEE.real && after > 0;
}

export const LAST_STAND = {
  /** Below this share of max health, harm is scaled by `damageMult`. */
  below: 0.3,
  damageMult: 0.5,
} as const;

export const LETHAL_GRACE = {
  /** A killing blow taken at or above this share of max health… */
  fromFrac: 0.5,
  /** …leaves you at this much health instead… */
  leaves: 1,
  /** …at most once per this many seconds. */
  cooldown: 25,
} as const;

/** Harm actually taken from `amount` at `health` of `max`: what falls above
 * the last-stand line lands in full, what falls below it is halved. */
export function lastStandDamage(health: number, max: number, amount: number): number {
  if (amount <= 0 || max <= 0) return Math.max(0, amount);
  const line = LAST_STAND.below * max;
  const above = Math.max(0, Math.min(amount, health - line));
  return above + (amount - above) * LAST_STAND.damageMult;
}

export interface WizardHarm {
  /** Health after the blow. */
  health: number;
  /** Lethal grace caught it: the Brink. */
  brink: boolean;
  /** When grace can next save you (seconds, the caller's clock). */
  graceReadyAt: number;
}

/** One blow against a wizard: last stand, then lethal grace. `now` and
 * `graceReadyAt` are seconds on the caller's clock. */
export function harmWizard(health: number, max: number, amount: number, now: number, graceReadyAt: number): WizardHarm {
  const after = health - lastStandDamage(health, max, amount);
  if (after > 0) return { health: after, brink: false, graceReadyAt };
  if (health >= LETHAL_GRACE.fromFrac * max && now >= graceReadyAt) {
    return { health: Math.min(health, LETHAL_GRACE.leaves), brink: true, graceReadyAt: now + LETHAL_GRACE.cooldown };
  }
  return { health: after, brink: false, graceReadyAt };
}
