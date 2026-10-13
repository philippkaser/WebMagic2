import { PLAYER } from "../core/config";
import { getAffixDef, type AffixDef } from "./affixes";
import { MAX_AFFIXES, splitItemId } from "./itemId";
import {
  amplifyPassives,
  effectiveLevel,
  enhancePotency,
  enhanceWard,
  gearWard,
  staffPotency,
} from "./power";
import { rarityOf, type Rarity } from "./rarity";
import { foldPassives, neutralPassives } from "./stats";
import { isGearSlot, type DerivedStats, type Equipment, type ItemDef, type Passives, type ProcId, type Slot } from "./types";

export const BASIC_STAFF_ID = "apprentice_staff";
export const BASIC_BOOTS_ID = "worn_boots";
export const SAVE_FEATHER_ID = "save_feather";

const defs: ItemDef[] = [
  // ── Staffs ────────────────────────────────────────────────────────────────
  {
    id: "apprentice_staff",
    slot: "staff",
    name: "Apprentice Staff",
    tier: 1,
    minFloor: 1,
    color: "#7fd4ff",
    desc: "Bolt / Force Blast",
    primary: "bolt",
    secondary: "blast",
  },
  {
    id: "ember_staff",
    slot: "staff",
    name: "Ember Staff",
    tier: 2,
    minFloor: 2,
    color: "#ff8b3d",
    desc: "Ember Scatter / Force Blast",
    primary: "scatter",
    secondary: "blast",
  },
  {
    id: "arc_staff",
    slot: "staff",
    name: "Arc Staff",
    tier: 2,
    minFloor: 3,
    color: "#b7f74f",
    desc: "Rapid Arcs / Shockwave",
    primary: "rapid",
    secondary: "shockwave",
  },
  {
    id: "void_staff",
    slot: "staff",
    name: "Staff of the Hollow",
    tier: 3,
    minFloor: 6,
    color: "#c86bff",
    desc: "Void Lance / Force Blast",
    primary: "lance",
    secondary: "blast",
  },
  {
    id: "seeker_staff",
    slot: "staff",
    name: "Seeker's Wand",
    tier: 2,
    minFloor: 3,
    color: "#4fe0c0",
    desc: "Bolt / Force Blast — bolts seek",
    primary: "bolt",
    secondary: "blast",
    passives: { homing: 0.5 },
  },
  {
    id: "splinter_staff",
    slot: "staff",
    name: "Splinterstaff",
    tier: 2,
    minFloor: 4,
    color: "#ffd24a",
    desc: "Twin Bolt / Shockwave",
    primary: "bolt",
    secondary: "shockwave",
    passives: { extraProjectiles: 1 },
  },
  {
    id: "voidcore_staff",
    slot: "staff",
    name: "Singularity Staff",
    tier: 3,
    minFloor: 8,
    color: "#a06bff",
    desc: "Void Seed / Collapse — plant seeds, then implode them into black holes",
    primary: "voidseed",
    secondary: "collapse",
  },
  // Archetypes beyond the bolt: a staff is a weapon class. The Ember is the
  // shotgun, the Arc the machine gun, the Hollow the rifle, the Singularity
  // remote charges — and these:
  {
    id: "prism_staff",
    slot: "staff",
    name: "Prism Staff",
    tier: 2,
    minFloor: 5,
    color: "#ff6ad5",
    desc: "Prism Ray / Force Blast — hold a searing beam",
    primary: "beam",
    secondary: "blast",
  },
  {
    id: "thunder_rod",
    slot: "staff",
    name: "Thunder Rod",
    tier: 2,
    minFloor: 6,
    color: "#9fe8ff",
    desc: "Forked Lightning / Shockwave — lightning leaps foe to foe",
    primary: "chainbolt",
    secondary: "shockwave",
  },
  {
    id: "cinder_censer",
    slot: "staff",
    name: "Cinder Censer",
    tier: 2,
    minFloor: 4,
    color: "#ff7a2e",
    desc: "Dragon's Breath / Force Blast — a cone of fire up close",
    primary: "flame",
    secondary: "blast",
  },
  {
    id: "siege_rod",
    slot: "staff",
    name: "Siege Rod",
    tier: 2,
    minFloor: 7,
    color: "#ffd27a",
    desc: "Siege Shell / Shockwave — lob shells that burst wide",
    primary: "mortar",
    secondary: "shockwave",
  },
  {
    id: "starpiercer",
    slot: "staff",
    name: "Starpiercer",
    tier: 3,
    minFloor: 12,
    color: "#e8f0ff",
    desc: "Starpierce / Force Blast — a lance of light through everything in its line",
    primary: "rail",
    secondary: "blast",
  },
  // ── Legendaries ───────────────────────────────────────────────────────────
  // Named, never enchanted, each with a power of its own (weapons/procs.ts).
  // They drop from the Warden, vault chests and the forge's great work.
  {
    id: "stormcaller",
    slot: "staff",
    name: "Stormcaller",
    tier: 3,
    minFloor: 10,
    color: "#7fdcff",
    desc: "Forked Lightning / Thunderclap — your hits call the storm down",
    primary: "chainbolt",
    secondary: "thunderclap",
    unique: true,
    proc: "stormcall",
    dropWeight: 0.25,
  },
  {
    id: "wardens_key",
    slot: "staff",
    name: "The Warden's Key",
    tier: 3,
    minFloor: 10,
    color: "#ffcf6a",
    desc: "Bolt / Force Blast — every fifth cast unlocks a void lance",
    primary: "bolt",
    secondary: "blast",
    unique: true,
    proc: "wardenkey",
    passives: { damageMult: 1.15 },
    dropWeight: 0.25,
  },
  {
    id: "ouroboros",
    slot: "staff",
    name: "Ouroboros Coil",
    tier: 3,
    minFloor: 14,
    color: "#7dff9a",
    desc: "Prism Ray / Shockwave — the beam drinks what it burns",
    primary: "beam",
    secondary: "shockwave",
    unique: true,
    passives: { lifesteal: 0.07 },
    proc: "echo",
    dropWeight: 0.2,
  },
  {
    id: "gravewhisper",
    slot: "staff",
    name: "Gravewhisper",
    tier: 3,
    minFloor: 8,
    color: "#b8a6ff",
    desc: "Ember Scatter / Force Blast — the slain shed homing soul-shards",
    primary: "scatter",
    secondary: "blast",
    unique: true,
    proc: "soulshards",
    dropWeight: 0.25,
  },
  // ── Amulets ───────────────────────────────────────────────────────────────
  {
    id: "amulet_vigor",
    slot: "amulet",
    name: "Amulet of Vigor",
    tier: 1,
    minFloor: 1,
    color: "#ff5d5d",
    desc: "+40 max health",
    passives: { maxHealth: 40 },
  },
  {
    id: "amulet_focus",
    slot: "amulet",
    name: "Amulet of Focus",
    tier: 1,
    minFloor: 1,
    color: "#5db9ff",
    desc: "+70% mana regeneration",
    passives: { manaRegenMult: 1.7 },
  },
  {
    id: "amulet_swift",
    slot: "amulet",
    name: "Amulet of the Gale",
    tier: 2,
    minFloor: 3,
    color: "#a8ffe3",
    desc: "+15% movement speed",
    passives: { speedMult: 1.15 },
  },
  {
    id: "amulet_fury",
    slot: "amulet",
    name: "Amulet of Fury",
    tier: 2,
    minFloor: 4,
    color: "#ffb13d",
    desc: "+30% spell damage",
    passives: { damageMult: 1.3 },
  },
  {
    id: "amulet_seeker",
    slot: "amulet",
    name: "Amulet of the Seeker",
    tier: 2,
    minFloor: 4,
    color: "#4fe0c0",
    desc: "+45% projectile homing",
    passives: { homing: 0.45 },
  },
  {
    id: "amulet_haste",
    slot: "amulet",
    name: "Amulet of Haste",
    tier: 2,
    minFloor: 4,
    color: "#ffe08a",
    desc: "+22% fire rate",
    passives: { fireRateMult: 1.22 },
  },
  {
    id: "amulet_multi",
    slot: "amulet",
    name: "Amulet of Multiplicity",
    tier: 3,
    minFloor: 6,
    color: "#c9a5ff",
    desc: "+1 projectile per cast",
    passives: { extraProjectiles: 1 },
  },
  {
    id: "phoenix_heart",
    slot: "amulet",
    name: "Heart of the Phoenix",
    tier: 3,
    minFloor: 9,
    color: "#ff8a3d",
    desc: "Once a floor, a killing blow is refused — you burst into flame instead",
    passives: { maxHealth: 20 },
    unique: true,
    proc: "phoenix",
    dropWeight: 0.25,
  },
  {
    id: "bloodstone",
    slot: "amulet",
    name: "Bloodstone Pact",
    tier: 3,
    minFloor: 12,
    color: "#d12a3c",
    desc: "+25% spell damage — with your mana spent, spells draw on your blood",
    passives: { damageMult: 1.25 },
    unique: true,
    proc: "bloodpact",
    dropWeight: 0.2,
  },
  // ── Cloaks ────────────────────────────────────────────────────────────────
  {
    id: "cloak_warden",
    slot: "cloak",
    name: "Warden's Cloak",
    tier: 1,
    minFloor: 1,
    color: "#8f9fb8",
    desc: "-20% damage taken",
    passives: { damageTakenMult: 0.8 },
  },
  {
    id: "cloak_shadow",
    slot: "cloak",
    name: "Shadowweave Cloak",
    tier: 1,
    minFloor: 2,
    color: "#5a4d7a",
    desc: "Enemies notice you later",
    passives: { aggroMult: 0.55 },
  },
  {
    id: "cloak_blink",
    slot: "cloak",
    name: "Cloak of Blinking",
    tier: 2,
    minFloor: 4,
    color: "#e3c8ff",
    desc: "Shift: blink-dash",
    dash: true,
  },
  {
    id: "mantle_echoes",
    slot: "cloak",
    name: "Mantle of Echoes",
    tier: 3,
    minFloor: 12,
    color: "#d6c8ff",
    desc: "Shift: blink-dash — and every spell you cast rings out twice",
    dash: true,
    unique: true,
    proc: "echo",
    dropWeight: 0.2,
  },
  // ── Boots ─────────────────────────────────────────────────────────────────
  {
    id: "worn_boots",
    slot: "boots",
    name: "Worn Boots",
    tier: 1,
    minFloor: 1,
    color: "#a1794f",
    desc: "Plain, dependable",
    jump: "single",
  },
  {
    id: "boots_springheel",
    slot: "boots",
    name: "Springheel Boots",
    tier: 1,
    minFloor: 2,
    color: "#7fe08a",
    desc: "Double jump",
    jump: "double",
  },
  {
    id: "boots_hover",
    slot: "boots",
    name: "Boots of Hovering",
    tier: 2,
    minFloor: 4,
    color: "#8fd0ff",
    desc: "Hold Space to hover",
    jump: "hover",
  },
  {
    id: "boots_three_winds",
    slot: "boots",
    name: "Boots of the Three Winds",
    tier: 3,
    minFloor: 9,
    color: "#bff6ff",
    desc: "Triple jump, +12% movement speed",
    jump: "triple",
    passives: { speedMult: 1.12 },
    unique: true,
    dropWeight: 0.25,
  },
  // ── Consumables ───────────────────────────────────────────────────────────
  // Spent on use (Q/E). Potions drop in the dungeon and sell at the village
  // merchant; feathers are the merchant's premium ware (the boss drops them
  // too). Balance note: prices are deliberately steep — gold has to compete
  // with "one more floor" to matter.
  {
    id: "potion_hp_weak",
    slot: "consumable",
    name: "Weak Healing Draught",
    tier: 1,
    minFloor: 2,
    color: "#ff5d6e",
    desc: "Restores 40 health",
    consumable: { heal: 40 },
    maxStack: 5,
  },
  {
    id: "potion_mp_weak",
    slot: "consumable",
    name: "Weak Mana Draught",
    tier: 1,
    minFloor: 2,
    color: "#4f9dff",
    desc: "Restores 60 mana",
    consumable: { mana: 60 },
    maxStack: 5,
  },
  {
    id: "potion_hp",
    slot: "consumable",
    name: "Healing Draught",
    tier: 2,
    minFloor: 12,
    color: "#ff3d58",
    desc: "Restores 100 health",
    consumable: { heal: 100 },
    maxStack: 5,
    dropWeight: 0.6,
  },
  {
    id: "potion_mp",
    slot: "consumable",
    name: "Mana Draught",
    tier: 2,
    minFloor: 12,
    color: "#3d7dff",
    desc: "Restores all mana",
    consumable: { mana: 100 },
    maxStack: 5,
    dropWeight: 0.6,
  },
  // Elixirs: brewed at Wenna's cauldron (items/crafting.ts); the deep hands
  // one out now and then. Their blessings are timed (items/buffs.ts).
  {
    id: "elixir_haste",
    slot: "consumable",
    name: "Elixir of Haste",
    tier: 2,
    minFloor: 6,
    color: "#ffe36a",
    desc: "For 30 s: +30% fire rate, +15% movement speed",
    consumable: { buff: "haste" },
    maxStack: 3,
    dropWeight: 0.2,
  },
  {
    id: "elixir_ironskin",
    slot: "consumable",
    name: "Elixir of Ironskin",
    tier: 2,
    minFloor: 6,
    color: "#a8b4c8",
    desc: "For 30 s: -40% damage taken",
    consumable: { buff: "ironskin" },
    maxStack: 3,
    dropWeight: 0.2,
  },
  {
    id: "elixir_fury",
    slot: "consumable",
    name: "Elixir of Fury",
    tier: 2,
    minFloor: 8,
    color: "#ff6a3d",
    desc: "For 30 s: +35% spell damage",
    consumable: { buff: "fury" },
    maxStack: 3,
    dropWeight: 0.2,
  },
  {
    id: "elixir_clarity",
    slot: "consumable",
    name: "Elixir of Clarity",
    tier: 2,
    minFloor: 8,
    color: "#8ff0ff",
    desc: "For 25 s: spells cost half the mana",
    consumable: { buff: "clarity" },
    maxStack: 3,
    dropWeight: 0.2,
  },
  {
    id: SAVE_FEATHER_ID,
    slot: "consumable",
    name: "Feather of Safe Passage",
    tier: 2,
    minFloor: 8,
    color: "#ffe9a8",
    desc: "Vanish to the village, keeping your loot",
    dropWeight: 0.15, // dungeon drops are a lucky find, not a supply line
    consumable: { escape: true },
    maxStack: 2,
  },
  // ── Materials ─────────────────────────────────────────────────────────────
  // Seven, no more (items/materials.ts): each depth band grows one reagent
  // and drops nothing else, plus rare riftglass and the Wardens' sigils.
  // They ride in the reagent pouch, vanish on death like any run loot, and
  // are spent at Wenna's cauldron and Brannoc's forge (items/crafting.ts).
  material("grave_moss", "Grave Moss", 1, 1, "#7f9a52", "Pale moss off the Catacombs' tombs — the root of every draught"),
  material("brine_pearl", "Brine Pearl", 1, 10, "#7fd8d0", "A pearl grown in the Drowned Halls' black water"),
  material("cinder_iron", "Cinder Iron", 1, 20, "#d0703a", "Iron that never cooled, from the Ember Forge"),
  material("singing_shard", "Singing Shard", 2, 35, "#b8a0ff", "A splinter of the Crystal Deep; it hums when held"),
  material("hollow_ash", "Hollow Ash", 2, 55, "#d8d4c8", "Ash from the Hollow, where nothing burns"),
  material("riftglass", "Riftglass", 3, 1, "#46ffd0", "A shard of the rift itself — rare, and the forge's finest work runs on it"),
  material("warden_sigil", "Warden's Sigil", 3, 10, "#ffcf6a", "Torn from a fallen Warden; the forge's great work needs them"),
];

