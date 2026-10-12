import type { Rng } from "../core/rng";
import type { WireInventory, WireStack } from "../net/protocol";
import { rollAffixIds } from "./affixes";
import { getItemDef, maxStackOf, resolveItem, type ResolvedItem } from "./catalog";
import { MAX_AFFIXES, MAX_ENHANCE, MAX_ITEM_LEVEL, withAffixes, withEnhance, withLevel } from "./itemId";
import { rollUnique } from "./loot";
import { bandReagent } from "./materials";
import { isGearSlot, type GearSlot } from "./types";

/** The crafting loop — Wenna's cauldron and Brannoc's forge — as one pure,
 * shared function over a wire inventory. The server applies it to the
 * account's banked inventory (online the forge's dice are the server's, so
 * an imbue can't be fished for); offline the client applies it to its own
 * save. Village only: crafting never touches run loot.
 *
 *  - BREW (cauldron): reagents (+ a little gold) → a draught or elixir.
 *    Every recipe wants Grave Moss, which grows only in the Catacombs.
 *  - TEMPER (forge): +1 item level. Costs the reagent of the band the new
 *    level belongs to — you can only temper into a depth you've walked.
 *  - ENHANCE (forge): +1…+5. Riftglass and arcane dust, more each step.
 *  - IMBUE (forge): a new random enchantment on gear with room for one.
 *  - REFORGE (forge): re-roll an item's enchantments (same count).
 *  - SALVAGE (forge): break gear down into reagents and essence.
 *  - THE GREAT WORK (forge): Warden's Sigils and riftglass → a legendary.
 *
 * Inputs come from the pouch, then the bag, then the chest; outputs go
 * where they belong (draughts to the belt, reagents to the pouch, gear to
 * the bag) and then anywhere with room. */

export type Station = "cauldron" | "forge";

export type CraftKind = "brew" | "temper" | "enhance" | "imbue" | "reforge" | "salvage" | "greatwork";

export interface Cost {
  items: WireStack[];
  gold: number;
}

export interface Recipe {
  id: string;
  station: Station;
  kind: CraftKind;
  name: string;
  desc: string;
  /** brew: the fixed cost and what comes out. */
  cost?: Cost;
  output?: string;
  outputQty?: number;
}

const m = (id: string, qty: number): WireStack => ({ id, qty });

const BREWS: Recipe[] = [
  brew("potion_hp_weak", [m("grave_moss", 1), m("slime_gel", 2)], 4),
  brew("potion_mp_weak", [m("grave_moss", 1), m("wisp_ember", 2)], 4),
  brew("potion_hp", [m("grave_moss", 2), m("slime_gel", 2), m("brine_pearl", 1)], 10),
  brew("potion_mp", [m("grave_moss", 2), m("wisp_ember", 2), m("brine_pearl", 1)], 10),
  brew("elixir_haste", [m("grave_moss", 1), m("wisp_ember", 3), m("shadow_silk", 1)], 12),
  brew("elixir_ironskin", [m("grave_moss", 1), m("sentry_core", 2), m("slime_gel", 1)], 12),
  brew("elixir_fury", [m("grave_moss", 1), m("shadow_silk", 2), m("sentry_core", 1)], 14),
  brew("elixir_clarity", [m("grave_moss", 1), m("wisp_ember", 2), m("brine_pearl", 2)], 14),
  brew("save_feather", [m("riftglass", 1), m("shadow_silk", 3), m("wisp_ember", 3)], 40),
];

function brew(output: string, items: WireStack[], gold: number): Recipe {
  const def = getItemDef(output);
  return {
    id: `brew:${output}`,
    station: "cauldron",
    kind: "brew",
    name: def.name,
    desc: def.desc,
    cost: { items, gold },
    output,
    outputQty: 1,
  };
}

