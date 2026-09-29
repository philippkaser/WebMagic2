/** Item-id composition — pure string logic, no catalog imports.
 *
 * An owned item is identified by ONE string:
 *
 *     defId[+affixId][@level]        e.g.  "ember_staff+keen@12"
 *
 *  - `+affixId` — an enchantment (the rarity layer, items/affixes.ts)
 *  - `@level`   — the item level: the depth it was found at, which decides
 *                 its potency and, summed over a wizard's gear, how deep the
 *                 village portal casts them (run/rules.ts). Consumables never
 *                 carry a level; ids without one are "legacy" items whose
 *                 level falls back to their catalog minFloor (items/power.ts).
 *
 * Everything downstream (equipment, bags, wire saves, host grants, provenance,
 * selling) already treats item ids as opaque strings, so both layers flow
 * through the entire persistence and anti-cheat stack with zero server
 * changes. */

export const AFFIX_SEP = "+";
export const LEVEL_SEP = "@";

/** Hard ceiling on item levels — far past floor 100 (bosses drop a few levels
 * deeper than their floor), low enough that a forged id can't overflow math. */
export const MAX_ITEM_LEVEL = 120;

export interface ItemIdParts {
  baseId: string;
  affixId: string | null;
  /** Explicit item level, or null when the id carries none. */
  level: number | null;
  /** False when a level suffix is present but malformed ("x@abc", "x@0"). */
  wellFormed: boolean;
}

export function makeItemId(defId: string, affixId?: string | null, level?: number | null): string {
  let id = affixId ? `${defId}${AFFIX_SEP}${affixId}` : defId;
  if (level !== undefined && level !== null) id += `${LEVEL_SEP}${clampLevel(level)}`;
  return id;
}

export function splitItemId(itemId: string): ItemIdParts {
  let rest = itemId;
  let level: number | null = null;
  let wellFormed = true;
  const at = rest.lastIndexOf(LEVEL_SEP);
  if (at !== -1) {
    const text = rest.slice(at + 1);
    rest = rest.slice(0, at);
    const n = /^\d{1,3}$/.test(text) ? Number(text) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= MAX_ITEM_LEVEL) level = n;
    else wellFormed = false;
  }
  const plus = rest.indexOf(AFFIX_SEP);
  if (plus === -1) return { baseId: rest, affixId: null, level, wellFormed };
  return { baseId: rest.slice(0, plus), affixId: rest.slice(plus + 1) || null, level, wellFormed };
}

/** Same item with a different (or no) level — used when re-leveling legacy
 * ids for display, and by tests. */
export function withLevel(itemId: string, level: number | null): string {
  const { baseId, affixId } = splitItemId(itemId);
  return makeItemId(baseId, affixId, level);
}

function clampLevel(level: number): number {
  return Math.max(1, Math.min(MAX_ITEM_LEVEL, Math.round(level)));
}
