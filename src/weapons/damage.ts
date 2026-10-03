/** The weapons domain's public damage API — a stable import path for
 * enemies/, world/ and anything else outside weapons/.
 *
 * Deliberately only a barrel: the implementation lives in focused modules,
 *  - explosions.ts — explode(): radial damage + impulse + VFX, and the
 *    local-wizard rule (who a blast may hurt) from allegiance.ts;
 *  - hits.ts       — sanitizeHit(): validating networked hit commands;
 *  - allegiance.ts — DamageTeam and the pure PvP rules.
 * Code inside weapons/ imports those modules directly. */

export { explode, type ExplosionOptions } from "./explosions";
export { sanitizeHit, type HitData } from "./hits";
export type { DamageTeam } from "./allegiance";