const FORGE: Recipe[] = [
  { id: "temper", station: "forge", kind: "temper", name: "Temper", desc: "+1 item level — the reagent of the depth it's raised to" },
  { id: "enhance", station: "forge", kind: "enhance", name: "Enhance", desc: `+1 forge level (to +${MAX_ENHANCE}) — boons grow, banes don't` },
  { id: "imbue", station: "forge", kind: "imbue", name: "Imbue", desc: "A new random enchantment, if it has room" },
  { id: "reforge", station: "forge", kind: "reforge", name: "Reforge", desc: "Re-roll its enchantments" },
  { id: "salvage", station: "forge", kind: "salvage", name: "Salvage", desc: "Break it down into reagents and essence" },
  {
    id: "greatwork",
    station: "forge",
    kind: "greatwork",
    name: "The Great Work",
    desc: "Forge a legendary from Wardens' Sigils",
    cost: { items: [m("warden_sigil", 3), m("riftglass", 4), m("arcane_dust", 6)], gold: 300 },
  },
];

const RECIPES: readonly Recipe[] = [...BREWS, ...FORGE];
const byId = new Map(RECIPES.map((r) => [r.id, r]));

export function allRecipes(station?: Station): readonly Recipe[] {
  return station ? RECIPES.filter((r) => r.station === station) : RECIPES;
}

export function getRecipe(id: string): Recipe | null {
  return byId.get(id) ?? null;
}

// ── Targets ──────────────────────────────────────────────────────────────────

/** Where the item to work on sits (the wire form of an inventory SlotRef). */
export type WireSlot =
  | { c: "equipment"; s: GearSlot }
  | { c: "bag" | "belt" | "pouch" | "chest"; i: number };

function readWire(inv: WireInventory, at: WireSlot): string | null {
  if (at.c === "equipment") return inv.equipment[at.s] ?? null;
  const grid = inv[at.c];
  return Array.isArray(grid) ? (grid[at.i]?.id ?? null) : null;
}

function writeWire(inv: WireInventory, at: WireSlot, id: string | null): void {
  if (at.c === "equipment") {
    if (at.s === "staff") inv.equipment.staff = id ?? inv.equipment.staff;
    else inv.equipment[at.s] = id;
    return;
  }
  inv[at.c][at.i] = id ? { id, qty: 1 } : null;
}

export function isWireSlot(raw: unknown): raw is WireSlot {
  const s = raw as Partial<{ c: unknown; s: unknown; i: unknown }> | null;
  if (!s || typeof s !== "object") return false;
  if (s.c === "equipment") return s.s === "staff" || s.s === "amulet" || s.s === "cloak" || s.s === "boots";
  if (s.c === "bag" || s.c === "belt" || s.c === "pouch" || s.c === "chest") {
    return typeof s.i === "number" && Number.isInteger(s.i) && s.i >= 0 && s.i < 64;
  }
  return false;
}

// ── Costs of the forge's target work ─────────────────────────────────────────

/** What raising this item one level costs (null: it can't be raised). */
export function temperCost(item: ResolvedItem): Cost | null {
  if (!isGearSlot(item.def.slot) || item.level >= MAX_ITEM_LEVEL) return null;
  const next = item.level + 1;
  return { items: [m(bandReagent(next), 2 + Math.floor(item.level / 12))], gold: 8 + item.level * 3 };
}

/** What one more forge level costs. */
export function enhanceCost(item: ResolvedItem): Cost | null {
  if (!isGearSlot(item.def.slot) || item.enhance >= MAX_ENHANCE) return null;
  const step = item.enhance + 1;
  return {
    items: [m("riftglass", step), m("arcane_dust", 2 * step), m(bandReagent(Math.max(1, item.level)), 2)],
    gold: 40 * step,
  };
}

export function imbueCost(item: ResolvedItem): Cost | null {
  if (!isGearSlot(item.def.slot) || item.def.unique || item.affixes.length >= MAX_AFFIXES) return null;
  return { items: [m("arcane_dust", 4), m("riftglass", 1)], gold: 60 };
}

export function reforgeCost(item: ResolvedItem): Cost | null {
  if (!isGearSlot(item.def.slot) || item.def.unique || item.affixes.length === 0) return null;
  return { items: [m("arcane_dust", 3)], gold: 40 };
}

/** What breaking this item down yields. */
export function salvageYield(item: ResolvedItem): WireStack[] {
  if (!isGearSlot(item.def.slot)) return [];
  const out: WireStack[] = [m(bandReagent(Math.max(1, item.level)), 1 + Math.floor(item.level / 10))];
  const dust = item.affixes.length * 2 + item.enhance;
  if (dust > 0) out.push(m("arcane_dust", dust));
  const glass = item.def.unique ? 2 : item.enhance >= 3 ? 1 : 0;
  if (glass > 0) out.push(m("riftglass", glass));
  return out;
}

