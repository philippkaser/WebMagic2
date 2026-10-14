import type { Rng } from "../core/rng";
import type { GearSlot, Passives } from "./types";

/** Enchantment affixes — the rarity layer. An item carries up to two,
 * encoded in its id ("ember_staff+volatile+frenzied" → "Volatile Ember
 * Staff of Frenzy"): the first names it as a prefix, the second as a suffix.
 * Affixes are pure passive riders, folded into computeStats like a second
 * passives block, so adding one here is all it takes for it to drop,
 * display, bank, sell and replay.
 *
 * Two families:
 *  - BOONS: small, clean bonuses (Keen, Swift, Vigorous…).
 *  - MODS: they change how your magic behaves — bolts that ricochet, pierce
 *    or splinter, bigger blasts, glass-cannon damage — and every one of them
 *    costs something (mana, fire rate, toughness). A mod is a choice, not a
 *    strict upgrade, so two staffs from the same depth can play very
 *    differently.
 *
 * `slots` says where an affix may ROLL (a ricochet on boots means nothing).
 * Resolving an id never checks it, so items rolled under older rules keep
 * working. */

export interface AffixDef {
  id: string;
  /** Prefix form ("Volatile" → "Volatile Ember Staff"). */
  name: string;
  /** Suffix form, used when it's the item's second affix ("of Frenzy"). */
  suffix: string;
  /** What it gives, said plainly. */
  boon: string;
  /** What it costs (mods only). */
  bane?: string;
  /** boon · bane, for one-line displays. */
  desc: string;
  passives: Partial<Passives>;
  slots: readonly GearSlot[];
  /** Relative roll weight among the affixes a slot can take. */
  weight: number;
}

const ALL: readonly GearSlot[] = ["staff", "amulet", "cloak", "boots"];
const WORN: readonly GearSlot[] = ["amulet", "cloak", "boots"];
const CASTING: readonly GearSlot[] = ["staff", "amulet"];
const STAFF: readonly GearSlot[] = ["staff"];

type AffixRow = Omit<AffixDef, "desc">;

