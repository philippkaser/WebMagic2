/** Gear slots — the four pieces that define a wizard's kit. */
export type GearSlot = "staff" | "amulet" | "cloak" | "boots";

/** Everything an item can be: worn gear or a consumable that lives in the
 * belt/bag and is spent on use. */
export type Slot = GearSlot | "consumable";

export type JumpKind = "single" | "double" | "hover";

/** Additive/multiplicative passive modifiers granted by items. */
export interface Passives {
  maxHealth: number; // additive
  speedMult: number;
  manaRegenMult: number;
  damageMult: number;
  damageTakenMult: number;
  aggroMult: number; // enemy notice radius multiplier
}

/** What happens when a consumable is used (Q/E). */
export interface ConsumableEffect {
  heal?: number;
  mana?: number;
  /** Vanish back to the village, banking this run's loot — a portable,
   * one-shot checkpoint portal (does NOT advance your checkpoint). */
  escape?: boolean;
}

export interface ItemDef {
  id: string;
  slot: Slot;
  name: string;
  tier: 1 | 2 | 3;
  /** Earliest dungeon floor this item can drop on. */
  minFloor: number;
  color: string;
  desc: string;
  /** Relative drop rarity within its slot pool (default 1; <1 = rarer). */
  dropWeight?: number;
  // staff-only
  primary?: string; // ability id
  secondary?: string; // ability id
  // passives (any slot)
  passives?: Partial<Passives>;
  // boots-only
  jump?: JumpKind;
  // cloak-only
  dash?: boolean;
  // consumable-only
  consumable?: ConsumableEffect;
  /** Max copies per inventory stack (default 1 — gear never stacks). */
  maxStack?: number;
}

/** An owned item. Items acquired during a run are lost on death until banked
 * at a checkpoint. */
export interface ItemInstance {
  defId: string;
  runLoot: boolean;
}

/** A stack of owned items in a bag/belt/chest cell. Gear always has qty 1;
 * consumables stack up to their def's maxStack. */
export interface ItemStack {
  defId: string;
  qty: number;
  runLoot: boolean;
}

/** The staff is the only mandatory piece — a wizard without a staff isn't a
 * wizard. Everything else can be unequipped (bare feet = plain single jump). */
export interface Equipment {
  staff: ItemInstance;
  amulet: ItemInstance | null;
  cloak: ItemInstance | null;
  boots: ItemInstance | null;
}

export interface DerivedStats extends Passives {
  jump: JumpKind;
  dash: boolean;
}
