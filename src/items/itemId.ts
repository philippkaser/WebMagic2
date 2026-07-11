/** Item-id composition — pure string logic, no catalog imports.
 *
 * An owned item is identified by ONE string: `defId` for a plain item,
 * `defId+affixId` for an enchanted one ("ember_staff+keen"). Everything
 * downstream (equipment, bags, wire saves, host grants, provenance, selling)
 * already treats item ids as opaque strings, so rolled rarities flow through
 * the entire persistence and anti-cheat stack with zero server changes. */

export const AFFIX_SEP = "+";

export function makeItemId(defId: string, affixId?: string | null): string {
  return affixId ? `${defId}${AFFIX_SEP}${affixId}` : defId;
}

export function splitItemId(itemId: string): { baseId: string; affixId: string | null } {
  const at = itemId.indexOf(AFFIX_SEP);
  if (at === -1) return { baseId: itemId, affixId: null };
  return { baseId: itemId.slice(0, at), affixId: itemId.slice(at + 1) || null };
}
