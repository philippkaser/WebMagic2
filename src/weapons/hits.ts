import { MAX_ITEM_LEVEL } from "../items/itemId";
import { staffPotency } from "../items/power";

/** Networked hit commands — the one place a remote player's numbers enter an
 * entity's health. Pure (no three.js, no store) so the clamps are unit-tested. */

/** A "hit" command payload as it travels over the network (client → floor
 * authority). Untrusted: the sender picks the numbers. */
export interface HitData {
  damage: number;
  impulse: { x: number; y: number; z: number };
}

/** Ceiling for a single networked hit at floor 1. The strongest legit
 * unleveled hit is ~50 (34 base × 1.3 fury × 1.12 keen); the headroom covers
 * item stacking without letting a hacked client one-shot everything. */
const BASE_HIT_CAP = 100;

/** Staff levels multiply spell damage (items/power.ts), so the cap follows
 * depth: a floor's legit hits come from staffs found around that floor (a
 * few levels of slack for lucky rolls and boss drops). */
export function hitCapForFloor(floor: number): number {
  return BASE_HIT_CAP * staffPotency(Math.max(1, floor) + 4);
}

/** Absolute ceiling when the caller doesn't know the floor. */
export const MAX_HIT_DAMAGE = BASE_HIT_CAP * staffPotency(MAX_ITEM_LEVEL);
/** Per-axis impulse ceiling (legit peak ≈ 60 incl. the blast y-lift). */
export const MAX_HIT_IMPULSE = 150;

const clamp = (n: number, max: number) => Math.min(max, Math.max(-max, n));

/** Validate a hit command that arrived from another player. Returns a copy
 * with damage/impulse clamped to plausible gameplay ranges, or null when the
 * payload is malformed (wrong shape, NaN/Infinity — NaN hp would make an
 * entity unkillable). Authorities must route every remote hit through this. */
export function sanitizeHit(data: unknown, floor?: number): HitData | null {
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
    damage: Math.min(floor ? hitCapForFloor(floor) : MAX_HIT_DAMAGE, Math.max(0, d.damage)),
    impulse: {
      x: clamp(i.x, MAX_HIT_IMPULSE),
      y: clamp(i.y, MAX_HIT_IMPULSE),
      z: clamp(i.z, MAX_HIT_IMPULSE),
    },
  };
}