function material(id: string, name: string, tier: 1 | 2 | 3, minFloor: number, color: string, desc: string): ItemDef {
  return { id, slot: "material", name, tier, minFloor, color, desc, maxStack: 99 };
}

const byId = new Map(defs.map((d) => [d.id, d]));

/** Base definition for an item id. Accepts full owned-item ids — an affix
 * suffix ("ember_staff+keen") is ignored here; use resolveItem() when the
 * enchantment matters (names, stats, values). */
export function getItemDef(id: string): ItemDef {
  const def = byId.get(splitItemId(id).baseId);
  if (!def) throw new Error(`Unknown item def: ${id}`);
  return def;
}

/** An owned item, fully understood: base def + enchantments + level +
 * enhancement + rarity + display name. Throws on an unknown base or affix,
 * a malformed id, a level/affix/enhancement where none may be, or too many
 * affixes — so it doubles as id validation. */
export interface ResolvedItem {
  itemId: string;
  def: ItemDef;
  /** Enchantments, first one names the item. */
  affixes: AffixDef[];
  /** Effective item level (explicit, or legacy fallback); 0 for consumables
   * and materials. */
  level: number;
  /** Forge enhancement, 0…MAX_ENHANCE. */
  enhance: number;
  rarity: Rarity;
  name: string;
}