/** The forge's price for a recipe on a target (null: not possible). */
export function forgeCost(kind: CraftKind, item: ResolvedItem | null): Cost | null {
  if (kind === "greatwork") return getRecipe("greatwork")!.cost!;
  if (!item) return null;
  switch (kind) {
    case "temper":
      return temperCost(item);
    case "enhance":
      return enhanceCost(item);
    case "imbue":
      return imbueCost(item);
    case "reforge":
      return reforgeCost(item);
    case "salvage":
      return isGearSlot(item.def.slot) ? { items: [], gold: 0 } : null;
    default:
      return null;
  }
}

// ── Counting and paying ──────────────────────────────────────────────────────

const GRIDS = ["pouch", "bag", "chest", "belt"] as const;

/** Copies of `id` anywhere in the grids (equipment never pays for crafts). */
export function countItem(inv: WireInventory, id: string): number {
  let n = 0;
  for (const g of GRIDS) for (const s of inv[g] ?? []) if (s && s.id === id) n += s.qty;
  return n;
}

export function canAfford(inv: WireInventory, cost: Cost): boolean {
  if (inv.gold < cost.gold) return false;
  // Sum per id (a recipe could list the same reagent twice).
  const need = new Map<string, number>();
  for (const s of cost.items) need.set(s.id, (need.get(s.id) ?? 0) + s.qty);
  for (const [id, qty] of need) if (countItem(inv, id) < qty) return false;
  return true;
}

function pay(inv: WireInventory, cost: Cost): void {
  inv.gold -= cost.gold;
  for (const { id, qty } of cost.items) {
    let left = qty;
    for (const g of GRIDS) {
      const grid = inv[g];
      for (let i = 0; i < grid.length && left > 0; i++) {
        const s = grid[i];
        if (!s || s.id !== id) continue;
        const take = Math.min(left, s.qty);
        left -= take;
        grid[i] = s.qty - take > 0 ? { id, qty: s.qty - take } : null;
      }
    }
  }
}

/** Put `qty` of `id` where it belongs, then anywhere with room. False (and
 * the inventory partly filled) if it didn't all fit — callers check room
 * first with a dry run on a copy. */
function give(inv: WireInventory, id: string, qty: number): boolean {
  const def = getItemDef(id);
  const max = maxStackOf(id);
  const order: (typeof GRIDS)[number][] =
    def.slot === "material" ? ["pouch", "bag", "chest"] : def.slot === "consumable" ? ["belt", "bag", "chest"] : ["bag", "chest"];
  let left = qty;
  for (const g of order) {
    const grid = inv[g];
    if (max > 1) {
      for (let i = 0; i < grid.length && left > 0; i++) {
        const s = grid[i];
        if (s && s.id === id && s.qty < max) {
          const add = Math.min(left, max - s.qty);
          grid[i] = { id, qty: s.qty + add };
          left -= add;
        }
      }
    }
    for (let i = 0; i < grid.length && left > 0; i++) {
      if (grid[i]) continue;
      const add = Math.min(left, max);
      grid[i] = { id, qty: add };
      left -= add;
    }
    if (left === 0) return true;
  }
  return left === 0;
}

function clone(inv: WireInventory): WireInventory {
  const g = (grid: (WireStack | null)[] | undefined) => (grid ?? []).map((s) => (s ? { ...s } : null));
  return { equipment: { ...inv.equipment }, bag: g(inv.bag), belt: g(inv.belt), pouch: g(inv.pouch), chest: g(inv.chest), gold: inv.gold };
}

// ── The one entry point ──────────────────────────────────────────────────────

export interface CraftRequest {
  recipe: string;
  /** The item worked on (forge recipes except the Great Work). */
  target?: WireSlot;
}

export type CraftOutcome =
  | {
      ok: true;
      inventory: WireInventory;
      /** What came out (brews, salvage, the Great Work). */
      produced: WireStack[];
      /** The worked item's id before → after (temper, enhance, imbue, reforge). */
      changed?: { from: string; to: string };
    }
  | { ok: false; reason: string };

export interface CraftContext {
  /** Deepest floor walked home from — the Great Work's depth. */
  deepest: number;
}

