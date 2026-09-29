/** Per-floor rule multipliers — how the current floor bends the usual numbers.
 *
 * Omens (world/omens.ts) are the main producer: a "Crimson Omen" floor makes
 * monsters hit harder, a "Weightless Hour" floor lowers gravity. Systems that
 * care read the live values through getFloorRules() at the moment they need
 * them (spawn, hit, drop), so no component has to know what an omen is.
 *
 * The floor scene installs rules on mount and resets them on unmount; the
 * village and tests always see the neutral defaults. */

export interface FloorRules {
  /** World gravity multiplier (physics). */
  gravityMult: number;
  /** Enemy contact/bolt/slam damage. */
  enemyDamageMult: number;
  /** Enemy movement speed. */
  enemySpeedMult: number;
  /** Enemy health at spawn. */
  enemyHealthMult: number;
  /** Chance an enemy/prop drops an item. */
  lootChanceMult: number;
  /** Gold amounts. */
  goldMult: number;
  /** Player mana regeneration. */
  manaRegenMult: number;
  /** Radius of every explosion (spells, barrels, slams). */
  explosionRadiusMult: number;
}

export const NEUTRAL_FLOOR_RULES: Readonly<FloorRules> = Object.freeze({
  gravityMult: 1,
  enemyDamageMult: 1,
  enemySpeedMult: 1,
  enemyHealthMult: 1,
  lootChanceMult: 1,
  goldMult: 1,
  manaRegenMult: 1,
  explosionRadiusMult: 1,
});

let current: FloorRules = { ...NEUTRAL_FLOOR_RULES };

export function getFloorRules(): Readonly<FloorRules> {
  return current;
}

export function setFloorRules(rules: Partial<FloorRules>): void {
  current = { ...NEUTRAL_FLOOR_RULES, ...rules };
}

export function resetFloorRules(): void {
  current = { ...NEUTRAL_FLOOR_RULES };
}
