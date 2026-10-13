import { hashSeed, type Rng } from "../core/rng";
import { BIOME_DEFS, biomeForFloor, getBiomeDef } from "../world/biomes";
import type { BiomeId } from "../world/types";

/** Where materials come from, and which one an item wants — the whole
 * vocabulary of the crafting loop, kept small on purpose. Pure, shared by
 * the floor authority (which rolls drops), the forge (which prices work)
 * and the UI (which says where to look).
 *
 * Seven materials, no more:
 *  - five BAND reagents, one per depth band, and on a floor the band's is
 *    the only one that drops (Grave Moss in the Catacombs, Brine Pearls in
 *    the Drowned Halls…). However deep you go, a floor hands you one kind.
 *  - RIFTGLASS: rare anywhere — vaults, ward stones, Wardens, salvage.
 *    Enhancement and enchantment run on it.
 *  - the WARDEN'S SIGIL: Wardens only; the Great Work wants three.
 *
 * Every piece of gear is ATTUNED to one band reagent — its own, picked by
 * its base and enchantments — and the forge works it with that and nothing
 * else (attunedReagent). So a deep wizard's fire-staff may still hunger for
 * Grave Moss, and back up to the Catacombs they go. Every draught is brewed
 * on Grave Moss too. That walk back up is the point. */

export const BAND_REAGENT: Record<BiomeId, string> = {
  catacombs: "grave_moss",
  drowned: "brine_pearl",
  forge: "cinder_iron",
  crystal: "singing_shard",
  hollow: "hollow_ash",
};

export const RIFTGLASS = "riftglass";
export const WARDEN_SIGIL = "warden_sigil";

/** Which band a reagent grows in (for "where do I find this?" hints). */
export function bandOfReagent(materialId: string): BiomeId | null {
  for (const [band, id] of Object.entries(BAND_REAGENT)) if (id === materialId) return band as BiomeId;
  return null;
}

/** The reagent that drops on this floor. */
export function bandReagent(floor: number): string {
  return BAND_REAGENT[biomeForFloor(floor)];
}

/** "the Catacombs, floors 1–9" — where a band reagent grows. */
export function whereItGrows(materialId: string): string | null {
  const band = bandOfReagent(materialId);
  if (!band) return null;
  const def = getBiomeDef(band);
  return `${def.name}, floors ${def.floors[0]}–${def.floors[1]}`;
}

/** The band reagent the forge works this item with. Each band the item's
 * level has reached gets a score from a hash of the item's base and
 * enchantments, and the best one wins — so two Ember Staffs with different
 * enchantments may want different things, a shallow item always wants a
 * shallow reagent, and tempering one deeper only ever switches it to the
 * newly reached band (if that band outscores the old favourite). */
export function attunedReagent(baseId: string, affixIds: readonly string[], level: number): string {
  const key = [baseId, ...[...affixIds].sort()].join("+");
  let best: BiomeId = "catacombs";
  let bestScore = -1;
  for (const def of BIOME_DEFS) {
    if (def.floors[0] > Math.max(1, level)) break;
    const score = hashSeed(`${key}|${def.id}`);
    if (score > bestScore) {
      bestScore = score;
      best = def.id;
    }
  }
  return BAND_REAGENT[best];
}

/** Who left it: an ordinary kill, a Warden, or a broken pot or crate. */
export type MaterialSource = "kill" | "boss" | "prop";

export interface MaterialDrop {
  id: string;
  qty: number;
}

/** Odds per kill/break — tuned so a floor of ~8 kills yields a few reagents:
 * enough to brew after a run or two, never a flood. Riftglass grows a hair
 * likelier with depth but stays a glint. */
export const MATERIAL_ODDS = {
  band: 0.35,
  propBand: 0.2,
  riftglass: 0.006,
  riftglassPerFloor: 0.0001,
} as const;

/** What one kill (or broken prop) leaves behind. `lootMult` is the floor's
 * loot rule (omens). */
export function rollMaterialDrops(rng: Rng, source: MaterialSource, floor: number, lootMult = 1): MaterialDrop[] {
  const reagent = bandReagent(floor);
  if (source === "boss") {
    return [
      { id: WARDEN_SIGIL, qty: 1 + (rng.next() < 0.35 ? 1 : 0) },
      { id: RIFTGLASS, qty: 1 + (rng.next() < 0.5 ? 1 : 0) },
      { id: reagent, qty: rng.int(3, 5) },
    ];
  }
  const out: MaterialDrop[] = [];
  const bandOdds = source === "prop" ? MATERIAL_ODDS.propBand : MATERIAL_ODDS.band;
  if (rng.next() < bandOdds * lootMult) out.push({ id: reagent, qty: rng.next() < 0.25 ? 2 : 1 });
  const glass = MATERIAL_ODDS.riftglass + floor * MATERIAL_ODDS.riftglassPerFloor;
  if (source === "kill" && rng.next() < glass * lootMult) out.push({ id: RIFTGLASS, qty: 1 });
  return out;
}
