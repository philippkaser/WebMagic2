import type { Vec } from "../enemies/brains/common";
import type { PropKind } from "../world/types";

/** What a breakable prop IS to the floor's authority — how much it takes,
 * and what it does when it goes. Its body is a row in sim/bodies.ts, its
 * looks are world/props.tsx; this is the part a browser host and a headless
 * one (sim/floorSim.ts) must agree on. */

export interface PropBlast {
  /** Base radius (the floor's explosionRadiusMult scales it). */
  radius: number;
  damage: number;
  impulse: number;
}

export interface PropRules {
  hp: number;
  /** It goes up when it breaks (a neutral blast: it hurts everything). */
  blast: PropBlast | null;
}

export const PROP_RULES: Readonly<Record<PropKind, PropRules>> = {
  crate: { hp: 26, blast: null },
  barrel: { hp: 42, blast: { radius: 3.4, damage: 26, impulse: 28 } },
  pot: { hp: 6, blast: null },
};

/** Breaks land their loot no lower than this (a pot shattered on the floor). */
export const PROP_LOOT_MIN_Y = 0.5;

/** What a blast at `center` does to something at `at`: damage and a shove,
 * both falling off linearly to nothing at `radius` (the scaled one), the
 * shove pointing away from the centre with a lift — the one formula every
 * explosion uses (weapons/explosions.ts, sim/floorSim.ts). Null outside the
 * radius. `out` is the impulse, written in place. */
export function blastFalloff(
  center: Vec,
  at: Vec,
  radius: number,
  damage: number,
  impulse: number,
  out: Vec,
): number | null {
  const dx = at.x - center.x;
  const dy = at.y - center.y;
  const dz = at.z - center.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist > radius) return null;
  const falloff = 1 - dist / radius;
  const k = dist > 0 ? (impulse * falloff) / dist : 0;
  out.x = dx * k;
  out.y = dy * k + impulse * falloff * 0.35; // lift things — more satisfying
  out.z = dz * k;
  return damage * falloff;
}