export function resolveItem(itemId: string): ResolvedItem {
  const { baseId, affixIds, level, enhance, wellFormed } = splitItemId(itemId);
  const def = byId.get(baseId);
  if (!def) throw new Error(`Unknown item def: ${itemId}`);
  if (!wellFormed) throw new Error(`Malformed item id: ${itemId}`);
  const gear = isGearSlot(def.slot);
  if (!gear && (level !== null || enhance > 0 || affixIds.length > 0)) {
    throw new Error(`Only gear carries levels, affixes or enhancement: ${itemId}`);
  }
  if (def.unique && affixIds.length > 0) throw new Error(`Legendaries are never enchanted: ${itemId}`);
  if (affixIds.length > MAX_AFFIXES) throw new Error(`Too many enchantments: ${itemId}`);
  const affixes = affixIds.map(getAffixDef);
  return {
    itemId,
    def,
    affixes,
    level: effectiveLevel(def, level),
    enhance,
    rarity: rarityOf(def, affixes.length),
    name: itemName(def, affixes, enhance),
  };
}

/** "+3 Volatile Ember Staff of Frenzy": the enhancement, the first affix as
 * a prefix, the second as a suffix. */
export function itemName(def: ItemDef, affixes: readonly AffixDef[], enhance = 0): string {
  let name = def.name;
  if (affixes[0]) name = `${affixes[0].name} ${name}`;
  if (affixes[1]) name = `${name} ${affixes[1].suffix}`;
  if (enhance > 0) name = `+${enhance} ${name}`;
  return name;
}

