import { create } from "zustand";
import { playHurt, playPickup } from "../audio/sound";
import { DUNGEON, PLAYER } from "../core/config";
import { gameEvents } from "../core/events";
import { Rng } from "../core/rng";
import { getPlayerBody, playerPosition } from "../game/player-state";
import {
  discard as discardItem,
  equipFrom,
  itemTitle,
  pickUp,
  settleDeath,
  settleExtraction,
  unequip as unequipItem,
  type Loadout,
  type Source,
} from "../items/inventory";
import { computeStats, gearLevel } from "../items/stats";
import type { DerivedStats, Equipment, ItemInstance } from "../items/types";
import { session } from "../net/session";
import { canExtract, entryFloorFor, newRun, type RunState } from "../progression/progression";
import { loadSave, persistSave, type SaveData } from "./persistence";
import { useSettings } from "./settings";

/** Game flow + the player's loadout and run. All inventory *rules* live in
 * items/inventory.ts and progression/progression.ts (pure, tested); this
 * store sequences them and talks to the session. */

export type Phase = "menu" | "village" | "loading" | "dungeon" | "dead";

export interface RunSummary {
  floor: number;
  floorsVisited: number;
  kills: number;
  wizardsSlain: number;
  items: ItemInstance[];
}

export interface GameState {
  phase: Phase;
  floor: number;
  floorSeed: number;
  instanceId: string;
  health: number;
  mana: number;

  equipment: Equipment;
  /** Carried in the dungeon: this run's finds + anything unequipped mid-run. */
  satchel: ItemInstance[];
  /** Banked in the village. */
  stash: ItemInstance[];
  records: SaveData["records"];

  run: RunState | null;
  /** Contextual interaction prompt shown by the HUD ("E — Descend…"). */
  prompt: string | null;
  /** Satchel / stash screen open (releases the pointer). */
  inventoryOpen: boolean;
  lastDeath: (RunSummary & { killerName: string | null }) | null;
  lastExtraction: RunSummary | null;
  /** Bumped each time the splash screen is left — plays the mind-dive. */
  mindDiveId: number;
  /** Tint of the warp tunnel shown while phase === "loading". */
  warpTint: string;

  startGame(): void;
  enterDungeon(): Promise<void>;
  descend(): Promise<void>;
  extract(): Promise<void>;
  pickUpItem(item: ItemInstance): void;
  equip(uid: string, source: Source): void;
  unequip(slot: "amulet" | "cloak"): void;
  discard(uid: string): void;
  takeDamage(amount: number, attackerId?: string | null): void;
  heal(amount: number): void;
  spendMana(cost: number): boolean;
  regenMana(dt: number): void;
  recordKill(): void;
  respawn(): void;
  dismissSummary(): void;
  setPrompt(prompt: string | null): void;
  setInventoryOpen(open: boolean): void;
}

const saved = loadSave();
let manaAccumulator = 0;
/** Kill attribution: the last wizard whose spell hurt us, if recent. */
let lastAttacker: { id: string; at: number } | null = null;
const ATTRIBUTION_MS = 8000;

/** Minimum time the floor spends "loading". Kept a touch shorter than the warp
 * transition's descent (see ui/Transitions), so the destination has mounted
 * and warmed up under cover before the "sucked out" reveal lands on it. */
const WARP_MS = 1150;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const riftRng = new Rng((Date.now() ^ 0x5eed) >>> 0);

