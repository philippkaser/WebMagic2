export type Slot = "staff" | "amulet" | "cloak" | "boots";

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

export interface ItemDef {
  id: string;
  slot: Slot;
  name: string;
  tier: 1 | 2 | 3;
  /** Earliest dungeon floor this item can drop on. */
  minFloor: number;
  color: string;
  desc: string;
  // staff-only
  primary?: string; // ability id
  secondary?: string; // ability id
  // passives (any slot)
  passives?: Partial<Passives>;
  // boots-only
  jump?: JumpKind;
  // cloak-only
  dash?: boolean;
}

/** An owned item. Items acquired during a run are lost on death until banked
 * at a checkpoint. */
export interface ItemInstance {
  defId: string;
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
