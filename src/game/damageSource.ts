/** Who (or what) dealt a hit to the local wizard. Carried alongside damage so
 * the store can attribute deaths (grave chests name their killer) and so
 * wizard-cast damage can be told apart from the dungeon's own.
 *
 *  - wizard: another player's spell (or our own — never hurts us)
 *  - enemy:  a monster's contact, bolt or slam
 *  - world:  traps, exploding barrels, falling out of the world */
export type DamageSource =
  | { kind: "wizard"; id: string }
  | { kind: "enemy" }
  | { kind: "world" };

export const ENEMY_SOURCE: DamageSource = { kind: "enemy" };
export const WORLD_SOURCE: DamageSource = { kind: "world" };

export function wizardSource(id: string): DamageSource {
  return { kind: "wizard", id };
}
