/** Networked hit commands — the one place a remote player's numbers enter an
 * entity's health. Pure (no three.js, no store) so the clamps are unit-tested. */

/** A "hit" command payload as it travels over the network (client → floor
 * authority). Untrusted: the sender picks the numbers. */
export interface HitData {
  damage: number;
  impulse: { x: number; y: number; z: number };
}

/** Ceiling for a single networked hit. The strongest legit hit today is
 * ~44 (34 base × 1.3 damage mult); the headroom covers future item stacking
 * without letting a hacked client one-shot everything. */
export const MAX_HIT_DAMAGE = 100;
/** Per-axis impulse ceiling (legit peak ≈ 60 incl. the blast y-lift). */
export const MAX_HIT_IMPULSE = 150;

const clamp = (n: number, max: number) => Math.min(max, Math.max(-max, n));

/** Validate a hit command that arrived from another player. Returns a copy
 * with damage/impulse clamped to plausible gameplay ranges, or null when the
 * payload is malformed (wrong shape, NaN/Infinity — NaN hp would make an
 * entity unkillable). Authorities must route every remote hit through this. */
export function sanitizeHit(data: unknown): HitData | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as HitData;
  const i = d.impulse;
  if (
    typeof d.damage !== "number" ||
    !Number.isFinite(d.damage) ||
    typeof i !== "object" ||
    i === null ||
    !Number.isFinite(i.x) ||
    !Number.isFinite(i.y) ||
    !Number.isFinite(i.z)
  ) {
    return null;
  }
  return {
    damage: Math.min(MAX_HIT_DAMAGE, Math.max(0, d.damage)),
    impulse: {
      x: clamp(i.x, MAX_HIT_IMPULSE),
      y: clamp(i.y, MAX_HIT_IMPULSE),
      z: clamp(i.z, MAX_HIT_IMPULSE),
    },
  };
}
