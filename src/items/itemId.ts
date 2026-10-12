/** Item-id composition — pure string logic, no catalog imports.
 *
 * An owned item is identified by ONE string:
 *
 *     defId(+affixId)*[@level][^enhance]     e.g.  "ember_staff+keen+frenzied@12^3"
 *
 *  - `+affixId` — enchantments (the rarity layer, items/affixes.ts). None is
 *                 a common item, one an enchanted item, two an arcane one.
 *  - `@level`   — the item level: the depth it was found at, which decides
 *                 its potency and, summed over a wizard's gear, how deep the
 *                 village portal casts them (run/rules.ts). Consumables and
 *                 materials never carry a level; ids without one are
 *                 "legacy" items whose level falls back to their catalog
 *                 minFloor (items/power.ts). The forge can raise it.
 *  - `^enhance` — the forge's enhancement, +1…+MAX_ENHANCE: it amplifies
 *                 everything the item already does (items/power.ts).
 *
 * Everything downstream (equipment, bags, wire saves, host grants, provenance,
 * selling) treats item ids as opaque strings, so every layer flows through
 * the entire persistence and anti-cheat stack with zero server changes. Ids
 * written before a layer existed parse exactly as they always did. */

export const AFFIX_SEP = "+";
export const LEVEL_SEP = "@";
export const ENHANCE_SEP = "^";

/** Hard ceiling on item levels — far past floor 100 (bosses drop a few levels
 * deeper than their floor), low enough that a forged id can't overflow math. */
export const MAX_ITEM_LEVEL = 120;
/** The forge stops at +5 — each step costs more than the last. */
export const MAX_ENHANCE = 5;
/** Random enchantments an item may carry (crafting can't exceed it either). */
export const MAX_AFFIXES = 2;

export interface ItemIdParts {
  baseId: string;
  /** Enchantments in the order they were rolled (the first names the item). */
  affixIds: string[];
  /** Explicit item level, or null when the id carries none. */
  level: number | null;
  /** Forge enhancement, 0 when the id carries none. */
  enhance: number;
  /** False when a level/enhance suffix is present but malformed ("x@abc",
   * "x@0", "x^9"), an affix is empty ("x++keen"), or affixes repeat. */
  wellFormed: boolean;
}

export function makeItemId(
  defId: string,
  affixes?: string | readonly string[] | null,
  level?: number | null,
  enhance = 0,
): string {
  const list = affixes == null ? [] : typeof affixes === "string" ? [affixes] : affixes;
  let id = defId;
  for (const a of list) if (a) id += `${AFFIX_SEP}${a}`;
  if (level !== undefined && level !== null) id += `${LEVEL_SEP}${clampLevel(level)}`;
  const enh = clampEnhance(enhance);
  if (enh > 0) id += `${ENHANCE_SEP}${enh}`;
  return id;
}

export function splitItemId(itemId: string): ItemIdParts {
  let rest = itemId;
  let wellFormed = true;

  let enhance = 0;
  const caret = rest.lastIndexOf(ENHANCE_SEP);
  if (caret !== -1) {
    const text = rest.slice(caret + 1);
    rest = rest.slice(0, caret);
    const n = /^\d{1,2}$/.test(text) ? Number(text) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= MAX_ENHANCE) enhance = n;
    else wellFormed = false;
  }

  let level: number | null = null;
  const at = rest.lastIndexOf(LEVEL_SEP);
  if (at !== -1) {
    const text = rest.slice(at + 1);
    rest = rest.slice(0, at);
    const n = /^\d{1,3}$/.test(text) ? Number(text) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= MAX_ITEM_LEVEL) level = n;
    else wellFormed = false;
  }

  const [baseId, ...affixIds] = rest.split(AFFIX_SEP);
  if (affixIds.some((a) => a.length === 0)) wellFormed = false;
  if (new Set(affixIds).size !== affixIds.length) wellFormed = false;
  return { baseId: baseId ?? "", affixIds: affixIds.filter((a) => a.length > 0), level, enhance, wellFormed };
}

/** Same item with a different (or no) level — the forge's temper, and
 * re-leveling legacy ids for display. */
export function withLevel(itemId: string, level: number | null): string {
  const p = splitItemId(itemId);
  return makeItemId(p.baseId, p.affixIds, level, p.enhance);
}

/** Same item at another enhancement (0 strips it). */
export function withEnhance(itemId: string, enhance: number): string {
  const p = splitItemId(itemId);
  return makeItemId(p.baseId, p.affixIds, p.level, enhance);
}

/** Same item with another set of enchantments. */
export function withAffixes(itemId: string, affixIds: readonly string[]): string {
  const p = splitItemId(itemId);
  return makeItemId(p.baseId, affixIds, p.level, p.enhance);
}

function clampLevel(level: number): number {
  return Math.max(1, Math.min(MAX_ITEM_LEVEL, Math.round(level)));
}

function clampEnhance(enhance: number): number {
  return Math.max(0, Math.min(MAX_ENHANCE, Math.round(enhance || 0)));
}
