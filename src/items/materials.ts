import type { Rng } from "../core/rng";
import { biomeForFloor } from "../world/biomes";
import type { BiomeId } from "../world/types";

/** Where materials come from — the drop tables of the crafting loop. Pure,
 * shared by the floor authority (which rolls them) and the UI (which says
 * where to look for one).
 *
 * Three kinds of reagent:
 *  - BAND reagents grow in one depth band and nowhere else (Grave Moss only
 *    in the Catacombs, Brine Pearls only in the Drowned Halls…). Every
 *    draught needs Grave Moss and the forge wants each band's reagent for
 *    its own levels, so a deep wizard still strips down now and then and
 *    walks the shallow floors. That's the point.
 *  - CREATURE parts: each kind leaves its own (wisps an ember, slimes gel…),
 *    at any depth.
 *  - ESSENCES: arcane dust (salvaged from enchanted gear, now and then a
 *    lucky drop), riftglass (vaults, ward stones, Wardens — rare) and the
 *    Warden's Sigil (Wardens only). */

export const BAND_REAGENT: Record<BiomeId, string> = {
  catacombs: "grave_moss",
  drowned: "brine_pearl",
  forge: "cinder_iron",
  crystal: "singing_shard",
  hollow: "hollow_ash",
};

/** Which band a reagent grows in (for "where do I find this?" hints). */
export function bandOfReagent(materialId: string): BiomeId | null {
  for (const [band, id] of Object.entries(BAND_REAGENT)) if (id === materialId) return band as BiomeId;
  return null;
}

export function bandReagent(floor: number): string {
  return BAND_REAGENT[biomeForFloor(floor)];
}

export type MaterialSource = "wisp" | "slime" | "sentry" | "shadow" | "boss" | "prop";

const CREATURE_PART: Partial<Record<MaterialSource, string>> = {
  wisp: "wisp_ember",
  slime: "slime_gel",
  sentry: "sentry_core",
  shadow: "shadow_silk",
};

export interface MaterialDrop {
  id: string;
  qty: number;
}

/** Odds per kill/break — tuned so a floor of ~8 kills yields a handful of
 * reagents: enough to brew after a couple of runs, never a flood. */
export const MATERIAL_ODDS = {
  part: 0.5,
  band: 0.32,
  propBand: 0.2,
  arcaneDust: 0.03,
  riftglass: 0.005,
} as const;

/** What one kill (or broken prop) leaves behind. `lootMult` is the floor's
 * loot rule (omens). */
export function rollMaterialDrops(rng: Rng, source: MaterialSource, floor: number, lootMult = 1): MaterialDrop[] {
  const out: MaterialDrop[] = [];
  const add = (id: string, qty: number) => {
    const prev = out.find((d) => d.id === id);
    if (prev) prev.qty += qty;
    else out.push({ id, qty });
  };
  if (source === "boss") {
    add("warden_sigil", 1 + (rng.next() < 0.35 ? 1 : 0));
    add("riftglass", 1 + (rng.next() < 0.5 ? 1 : 0));
    add(bandReagent(floor), rng.int(3, 5));
    add("arcane_dust", rng.int(1, 3));
    return out;
  }
  const part = CREATURE_PART[source];
  if (part && rng.next() < MATERIAL_ODDS.part * lootMult) add(part, rng.next() < 0.15 ? 2 : 1);
  const bandOdds = source === "prop" ? MATERIAL_ODDS.propBand : MATERIAL_ODDS.band;
  if (rng.next() < bandOdds * lootMult) add(bandReagent(floor), rng.next() < 0.25 ? 2 : 1);
  if (source !== "prop" && rng.next() < MATERIAL_ODDS.arcaneDust * lootMult) add("arcane_dust", 1);
  // Riftglass grows a little likelier with depth, but stays a rare glint.
  if (source !== "prop" && rng.next() < (MATERIAL_ODDS.riftglass + floor * 0.0001) * lootMult) add("riftglass", 1);
  return out;
}
