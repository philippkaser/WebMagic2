export type Slot = "staff" | "amulet" | "cloak" | "boots";

export const SLOTS: readonly Slot[] = ["staff", "amulet", "cloak", "boots"];

export type JumpKind = "single" | "double" | "hover";

export type Rarity = "common" | "rare" | "epic" | "legendary";

/** Additive/multiplicative passive modifiers granted by items. */
export interface Passives {
  maxHealth: number; // additive
  speedMult: number;
  manaRegenMult: number;
  damageMult: number;
  damageTakenMult: number;
  aggroMult: number; // enemy notice radius multiplier
}

/** Static item template. Instances (with level + rarity) are rolled from it. */
export interface ItemDef {
  id: string;
  slot: Slot;
  name: string;
  /** Earliest dungeon floor this item can drop on. */
  minFloor: number;
  /** Relative drop weight within its slot (default 1). */
  weight?: number;
  color: string;
  /** One-line mechanical summary. */
  desc: string;
  /** A line of mystical lore shown in the satchel. */
  lore: string;
  // staff-only
  primary?: string; // ability id
  secondary?: string; // ability id
  // flat passives on top of the per-level slot scaling
  passives?: Partial<Passives>;
  // boots-only
  jump?: JumpKind;
  // cloak-only
  dash?: boolean;
}

/** An owned item. `runLoot` marks anything picked up during the current run:
 * it is lost on death and becomes permanently yours on extraction. */
export interface ItemInstance {
  uid: string;
  defId: string;
  /** 1…100 — roughly the floor it dropped on. Drives its power. */
  level: number;
  rarity: Rarity;
  runLoot: boolean;
}

export interface Equipment {
  staff: ItemInstance;
  amulet: ItemInstance | null;
  cloak: ItemInstance | null;
  boots: ItemInstance;
}

export interface DerivedStats extends Passives {
  jump: JumpKind;
  dash: boolean;
}