/** Apply one craft. Never mutates `inv`. */
export function applyCraft(inv: WireInventory, req: CraftRequest, rng: Rng, ctx: CraftContext): CraftOutcome {
  const recipe = getRecipe(req.recipe);
  if (!recipe) return { ok: false, reason: "No such recipe" };
  const next = clone(inv);

  if (recipe.kind === "brew") {
    const cost = recipe.cost!;
    if (!canAfford(next, cost)) return { ok: false, reason: "Not enough reagents" };
    pay(next, cost);
    if (!give(next, recipe.output!, recipe.outputQty ?? 1)) return { ok: false, reason: "No room for it" };
    return { ok: true, inventory: next, produced: [m(recipe.output!, recipe.outputQty ?? 1)] };
  }

  if (recipe.kind === "greatwork") {
    const cost = recipe.cost!;
    if (!canAfford(next, cost)) return { ok: false, reason: "The Great Work wants more" };
    const unique = rollUnique(rng, Math.max(10, ctx.deepest));
    if (!unique) return { ok: false, reason: "The forge has nothing to give" };
    pay(next, cost);
    if (!give(next, unique, 1)) return { ok: false, reason: "No room for it" };
    return { ok: true, inventory: next, produced: [m(unique, 1)] };
  }

  // Everything else works on an item.
  if (!req.target || !isWireSlot(req.target)) return { ok: false, reason: "Lay something on the anvil" };
  const id = readWire(next, req.target);
  if (!id) return { ok: false, reason: "Lay something on the anvil" };
  let item: ResolvedItem;
  try {
    item = resolveItem(id);
  } catch {
    return { ok: false, reason: "The forge won't touch that" };
  }
  const cost = forgeCost(recipe.kind, item);
  if (!cost) return { ok: false, reason: cantReason(recipe.kind, item) };
  if (!canAfford(next, cost)) return { ok: false, reason: "Not enough to pay the forge" };

  if (recipe.kind === "salvage") {
    if (req.target.c === "equipment" && req.target.s === "staff") return { ok: false, reason: "A wizard never breaks their staff" };
    writeWire(next, req.target, null);
    const out = salvageYield(item);
    for (const s of out) if (!give(next, s.id, s.qty)) return { ok: false, reason: "No room for the pieces" };
    return { ok: true, inventory: next, produced: out };
  }

  pay(next, cost);
  let to: string;
  switch (recipe.kind) {
    case "temper":
      to = withLevel(id, item.level + 1);
      break;
    case "enhance":
      to = withEnhance(id, item.enhance + 1);
      break;
    case "imbue": {
      const slot = item.def.slot as GearSlot;
      const extra = rollAffixIds(rng, slot, 1, item.affixes.map((a) => a.id));
      if (extra.length === 0) return { ok: false, reason: "No enchantment will take" };
      to = withAffixes(id, [...item.affixes.map((a) => a.id), ...extra]);
      break;
    }
    case "reforge": {
      const slot = item.def.slot as GearSlot;
      const fresh = rollAffixIds(rng, slot, item.affixes.length);
      to = withAffixes(id, fresh);
      break;
    }
    default:
      return { ok: false, reason: "No such work" };
  }
  writeWire(next, req.target, to);
  return { ok: true, inventory: next, produced: [], changed: { from: id, to } };
}

function cantReason(kind: CraftKind, item: ResolvedItem): string {
  if (!isGearSlot(item.def.slot)) return "Only gear goes on the anvil";
  switch (kind) {
    case "temper":
      return "It can rise no further";
    case "enhance":
      return `Already at +${MAX_ENHANCE}`;
    case "imbue":
      return item.def.unique ? "A legendary takes no enchantment" : "It holds all the enchantment it can";
    case "reforge":
      return item.def.unique ? "A legendary can't be reforged" : "It has no enchantment to reforge";
    default:
      return "The forge refuses";
  }
}

/** Names for an outcome's message ("+1 Keen Ember Staff", "Healing Draught"). */
export function describeOutcome(out: Extract<CraftOutcome, { ok: true }>): string {
  if (out.changed) return resolveItem(out.changed.to).name;
  return out.produced.map((s) => (s.qty > 1 ? `${resolveItem(s.id).name} ×${s.qty}` : resolveItem(s.id).name)).join(", ");
}
