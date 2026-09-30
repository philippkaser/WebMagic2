import { allAffixDefs } from "../../../items/affixes";
import { allItemDefs, resolveItem } from "../../../items/catalog";

/** Which physical things to show on the death screen.
 *
 * The store's death record keeps only display names ("Keen Ember Staff",
 * "Weak Healing Draught ×3") — enough for words, not for a 3D model. The
 * `wizardFell` event that precedes every real death carries the ids, so the
 * death screen prefers those; a death set up by hand (dev tools, e2e) has
 * only names, which are mapped back through the catalog. Levels don't show
 * in a name, so a name-resolved item wears its base level — the model is
 * the same either way. Anything unrecognisable still gets a slot (with a
 * null id: the screen shows a nameless shard instead of a model). */

export interface LostThing {
  /** Item id for ItemModel, or null when only the name is known. */
  id: string | null;
  qty: number;
  name: string;
}

let nameIndex: Map<string, string> | null = null;

/** Display name → a representative item id (base def, with its affix). */
function byName(): Map<string, string> {
  if (nameIndex) return nameIndex;
  nameIndex = new Map();
  for (const def of allItemDefs()) {
    nameIndex.set(def.name, def.id);
    if (def.slot === "consumable") continue;
    for (const affix of allAffixDefs()) {
      const id = `${def.id}+${affix.id}`;
      try {
        nameIndex.set(resolveItem(id).name, id);
      } catch {
        // An affix this slot can't carry.
      }
    }
  }
  return nameIndex;
}

/** "Weak Healing Draught ×3" → { name: "Weak Healing Draught", qty: 3 }. */
export function splitQty(label: string): { name: string; qty: number } {
  const m = /^(.*?)\s*×\s*(\d+)$/.exec(label);
  return m ? { name: m[1]!, qty: Number(m[2]) } : { name: label, qty: 1 };
}

/** The lost stacks to show. `fell` (ids from the wizardFell event) wins when
 * it describes the same loss as `names`; otherwise names are resolved. */
export function resolveLost(names: readonly string[], fell: readonly { id: string; qty: number }[] | null): LostThing[] {
  if (fell && fell.length === names.length) {
    const things: LostThing[] = [];
    let consistent = true;
    fell.forEach((stack, i) => {
      let name: string;
      try {
        name = resolveItem(stack.id).name;
      } catch {
        consistent = false;
        return;
      }
      if (splitQty(names[i]!).name !== name) consistent = false;
      things.push({ id: stack.id, qty: stack.qty, name });
    });
    if (consistent) return things;
  }
  const index = byName();
  return names.map((label) => {
    const { name, qty } = splitQty(label);
    return { id: index.get(name) ?? null, qty, name };
  });
}