export const useGame = create<GameState>((set, get) => {
  const loadout = (): Loadout => {
    const s = get();
    return { equipment: s.equipment, satchel: s.satchel, stash: s.stash };
  };

  /** Apply a new loadout, keeping health within the (possibly new) max. */
  const applyLoadout = (next: Loadout) => {
    const max = computeStats(next.equipment).maxHealth;
    set({ ...next, health: Math.min(get().health, max) });
    if (get().phase === "village") save();
  };

  const save = () => {
    const s = get();
    persistSave({ version: 2, equipment: s.equipment, stash: s.stash, records: s.records });
  };

  const summary = (items: ItemInstance[]): RunSummary => {
    const { floor, run } = get();
    return {
      floor,
      floorsVisited: run?.floorsVisited ?? 0,
      kills: run?.kills ?? 0,
      wizardsSlain: run?.wizardsSlain ?? 0,
      items,
    };
  };

  const die = () => {
    const state = get();
    const { loadout: kept, lost } = settleDeath(loadout());
    const killerId = lastAttacker && performance.now() - lastAttacker.at < ATTRIBUTION_MS ? lastAttacker.id : null;
    const killerName = killerId ? session.peerName(killerId) : null;
    // What we lost becomes a chest on this floor for whoever gets there first.
    session.sendDeath([playerPosition.x, Math.max(0.2, playerPosition.y - 0.9), playerPosition.z], lost, killerId);
    const records = {
      ...state.records,
      deaths: state.records.deaths + 1,
      deepest: Math.max(state.records.deepest, state.floor),
      wizardsSlain: state.records.wizardsSlain + (state.run?.wizardsSlain ?? 0),
    };
    set({
      ...kept,
      records,
      phase: "dead",
      health: computeStats(kept.equipment).maxHealth,
      lastDeath: { ...summary(lost), killerName },
      run: null,
      prompt: null,
      inventoryOpen: false,
    });
    lastAttacker = null;
    save();
  };

  return {
    phase: "menu",
    floor: 0,
    floorSeed: 0,
    instanceId: "",
    health: computeStats(saved.equipment).maxHealth,
    mana: PLAYER.maxMana,
    equipment: saved.equipment,
    satchel: [],
    stash: saved.stash,
    records: saved.records,
    run: null,
    prompt: null,
    inventoryOpen: false,
    lastDeath: null,
    lastExtraction: null,
    mindDiveId: 0,
    warpTint: "#46ffd0",

    startGame: () => set({ phase: "village", mindDiveId: get().mindDiveId + 1 }),

    enterDungeon: async () => {
      if (get().phase !== "village") return;
      const gear = gearLevel(get().equipment);
      const devFloor = import.meta.env?.DEV ? (window as unknown as { __entryFloor?: number }).__entryFloor : undefined;
      const target = devFloor ?? entryFloorFor(gear, riftRng);
      save(); // the pre-run state is what survives a closed tab
      set({ phase: "loading", warpTint: "#46ffd0", prompt: null, inventoryOpen: false, lastExtraction: null });
      const warp = wait(WARP_MS);
      await session.ensureConnected(useSettings.getState().playerName);
      const assignment = await session.requestFloor(target);
      await warp;
      set({
        phase: "dungeon",
        floor: assignment.floor,
        floorSeed: assignment.seed,
        instanceId: assignment.instanceId,
        health: getStats().maxHealth,
        mana: PLAYER.maxMana,
        lastDeath: null,
        run: newRun(assignment.floor),
        records: { ...get().records, runs: get().records.runs + 1 },
      });
      gameEvents.emit("message", `The rift reads your power (gear ${gear}) and hurls you to floor ${assignment.floor}`);
      announceArrival(assignment.joinedExisting);
    },

    descend: async () => {
      const { floor, run } = get();
      const next = floor + 1;
      if (next > DUNGEON.maxFloor || !run) return;
      set({ phase: "loading", warpTint: "#46ffd0", prompt: null, inventoryOpen: false });
      const warp = wait(WARP_MS);
      const assignment = await session.requestFloor(next);
      await warp;
      set({
        phase: "dungeon",
        floor: assignment.floor,
        floorSeed: assignment.seed,
        instanceId: assignment.instanceId,
        run: { ...run, floorsVisited: run.floorsVisited + 1 },
      });
      gameEvents.emit("message", `Floor ${assignment.floor}`);
      if (canExtract(get().run) && !canExtract(run)) {
        gameEvents.emit("message", "You have endured. A homeward rift waits beside the exit.");
      }
      announceArrival(assignment.joinedExisting);
    },

    extract: async () => {
      if (!canExtract(get().run)) return;
      const { loadout: banked, gained } = settleExtraction(loadout());
      const result = summary(gained);
      session.leaveDungeon();
      set({ phase: "loading", warpTint: "#ffd44f", prompt: null, inventoryOpen: false });
      await wait(WARP_MS);
      const s = get();
      set({
        ...banked,
        phase: "village",
        floor: 0,
        run: null,
        health: computeStats(banked.equipment).maxHealth,
        mana: PLAYER.maxMana,
        records: {
          ...s.records,
          extractions: s.records.extractions + 1,
          deepest: Math.max(s.records.deepest, result.floor),
          wizardsSlain: s.records.wizardsSlain + result.wizardsSlain,
        },
        lastExtraction: result,
      });
      lastAttacker = null;
      save();
      gameEvents.emit("message", `You escaped with ${gained.length} treasure${gained.length === 1 ? "" : "s"}`);
    },

    pickUpItem: (item) => {
      const { loadout: next, equipped } = pickUp(loadout(), { ...item, runLoot: get().phase === "dungeon" });
      applyLoadout(next);
      playPickup();
      const name = `${itemTitle(item)} (Lv ${item.level})`;
      gameEvents.emit("message", equipped ? `${name} — equipped` : `${name} — into the satchel [Tab]`);
    },

    equip: (uid, source) => {
      if (source === "stash" && get().phase !== "village") return; // the stash stays home
      const before = loadout();
      const next = equipFrom(before, uid, source);
      if (next === before) return;
      applyLoadout(next);
      playPickup();
    },

    unequip: (slot) => {
      const phase = get().phase;
      if (phase !== "village" && phase !== "dungeon") return;
      applyLoadout(unequipItem(loadout(), slot, phase === "village" ? "stash" : "satchel"));
    },

    discard: (uid) => {
      if (get().phase !== "village") return;
      applyLoadout(discardItem(loadout(), uid));
    },

    takeDamage: (amount, attackerId = null) => {
      const state = get();
      if (state.phase !== "dungeon" && state.phase !== "village") return;
      if (attackerId) lastAttacker = { id: attackerId, at: performance.now() };
      const dealt = amount * getStats().damageTakenMult;
      const health = Math.max(0, state.health - dealt);
      playHurt();
      gameEvents.emit("playerHurt", { amount: dealt });
      gameEvents.emit("shake", Math.min(dealt / 40, 1));
      if (health <= 0 && state.phase === "dungeon") die();
      else set({ health: Math.max(health, state.phase === "village" ? 1 : 0) });
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

    recordKill: () => {
      const run = get().run;
      if (run) set({ run: { ...run, kills: run.kills + 1 } });
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

    dismissSummary: () => set({ lastExtraction: null }),

    setPrompt: (prompt) => {
      if (get().prompt !== prompt) set({ prompt });
    },

    setInventoryOpen: (open) => {
      const phase = get().phase;
      if (open && phase !== "village" && phase !== "dungeon") return;
      if (get().inventoryOpen !== open) set({ inventoryOpen: open });
    },
  };
});

function announceArrival(joinedExisting: boolean) {
  if (joinedExisting) {
    gameEvents.emit("message", "You are not alone on this floor…");
  }
}

// ── Cross-system reactions ──────────────────────────────────────────────────

// Another wizard's spell landed on us.
gameEvents.on("pvpHit", ({ fromId, damage, impulse }) => {
  useGame.getState().takeDamage(damage, fromId);
  getPlayerBody()?.applyImpulse(impulse, true);
});

// We claimed a death chest.
gameEvents.on("chestGrant", ({ items }) => {
  const state = useGame.getState();
  if (state.phase !== "dungeon") return;
  for (const item of items) state.pickUpItem(item);
});

// A floor-mate fell — maybe by our hand.
gameEvents.on("peerDied", ({ name, killerId, killerName }) => {
  const game = useGame.getState();
  if (killerId && killerId === session.playerId && game.run) {
    useGame.setState({ run: { ...game.run, wizardsSlain: game.run.wizardsSlain + 1 } });
    gameEvents.emit("message", `You struck down ${name}. Their chest is yours to take.`);
  } else {
    gameEvents.emit("message", killerName ? `${name} was slain by ${killerName}` : `${name} has fallen`);
  }
});

// Dev-only hook for debugging and end-to-end scripts.
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__game = useGame;
}

/** Current derived stats — cheap enough to compute on demand. */
export function getStats(): DerivedStats {
  return computeStats(useGame.getState().equipment);
}