/** The passive blocks an item contributes: its base passives and each
 * affix's, with the enhancement's amplification applied to the boons. */
export function itemPassives(item: ResolvedItem): Partial<Passives>[] {
  const blocks: Partial<Passives>[] = [];
  if (item.def.passives) blocks.push(amplifyPassives(item.def.passives, item.enhance));
  for (const a of item.affixes) blocks.push(amplifyPassives(a.passives, item.enhance));
  return blocks;
}

/** One-line "what is it" for prompts: its enchantments' boons and banes,
 * then its own description. */
export function itemSummary(item: ResolvedItem): string {
  return [...item.affixes.map((a) => a.desc), item.def.desc].filter(Boolean).join(" · ");
}

/** True for gear (anything that can carry a level, affixes, enhancement). */
export function isGear(item: ResolvedItem): boolean {
  return isGearSlot(item.def.slot);
}

export function allItemDefs(): readonly ItemDef[] {
  return defs;
}

/** What may drop on `floor` in a slot. Legendaries never roll from the
 * common pools (see uniquePool), materials have their own tables
 * (items/materials.ts). */
export function lootPool(slot: Slot, floor: number): ItemDef[] {
  return defs.filter((d) => d.slot === slot && d.minFloor <= floor && !d.unique);
}

/** The legendaries a boss, vault or the forge's great work can yield here. */
export function uniquePool(floor: number): ItemDef[] {
  return defs.filter((d) => d.unique && d.minFloor <= floor);
}