const rows: AffixRow[] = [
  // ── Boons ─────────────────────────────────────────────────────────────────
  { id: "swift", name: "Swift", suffix: "of Swiftness", boon: "+8% movement speed", passives: { speedMult: 1.08 }, slots: WORN, weight: 3 },
  { id: "vigorous", name: "Vigorous", suffix: "of Vigor", boon: "+25 max health", passives: { maxHealth: 25 }, slots: ALL, weight: 3 },
  { id: "keen", name: "Keen", suffix: "of Keenness", boon: "+12% spell damage", passives: { damageMult: 1.12 }, slots: ALL, weight: 3 },
  { id: "focused", name: "Focused", suffix: "of Focus", boon: "+30% mana regeneration", passives: { manaRegenMult: 1.3 }, slots: ALL, weight: 3 },
  { id: "warded", name: "Warded", suffix: "of Warding", boon: "-10% damage taken", passives: { damageTakenMult: 0.9 }, slots: WORN, weight: 3 },
  { id: "veiled", name: "Veiled", suffix: "of Veils", boon: "-25% enemy notice range", passives: { aggroMult: 0.75 }, slots: WORN, weight: 2 },
  { id: "seeking", name: "Seeking", suffix: "of Seeking", boon: "+30% projectile homing", passives: { homing: 0.3 }, slots: CASTING, weight: 2 },
  { id: "hasty", name: "Hasty", suffix: "of Haste", boon: "+15% fire rate", passives: { fireRateMult: 1.15 }, slots: CASTING, weight: 3 },
  { id: "twinned", name: "Twinned", suffix: "of Twins", boon: "+1 projectile per cast", passives: { extraProjectiles: 1 }, slots: CASTING, weight: 1 },

  // ── Mods: they change how magic behaves, and cost something ──────────────
  {
    id: "ricochet",
    name: "Ricocheting",
    suffix: "of Ricochets",
    boon: "Bolts ricochet off walls twice",
    bane: "+20% mana cost",
    passives: { bounces: 2, manaCostMult: 1.2 },
    slots: STAFF,
    weight: 2,
  },
  {
    id: "piercing",
    name: "Piercing",
    suffix: "of Piercing",
    boon: "Bolts pass through 2 foes",
    bane: "-10% spell damage",
    passives: { pierce: 2, damageMult: 0.9 },
    slots: STAFF,
    weight: 2,
  },
  {
    id: "volatile",
    name: "Volatile",
    suffix: "of Ruin",
    boon: "+60% blast radius",
    bane: "-15% fire rate",
    passives: { blastRadiusMult: 1.6, fireRateMult: 0.85 },
    slots: CASTING,
    weight: 2,
  },
  {
    id: "splintering",
    name: "Splintering",
    suffix: "of Splinters",
    boon: "Bolts burst into 3 shards",
    bane: "+25% mana cost",
    passives: { splitShards: 3, manaCostMult: 1.25 },
    slots: STAFF,
    weight: 2,
  },
  {
    id: "overcharged",
    name: "Overcharged",
    suffix: "of Overcharge",
    boon: "+40% spell damage",
    bane: "+45% mana cost",
    passives: { damageMult: 1.4, manaCostMult: 1.45 },
    slots: CASTING,
    weight: 2,
  },
  {
    id: "ponderous",
    name: "Ponderous",
    suffix: "of Weight",
    boon: "+35% spell damage, +50% knockback",
    bane: "-25% projectile speed",
    passives: { damageMult: 1.35, knockbackMult: 1.5, projectileSpeedMult: 0.75 },
    slots: STAFF,
    weight: 2,
  },
  {
    id: "streaking",
    name: "Streaking",
    suffix: "of the Comet",
    boon: "+60% projectile speed",
    bane: "-8% spell damage",
    passives: { projectileSpeedMult: 1.6, damageMult: 0.92 },
    slots: STAFF,
    weight: 2,
  },
  {
    id: "frenzied",
    name: "Frenzied",
    suffix: "of Frenzy",
    boon: "+35% fire rate",
    bane: "+35% mana cost",
    passives: { fireRateMult: 1.35, manaCostMult: 1.35 },
    slots: CASTING,
    weight: 2,
  },
  {
    id: "arcing",
    name: "Arcing",
    suffix: "of Arcs",
    boon: "Hits arc on to 1 more foe",
    bane: "+15% mana cost",
    passives: { chain: 1, manaCostMult: 1.15 },
    slots: CASTING,
    weight: 2,
  },
  {
    id: "frugal",
    name: "Frugal",
    suffix: "of Thrift",
    boon: "-30% mana cost",
    bane: "-15% spell damage",
    passives: { manaCostMult: 0.7, damageMult: 0.85 },
    slots: CASTING,
    weight: 2,
  },
  {
    id: "glass",
    name: "Glass",
    suffix: "of Glass",
    boon: "+45% spell damage",
    bane: "+30% damage taken",
    passives: { damageMult: 1.45, damageTakenMult: 1.3 },
    slots: CASTING,
    weight: 1,
  },
  {
    id: "leeching",
    name: "Leeching",
    suffix: "of the Leech",
    boon: "Heal 4% of damage dealt",
    bane: "-15 max health",
    passives: { lifesteal: 0.04, maxHealth: -15 },
    slots: CASTING,
    weight: 2,
  },
  {
    id: "bloodbound",
    name: "Bloodbound",
    suffix: "of Blood",
    boon: "+60 max health",
    bane: "-35% mana regeneration",
    passives: { maxHealth: 60, manaRegenMult: 0.65 },
    slots: WORN,
    weight: 2,
  },
  {
    id: "zealous",
    name: "Zealous",
    suffix: "of Zeal",
    boon: "+22% movement speed",
    bane: "+15% damage taken",
    passives: { speedMult: 1.22, damageTakenMult: 1.15 },
    slots: ["cloak", "boots"],
    weight: 2,
  },
  {
    id: "ascetic",
    name: "Ascetic",
    suffix: "of the Ascetic",
    boon: "+80% mana regeneration",
    bane: "-25 max health",
    passives: { manaRegenMult: 1.8, maxHealth: -25 },
    slots: ["amulet", "cloak"],
    weight: 2,
  },
];

const defs: AffixDef[] = rows.map((r) => ({ ...r, desc: r.bane ? `${r.boon} · ${r.bane}` : r.boon }));
const byId = new Map(defs.map((d) => [d.id, d]));

export function getAffixDef(id: string): AffixDef {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown affix: ${id}`);
  return def;
}

export function allAffixDefs(): readonly AffixDef[] {
  return defs;
}

/** The affixes that may roll on a slot. */
export function affixPool(slot: GearSlot): AffixDef[] {
  return defs.filter((d) => d.slots.includes(slot));
}

/** Roll `count` distinct affixes for a slot (weighted; fewer if the pool runs
 * out). `exclude` keeps an item's existing affixes from rolling again. */
export function rollAffixIds(rng: Rng, slot: GearSlot, count: number, exclude: readonly string[] = []): string[] {
  const pool = affixPool(slot).filter((d) => !exclude.includes(d.id));
  const out: string[] = [];
  while (out.length < count && pool.length > 0) {
    const total = pool.reduce((s, d) => s + d.weight, 0);
    let r = rng.next() * total;
    let pick = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i]!.weight;
      if (r <= 0) {
        pick = i;
        break;
      }
    }
    out.push(pool[pick]!.id);
    pool.splice(pick, 1);
  }
  return out;
}

/** UI hue for anything enchanted (names, cell markers) — kept for the old
 * call sites; items/rarity.ts has the full scale. */
export const ENCHANT_COLOR = "#c9a5ff";
