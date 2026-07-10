import { create } from "zustand";
import { playHurt, playPickup } from "../audio/sound";
import { DUNGEON, PLAYER } from "../core/config";
import { gameEvents } from "../core/events";
import { computeStats, getItemDef } from "../items/catalog";
import type { DerivedStats, Equipment } from "../items/types";
import { session } from "../net/session";
import { defaultEquipment, loadSave, persistSave } from "./persistence";

export type Phase = "menu" | "village" | "select" | "loading" | "dungeon" | "dead";

export interface GameState {
  phase: Phase;
  floor: number;
  floorSeed: number;
  instanceId: string;
  /** Highest unlocked entry floor (1 or a checkpoint multiple). */
  checkpoint: number;
  health: number;
  mana: number;
  equipment: Equipment;
  /** Contextual interaction prompt shown by the HUD ("E — Descend…"). */
  prompt: string | null;
  lastDeath: { floor: number; lostItems: string[] } | null;
  /** Quality toggle: the staff/moon shadow costs several extra scene renders
   * per frame, so it's opt-in. */
  shadows: boolean;
  /** Display name shown to floor-mates. */
  playerName: string;

  startGame(): void;
  openPortalSelect(): void;
  closePortalSelect(): void;
  enterDungeon(entryFloor: number): Promise<void>;
  descend(): Promise<void>;
  bankAndLeave(): void;
  equipItem(defId: string): void;
  takeDamage(amount: number): void;
  heal(amount: number): void;
  spendMana(cost: number): boolean;
  regenMana(dt: number): void;
  respawn(): void;
  setPrompt(prompt: string | null): void;
  toggleShadows(): void;
  setPlayerName(name: string): void;
}

const SHADOWS_KEY = "webmagic.shadows.v1";
const NAME_KEY = "webmagic.name.v1";

function loadShadowSetting(): boolean {
  try {
    return localStorage.getItem(SHADOWS_KEY) === "1";
  } catch {
    return false;
  }
}

function loadPlayerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "Wizard";
  } catch {
    return "Wizard";
  }
}

const saved = loadSave();
let manaAccumulator = 0;

