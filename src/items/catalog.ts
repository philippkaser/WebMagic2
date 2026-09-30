import type { ItemDef, Slot } from "./types";

/** Every item template in the game. Pure data: a new staff, amulet, cloak or
 * pair of boots is one entry here (a new spell is one entry in
 * combat/abilities.ts, referenced by id). */

export const BASIC_STAFF_ID = "apprentice_staff";
export const BASIC_BOOTS_ID = "worn_boots";

const defs: ItemDef[] = [
  // ── Staffs ────────────────────────────────────────────────────────────────
  {
    id: "apprentice_staff",
    slot: "staff",
    name: "Apprentice Staff",
    minFloor: 1,
    color: "#7fd4ff",
    desc: "Bolt / Force Blast",
    lore: "Cut from the village ash. Every wizard's first lie to the dark.",
    primary: "bolt",
    secondary: "blast",
  },
  {
    id: "ember_staff",
    slot: "staff",
    name: "Ember Staff",
    minFloor: 2,
    color: "#ff8b3d",
    desc: "Ember Scatter / Force Blast",
    lore: "Still warm. It remembers the forge-priests who bled into it.",
    primary: "scatter",
    secondary: "blast",
  },
  {
    id: "arc_staff",
    slot: "staff",
    name: "Arc Staff",
    minFloor: 3,
    color: "#b7f74f",
    desc: "Rapid Arcs / Shockwave",
    lore: "A storm was folded seven times and nailed inside the wood.",
    primary: "rapid",
    secondary: "shockwave",
  },
  {
    id: "gravewood_staff",
    slot: "staff",
    name: "Gravewood Staff",
    minFloor: 5,
    color: "#7affb0",
    desc: "Ricochet / Gravity Well",
    lore: "Grown over a mass grave. Its bolts refuse to stay dead.",
    primary: "ricochet",
    secondary: "gravity",
  },
  {
    id: "void_staff",
    slot: "staff",
    name: "Staff of the Hollow",
    minFloor: 6,
    weight: 0.7,
    color: "#c86bff",
    desc: "Void Lance / Force Blast",
    lore: "Hollow all the way through. Something on the other end looks back.",
    primary: "lance",
    secondary: "blast",
  },
  {
    id: "starfall_staff",
    slot: "staff",
    name: "Starfall Scepter",
    minFloor: 12,
    weight: 0.5,
    color: "#ffe27a",
    desc: "Arc Bolts / Meteor",
    lore: "Pull, and the sky remembers it owes the earth a star.",
    primary: "rapid",
    secondary: "meteor",
  },
  // ── Amulets ───────────────────────────────────────────────────────────────
  {
    id: "amulet_vigor",
    slot: "amulet",
    name: "Amulet of Vigor",
    minFloor: 1,
    color: "#ff5d5d",
    desc: "+40 max health",
    lore: "A heart-stone that beats a half-step behind your own.",
    passives: { maxHealth: 40 },
  },
  {
    id: "amulet_focus",
    slot: "amulet",
    name: "Amulet of Focus",
    minFloor: 1,
    color: "#5db9ff",
    desc: "+70% mana regeneration",
    lore: "The still eye of a drowned oracle, set in tin.",
    passives: { manaRegenMult: 1.7 },
  },
  {
    id: "amulet_swift",
    slot: "amulet",
    name: "Amulet of the Gale",
    minFloor: 3,
    color: "#a8ffe3",
    desc: "+15% movement speed",
    lore: "Whistles when you run. Screams when you don't.",
    passives: { speedMult: 1.15 },
  },
  {
    id: "amulet_fury",
    slot: "amulet",
    name: "Amulet of Fury",
    minFloor: 4,
    color: "#ffb13d",
    desc: "+30% spell damage",
    lore: "Worn by the last of the Red Choir. It kept the anger, not the song.",
    passives: { damageMult: 1.3 },
  },
  {
    id: "amulet_moth",
    slot: "amulet",
    name: "Moth-Queen's Locket",
    minFloor: 8,
    weight: 0.6,
    color: "#e8d9a8",
    desc: "+20% damage, +40% mana regen, -20 health",
    lore: "Open it and something flutters out. Close it before it comes back.",
    passives: { damageMult: 1.2, manaRegenMult: 1.4, maxHealth: -20 },
  },
  // ── Cloaks ────────────────────────────────────────────────────────────────
  {
    id: "cloak_warden",
    slot: "cloak",
    name: "Warden's Cloak",
    minFloor: 1,
    color: "#8f9fb8",
    desc: "-20% damage taken",
    lore: "Stitched from the banners of a keep that never fell. Until it did.",
    passives: { damageTakenMult: 0.8 },
  },
  {
    id: "cloak_shadow",
    slot: "cloak",
    name: "Shadowweave Cloak",
    minFloor: 2,
    color: "#5a4d7a",
    desc: "Enemies notice you later",
    lore: "Woven at midnight from the shadows of sleeping cats.",
    passives: { aggroMult: 0.55 },
  },
  {
    id: "cloak_blink",
    slot: "cloak",
    name: "Cloak of Blinking",
    minFloor: 4,
    color: "#e3c8ff",
    desc: "Shift: blink-dash",
    lore: "Its hem is always a moment ahead of you.",
    dash: true,
  },
  {
    id: "cloak_ember",
    slot: "cloak",
    name: "Ashen Mantle",
    minFloor: 9,
    weight: 0.6,
    color: "#ff7a4d",
    desc: "Shift: blink-dash, -10% damage taken",
    lore: "Smells of cinders and a promise someone meant to keep.",
    dash: true,
    passives: { damageTakenMult: 0.9 },
  },
  // ── Boots ─────────────────────────────────────────────────────────────────
  {
    id: "worn_boots",
    slot: "boots",
    name: "Worn Boots",
    minFloor: 1,
    color: "#a1794f",
    desc: "Plain, dependable",
    lore: "They've walked into the dungeon before. They'd rather not again.",
    jump: "single",
  },
  {
    id: "boots_springheel",
    slot: "boots",
    name: "Springheel Boots",
    minFloor: 2,
    color: "#7fe08a",
    desc: "Double jump",
    lore: "Soled with frog-gut and optimism.",
    jump: "double",
  },
  {
    id: "boots_hover",
    slot: "boots",
    name: "Boots of Hovering",
    minFloor: 4,
    color: "#8fd0ff",
    desc: "Hold Space to hover",
    lore: "The ground forgets you, a little, while you wear them.",
    jump: "hover",
  },
  {
    id: "boots_stride",
    slot: "boots",
    name: "Pilgrim's Stride",
    minFloor: 7,
    weight: 0.7,
    color: "#d9c27a",
    desc: "Double jump, +10% movement speed",
    lore: "They walked to the bottom once. They know the way.",
    jump: "double",
    passives: { speedMult: 1.1 },
  },
];

const byId = new Map(defs.map((d) => [d.id, d]));

export function getItemDef(id: string): ItemDef {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown item def: ${id}`);
  return def;
}

export function hasItemDef(id: string): boolean {
  return byId.has(id);
}

export function allItemDefs(): readonly ItemDef[] {
  return defs;
}

export function lootPool(slot: Slot, floor: number): ItemDef[] {
  return defs.filter((d) => d.slot === slot && d.minFloor <= floor);
}
