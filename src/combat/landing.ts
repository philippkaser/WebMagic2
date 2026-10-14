/** The blow landing right now, as only the shooter's weapons know it: how
 * heavy the spell is (a beam's tick, a bolt, a rail — weapons/castFeel).
 *
 * The confirm hears of a hit through the enemy shell's `enemyHit`, which
 * the shell emits from inside Hittable.hit() — synchronously — so the
 * weapons set this around each hit() they make (weapons/land.ts) and the
 * confirm reads it in the same breath. NaN when no weapon is mid-blow (a
 * hit from somewhere else): the confirm then judges by the damage alone. */
export const landing = { weight: Number.NaN };