export const useGame = create<GameState>((set, get) => ({
  phase: "menu",
  floor: 0,
  floorSeed: 0,
  instanceId: "",
  checkpoint: saved.checkpoint,
  health: computeStats(saved.equipment).maxHealth,
  mana: PLAYER.maxMana,
  equipment: saved.equipment,
  prompt: null,
  lastDeath: null,
  shadows: loadShadowSetting(),
  playerName: loadPlayerName(),

  startGame: () => set({ phase: "village" }),

  openPortalSelect: () => set({ phase: "select", prompt: null }),
  closePortalSelect: () => set({ phase: "village" }),

  enterDungeon: async (entryFloor) => {
    set({ phase: "loading", prompt: null });
    await session.ensureConnected(get().playerName);
    const assignment = await session.requestFloor(entryFloor);
    const stats = getStats();
    set({
      phase: "dungeon",
      floor: assignment.floor,
      floorSeed: assignment.seed,
      instanceId: assignment.instanceId,
      health: stats.maxHealth,
      mana: PLAYER.maxMana,
      lastDeath: null,
    });
    gameEvents.emit("message", `Floor ${assignment.floor} — ${assignment.playerCount} wizard(s) here`);
  },

  descend: async () => {
    const next = get().floor + 1;
    if (next > DUNGEON.maxFloor) return;
    set({ phase: "loading", prompt: null });
    const assignment = await session.requestFloor(next);
    set({
      phase: "dungeon",
      floor: assignment.floor,
      floorSeed: assignment.seed,
      instanceId: assignment.instanceId,
    });
    gameEvents.emit("message", `Floor ${assignment.floor}`);
  },

  bankAndLeave: () => {
    const { floor, checkpoint, equipment } = get();
    const banked: Equipment = {
      staff: { ...equipment.staff, runLoot: false },
      amulet: equipment.amulet && { ...equipment.amulet, runLoot: false },
      cloak: equipment.cloak && { ...equipment.cloak, runLoot: false },
      boots: { ...equipment.boots, runLoot: false },
    };
    const newCheckpoint = Math.max(checkpoint, floor);
    persistSave({ checkpoint: newCheckpoint, equipment: banked });
    session.leaveDungeon();
    set({
      phase: "village",
      equipment: banked,
      checkpoint: newCheckpoint,
      floor: 0,
      health: computeStats(banked).maxHealth,
      mana: PLAYER.maxMana,
      prompt: null,
    });
    gameEvents.emit("message", `Loot banked. Checkpoint: floor ${newCheckpoint}`);
  },

  equipItem: (defId) => {
    const def = getItemDef(defId);
    const equipment: Equipment = { ...get().equipment };
    const inDungeon = get().phase === "dungeon";
    const previous = equipment[def.slot];
    equipment[def.slot] = { defId, runLoot: inDungeon };
    const stats = computeStats(equipment);
    set({ equipment, health: Math.min(get().health + (def.passives?.maxHealth ?? 0), stats.maxHealth) });
    playPickup();
    gameEvents.emit(
      "message",
      previous ? `${def.name} (replaced ${getItemDef(previous.defId).name})` : `${def.name} equipped`,
    );
  },

  takeDamage: (amount) => {
    const state = get();
    if (state.phase !== "dungeon" && state.phase !== "village") return;
    const stats = getStats();
    const dealt = amount * stats.damageTakenMult;
    const health = Math.max(0, state.health - dealt);
    playHurt();
    gameEvents.emit("playerHurt", { amount: dealt });
    gameEvents.emit("shake", Math.min(dealt / 40, 1));
    if (health <= 0) {
      die(set, get);
    } else {
      set({ health });
    }
  },

  heal: (amount) => {
    set({ health: Math.min(get().health + amount, getStats().maxHealth) });
  },

  spendMana: (cost) => {
    const { mana } = get();
    if (mana < cost) return false;
    set({ mana: mana - cost });
    return true;
  },

  regenMana: (dt) => {
    const { mana } = get();
    if (mana >= PLAYER.maxMana) {
      manaAccumulator = 0;
      return;
    }
    // Accumulate and flush in chunks: writing the store at 60 Hz re-renders
    // the HUD every frame for no visible benefit.
    manaAccumulator += PLAYER.manaRegen * getStats().manaRegenMult * dt;
    if (manaAccumulator >= 1.25) {
      set({ mana: Math.min(PLAYER.maxMana, mana + manaAccumulator) });
      manaAccumulator = 0;
    }
  },

  respawn: () => {
    set({
      phase: "village",
      floor: 0,
      health: getStats().maxHealth,
      mana: PLAYER.maxMana,
      prompt: null,
    });
  },

  setPrompt: (prompt) => {
    if (get().prompt !== prompt) set({ prompt });
  },

  toggleShadows: () => {
    const shadows = !get().shadows;
    set({ shadows });
    try {
      localStorage.setItem(SHADOWS_KEY, shadows ? "1" : "0");
    } catch {
      // Setting is session-only without storage.
    }
    gameEvents.emit("message", `Shadows ${shadows ? "on" : "off"}`);
  },

  setPlayerName: (name) => {
    const clean = name.replace(/[^\w \-']/g, "").slice(0, 16).trim() || "Wizard";
    set({ playerName: clean });
    try {
      localStorage.setItem(NAME_KEY, clean);
    } catch {
      // Session-only without storage.
    }
  },
}));

/** Death: everything picked up during this run is lost. */
function die(
  set: (partial: Partial<GameState>) => void,
  get: () => GameState,
) {
  const { equipment, floor, checkpoint } = get();
  const lostItems: string[] = [];
  const strip = (slot: "amulet" | "cloak") => {
    const item = equipment[slot];
    if (item?.runLoot) {
      lostItems.push(getItemDef(item.defId).name);
      return null;
    }
    return item;
  };
  const fallback = defaultEquipment();
  const kept: Equipment = {
    staff: equipment.staff.runLoot
      ? (lostItems.push(getItemDef(equipment.staff.defId).name), fallback.staff)
      : equipment.staff,
    amulet: strip("amulet"),
    cloak: strip("cloak"),
    boots: equipment.boots.runLoot
      ? (lostItems.push(getItemDef(equipment.boots.defId).name), fallback.boots)
      : equipment.boots,
  };
  persistSave({ checkpoint, equipment: kept });
  session.leaveDungeon();
  set({
    phase: "dead",
    equipment: kept,
    health: computeStats(kept).maxHealth,
    lastDeath: { floor, lostItems },
    prompt: null,
  });
}

// Dev-only hook for debugging and end-to-end scripts.
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__game = useGame;
}

/** Current derived stats — cheap enough to compute on demand. */
export function getStats(): DerivedStats {
  return computeStats(useGame.getState().equipment);
}

/** Entry floors selectable at the village portal. */
export function entryFloors(checkpoint: number): number[] {
  const floors = [1];
  for (let f = DUNGEON.checkpointInterval; f <= checkpoint; f += DUNGEON.checkpointInterval) {
    floors.push(f);
  }
  return floors;
}