/** Stack cap for an item id (gear never stacks). */
export function maxStackOf(id: string): number {
  return getItemDef(id).maxStack ?? 1;
}

function baseStats(): DerivedStats {
  return { ...neutralPassives(), maxHealth: PLAYER.maxHealth, jump: "single", dash: false, procs: [] };
}

/** Fold every equipped item's passives (base AND affixes, amplified by its
 * enhancement), its level's power (staff potency, gear ward) and its
 * enhancement's raw power (items/power.ts) into one stat block. Timed
 * blessings fold in on top (items/buffs.ts → state/gameStore getStats). */
export function computeStats(equipment: Equipment): DerivedStats {
  const stats = baseStats();
  const items = [equipment.staff, equipment.amulet, equipment.cloak, equipment.boots];
  for (const inst of items) {
    if (!inst) continue;
    const item = resolveItem(inst.defId);
    if (item.def.slot === "staff") {
      stats.damageMult *= staffPotency(item.level) * enhancePotency(item.enhance);
    } else {
      stats.maxHealth += gearWard(item.level) + enhanceWard(item.enhance);
    }
    for (const p of itemPassives(item)) foldPassives(stats, p);
    const jump = item.def.jump;
    if (jump && JUMP_RANK[jump] > JUMP_RANK[stats.jump]) stats.jump = jump;
    if (item.def.dash) stats.dash = true;
    if (item.def.proc && !stats.procs.includes(item.def.proc)) stats.procs.push(item.def.proc);
  }
  return stats;
}

const JUMP_RANK = { single: 0, double: 1, hover: 2, triple: 3 } as const;

/** Does this kit carry a legendary power? */
export function hasProc(stats: Pick<DerivedStats, "procs">, proc: ProcId): boolean {
  return stats.procs.includes(proc);
}
