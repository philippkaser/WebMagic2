import { castSpell, type AbilityContext } from "./castKinds";
import { SPELLS, spellInfo, type SpellDef } from "./spellCatalog";

export type { AbilityContext } from "./castKinds";
export type { CastStats } from "./castMessage";

/** Staff abilities — the public face of the spell catalog. Staffs reference
 * these by id, so new staffs are pure data. The numbers live as data rows in
 * spellCatalog.ts, the behaviour per kind in castKinds.ts; this module just
 * joins them into the shape UI and the casting system use. */
export interface Ability {
  id: string;
  name: string;
  mana: number;
  cooldown: number;
  /** One-line stat summary for inventory/tooltip display ("16 dmg"), derived
   * from the spell's numbers so the two can't drift apart. */
  info: string;
  cast(ctx: AbilityContext): void;
}

function toAbility(def: Readonly<SpellDef>): Ability {
  return {
    id: def.id,
    name: def.name,
    mana: def.mana,
    cooldown: def.cooldown,
    info: spellInfo(def),
    cast: (ctx) => castSpell(def, ctx),
  };
}

// Built once: getAbility runs every frame a cast button is held.
const ABILITIES = new Map(SPELLS.map((def) => [def.id, toAbility(def)]));

export function getAbility(id: string): Ability {
  const ability = ABILITIES.get(id);
  if (!ability) throw new Error(`Unknown ability: ${id}`);
  return ability;
}
