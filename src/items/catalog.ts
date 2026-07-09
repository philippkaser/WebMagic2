import { PLAYER } from "../core/config";
import type { DerivedStats, Equipment, ItemDef, Slot } from "./types";

export const BASIC_STAFF_ID = "apprentice_staff";
export const BASIC_BOOTS_ID = "worn_boots";

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
];

const byId = new Map(defs.map((d) => [d.id, d]));

export function getItemDef(id: string): ItemDef {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown item def: ${id}`);
  return def;
}

export function allItemDefs(): readonly ItemDef[] {
  return defs;
}

export function lootPool(slot: Slot, floor: number): ItemDef[] {
  return defs.filter((d) => d.slot === slot && d.minFloor <= floor);
}

const BASE: DerivedStats = {
  maxHealth: PLAYER.maxHealth,
  speedMult: 1,
  manaRegenMult: 1,
  damageMult: 1,
  damageTakenMult: 1,
  aggroMult: 1,
  jump: "single",
  dash: false,
};

/** Fold every equipped item's passives into a single stat block. */
export function computeStats(equipment: Equipment): DerivedStats {
  const stats: DerivedStats = { ...BASE };
  const items = [equipment.staff, equipment.amulet, equipment.cloak, equipment.boots];
  for (const inst of items) {
    if (!inst) continue;
    const def = getItemDef(inst.defId);
    const p = def.passives;
    if (p) {
      stats.maxHealth += p.maxHealth ?? 0;
      stats.speedMult *= p.speedMult ?? 1;
      stats.manaRegenMult *= p.manaRegenMult ?? 1;
      stats.damageMult *= p.damageMult ?? 1;
      stats.damageTakenMult *= p.damageTakenMult ?? 1;
      stats.aggroMult *= p.aggroMult ?? 1;
    }
    if (def.jump) stats.jump = def.jump;
    if (def.dash) stats.dash = true;
  }
  return stats;
}
