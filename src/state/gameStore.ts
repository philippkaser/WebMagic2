import { create } from "zustand";
import { playHurt, playPickup, playPortal } from "../audio/sound";
import { DUNGEON, PLAYER } from "../core/config";
import { gameEvents } from "../core/events";
import { computeStats, getItemDef, resolveItem } from "../items/catalog";
import { GAMBLE_PRICE, merchantPrice, multisetOf, sellValue } from "../items/economy";
import { rollGamble } from "../items/loot";
import { Rng } from "../core/rng";
import {
  addToGrid,
  clearSlot,
  hasRoom,
  markBanked,
  moveItem as moveItemPure,
  readSlot,
  stripRunLoot,
  takeOneAt,
  type Carried,
  type Grid,
  type SlotRef,
} from "../items/inventory";
import type { DerivedStats, Equipment } from "../items/types";
import { netBus } from "../net/bus";
import { useNet } from "../net/netStore";
import { session } from "../net/session";
import {
  defaultSave,
  fromWireInventory,
  loadSave,
  persistSave,
  toWireInventory,
} from "./persistence";

export type Phase = "menu" | "village" | "select" | "loading" | "dungeon" | "dead";

/** Fullscreen inventory-family overlays. The world keeps simulating (shared
 * floors can't pause), so these are DOM layers, not phases. "devroom" is a
 * dev-only testing panel (see ui/DevRoom) reached from the village dev slab. */
export type Overlay = "none" | "inventory" | "chest" | "merchant" | "devroom";

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
  /** 5 carry slots — at risk in the dungeon until banked, like equipment. */
  bag: Grid;
  /** 2 quick slots for consumables: belt[0] = Q, belt[1] = E. */
  belt: Grid;
  /** 30 slots, lives in the village — never carried, never at risk. */
  chest: Grid;
  /** Banked gold (safe). */
  gold: number;
  /** Gold gathered this run — lost on death, banked with the rest. */
  runGold: number;
  overlay: Overlay;
  /** Contextual interaction prompt shown by the HUD ("E — Descend…"). */
  prompt: string | null;
  lastDeath: { floor: number; lostItems: string[]; lostGold: number } | null;
  /** Quality toggle: the staff/moon shadow costs several extra scene renders
   * per frame, so it's opt-in. */
  shadows: boolean;
  /** Display name shown to floor-mates. */
  playerName: string;
  /** Colour of the portal last stepped through — tints the crossing/arrival
   * transition so the tear you fall through matches the one you entered. */
  portalColor: string;
  /** Which way the last crossing went: "descend" falls into the cold tear,
   * "ascend" is the warm resurrection back up to the village. Read by the HUD
   * to pick the crossing and arrival visuals. */
  transition: "descend" | "ascend";

  startGame(): void;
  /** Record the colour of a portal as it's used, for the transition tint. */
  setPortalColor(color: string): void;
  openPortalSelect(): void;
  closePortalSelect(): void;
  enterDungeon(entryFloor: number): Promise<void>;
  descend(): Promise<void>;
  bankAndLeave(): Promise<void>;
  /** Can this pickup go ANYWHERE right now? Gates loot-orb prompts. */
  canAcquire(defId: string): boolean;
  /** Route a granted pickup: empty gear slot → equip; consumable → belt,
   * then bag; gear with its slot taken → bag. Returns false if truly full. */
  acquireItem(defId: string): boolean;
  addGold(amount: number): void;
  /** Move/swap/merge between any two cells (equipment/bag/belt/chest) —
   * the one action behind every drag, drop and click in the inventory UI.
   * All rules live in items/inventory.ts#moveItem; chest moves additionally
   * require standing in the village. */
  moveItem(from: SlotRef, to: SlotRef): void;
  /** Drop a cell's contents: in the dungeon they spawn as real loot orbs at
   * your feet (floor-mates can grab them!); in the village they're discarded.
   * The staff can never be dropped. */
  dropStack(from: SlotRef): void;
  /** Sell a cell's whole stack to Maro (village only, staff excluded). */
  sellStack(from: SlotRef): void;
  /** Buy an Orb of Fortune: gold in, random gear out (rolled server-side
   * online; locally offline). Needs bag room. */
  gamble(): void;
  /** Use the consumable in belt[index] (0 = Q, 1 = E). */
  useBelt(index: number): void;
  buyItem(defId: string): void;
  setOverlay(overlay: Overlay): void;
  takeDamage(amount: number): void;
  heal(amount: number): void;
  spendMana(cost: number): boolean;
  regenMana(dt: number): void;
  respawn(): Promise<void>;
  setPrompt(prompt: string | null): void;
  toggleShadows(): void;
  setPlayerName(name: string): void;
}

const SHADOWS_KEY = "webmagic.shadows.v1";
const NAME_KEY = "webmagic.name.v1";

/** Floors can stream in almost instantly (offline/loopback), which would make
 * the crossing-the-tear transition flash by unseen. Hold the loading phase for
 * at least this long so the passage always reads as a real journey. */
const TRANSITION_MIN_MS = 1150;

/** Resolve after `ms` — used to pad a too-quick floor load up to the minimum
 * transition time. */
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

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
/** Dev-room god mode. Module-level (not reactive state) so a production build
 * carries only a dead boolean — the DEV guard in takeDamage strips the read. */
let devInvuln = false;
export function setDevInvuln(on: boolean): boolean {
  devInvuln = on;
  return devInvuln;
}
export function isDevInvuln(): boolean {
  return devInvuln;
}
/** An Orb of Fortune is in the server's hands — reveal on the next save. */
let pendingGamble = false;

export const useGame = create<GameState>((set, get) => ({
  phase: "menu",
  floor: 0,
  floorSeed: 0,
  instanceId: "",
  checkpoint: saved.checkpoint,
  health: computeStats(saved.equipment).maxHealth,
  mana: PLAYER.maxMana,
  equipment: saved.equipment,
  bag: saved.bag,
  belt: saved.belt,
  chest: saved.chest,
  gold: saved.gold,
  runGold: 0,
  overlay: "none",
  prompt: null,
  lastDeath: null,
  shadows: loadShadowSetting(),
  playerName: loadPlayerName(),
  portalColor: "#46ffd0",
  transition: "descend",

  startGame: () => set({ phase: "village" }),
  setPortalColor: (color) => set({ portalColor: color }),

  openPortalSelect: () => set({ phase: "select", prompt: null }),
  closePortalSelect: () => set({ phase: "village" }),

  enterDungeon: async (entryFloor) => {
    const startedAt = performance.now();
    set({ phase: "loading", transition: "descend", prompt: null, overlay: "none" });
    await session.ensureConnected(get().playerName);
    const assignment = await session.requestFloor(entryFloor);
    await wait(TRANSITION_MIN_MS - (performance.now() - startedAt));
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
    gameEvents.emit("message", `Floor ${assignment.floor} — ${assignment.members.length} wizard(s) here`);
  },

  descend: async () => {
    const next = get().floor + 1;
    if (next > DUNGEON.maxFloor) return;
    const startedAt = performance.now();
    set({ phase: "loading", transition: "descend", prompt: null, overlay: "none" });
    const assignment = await session.requestFloor(next);
    await wait(TRANSITION_MIN_MS - (performance.now() - startedAt));
    set({
      phase: "dungeon",
      floor: assignment.floor,
      floorSeed: assignment.seed,
      instanceId: assignment.instanceId,
    });
    gameEvents.emit("message", `Floor ${assignment.floor}`);
  },

  bankAndLeave: async () => {
    const startedAt = performance.now();
    const banked = bankCarried(get());
    const newCheckpoint = Math.max(get().checkpoint, get().floor);
    persistCurrent({ ...get(), ...banked, checkpoint: newCheckpoint });
    // Server-side bank: provenance-validated; the "saved" ack corrects us if
    // anything didn't check out. Offline this is a no-op (local save rules).
    session.sendBank(toWireInventory({ ...banked, chest: get().chest }));
    session.leaveDungeon();
    // Rise back to the living: hold the resurrection crossing over the village
    // as it streams in (floor 0 → GameScene mounts the Village behind the veil).
    set({ phase: "loading", transition: "ascend", floor: 0, prompt: null, overlay: "none" });
    await wait(TRANSITION_MIN_MS - (performance.now() - startedAt));
    set({
      phase: "village",
      ...banked,
      checkpoint: newCheckpoint,
      floor: 0,
      health: computeStats(banked.equipment).maxHealth,
      mana: PLAYER.maxMana,
      prompt: null,
      overlay: "none",
    });
    gameEvents.emit("message", `Loot banked. Checkpoint: floor ${newCheckpoint}`);
  },

  canAcquire: (defId) => {
    const def = getItemDef(defId);
    const state = get();
    if (def.slot === "consumable") {
      const runLoot = state.phase === "dungeon";
      return hasRoom(state.belt, defId, runLoot) || hasRoom(state.bag, defId, runLoot);
    }
    return state.equipment[def.slot] === null || state.bag.includes(null);
  },

  acquireItem: (defId) => {
    const item = resolveItem(defId);
    const def = item.def;
    const state = get();
    const runLoot = state.phase === "dungeon";

    if (def.slot === "consumable") {
      const toBelt = addToGrid(state.belt, defId, runLoot);
      if (toBelt) {
        set({ belt: toBelt });
        afterPickup(item.name, "belt");
        syncVillage(get());
        return true;
      }
      const toBag = addToGrid(state.bag, defId, runLoot);
      if (toBag) {
        set({ bag: toBag });
        afterPickup(item.name, "bag");
        syncVillage(get());
        return true;
      }
      // Pickups are gated on canAcquire before the grant, so this only
      // happens on a rare co-op race (bag filled while the request flew).
      gameEvents.emit("message", `${item.name} slips away — inventory full`);
      return false;
    }

    // Gear: fill an empty slot outright, otherwise stow in the bag.
    if (state.equipment[def.slot] === null) {
      set({
        equipment: { ...state.equipment, [def.slot]: { defId, runLoot } },
        health: clampedHealth(get()),
      });
      playPickup();
      gameEvents.emit("message", `${item.name} equipped`);
      syncVillage(get());
      return true;
    }
    const toBag = addToGrid(state.bag, defId, runLoot);
    if (!toBag) {
      gameEvents.emit("message", `${item.name} slips away — inventory full`);
      return false;
    }
    set({ bag: toBag });
    afterPickup(item.name, "bag");
    syncVillage(get());
    return true;
  },

  addGold: (amount) => {
    if (amount <= 0) return;
    if (get().phase === "dungeon") {
      set({ runGold: get().runGold + amount });
    } else {
      set({ gold: get().gold + amount });
      syncVillage(get());
    }
    gameEvents.emit("message", `+${amount} gold`);
  },

  moveItem: (from, to) => {
    const state = get();
    if ((from.container === "chest" || to.container === "chest") && state.phase !== "village") {
      gameEvents.emit("message", "Your chest is back in the village");
      return;
    }
    const next = moveItemPure(carriedOf(state), from, to);
    if (!next) return; // illegal move — the UI simply doesn't accept the drop
    const equipmentChanged = from.container === "equipment" || to.container === "equipment";
    set({ ...next, health: clampedHealth({ ...state, ...next }) });
    if (equipmentChanged) playPickup();
    syncVillage(get());
  },

  dropStack: (from) => {
    const state = get();
    const stack = readSlot(carriedOf(state), from);
    if (!stack) return;
    if (from.container === "equipment" && from.slot === "staff") {
      gameEvents.emit("message", "A wizard never drops their staff");
      return;
    }
    if (from.container === "chest" && state.phase !== "village") return;
    const next = clearSlot(carriedOf(state), from);
    if (!next) return;
    const name = resolveItem(stack.defId).name;
    set({ ...next, health: clampedHealth({ ...state, ...next }) });
    if (state.phase === "dungeon") {
      // Real orbs at your feet — a floor-mate can pick them up (gifting!).
      gameEvents.emit("dropItems", { defId: stack.defId, qty: stack.qty });
      gameEvents.emit("message", `Dropped ${name}${stack.qty > 1 ? ` ×${stack.qty}` : ""}`);
    } else {
      gameEvents.emit("message", `Discarded ${name}${stack.qty > 1 ? ` ×${stack.qty}` : ""}`);
      syncVillage(get());
    }
  },

  sellStack: (from) => {
    const state = get();
    if (state.phase !== "village") return;
    const stack = readSlot(carriedOf(state), from);
    if (!stack) return;
    if (from.container === "equipment" && from.slot === "staff") {
      gameEvents.emit("message", "A wizard never sells their staff");
      return;
    }
    const value = sellValue(stack.defId);
    if (value === null) return;
    const next = clearSlot(carriedOf(state), from);
    if (!next) return;
    const total = value * stack.qty;
    const name = resolveItem(stack.defId).name;
    set({ ...next, gold: state.gold + total, health: clampedHealth({ ...state, ...next }) });
    playPickup();
    gameEvents.emit(
      "message",
      `Sold ${name}${stack.qty > 1 ? ` ×${stack.qty}` : ""} for ${total} gold`,
    );
    const s = get();
    persistCurrent(s);
    session.sendSell(stack.defId, stack.qty, toWireInventory(s));
  },

  gamble: () => {
    const state = get();
    if (state.phase !== "village") return;
    if (state.gold < GAMBLE_PRICE) {
      gameEvents.emit("message", "Not enough gold");
      return;
    }
    if (!state.bag.includes(null)) {
      gameEvents.emit("message", "No bag room for what fortune brings");
      return;
    }
    if (useNet.getState().mode === "online") {
      // The server rolls; the reveal comes from diffing the saved response.
      pendingGamble = true;
      session.sendGamble();
      gameEvents.emit("message", "The orb swirls…");
      return;
    }
    // Offline: the local save is the record — same shared roll, local dice.
    const rolled = rollGamble(new Rng((Math.random() * 0xffffffff) >>> 0), state.checkpoint);
    const bag = addToGrid(state.bag, rolled, false)!;
    set({ gold: state.gold - GAMBLE_PRICE, bag });
    playPickup();
    gameEvents.emit("message", `The orb reveals: ${resolveItem(rolled).name}`);
    persistCurrent(get());
  },

  useBelt: (index) => {
    const state = get();
    if (state.phase !== "dungeon" && state.phase !== "village") return;
    const stack = state.belt[index];
    if (!stack) return;
    const def = getItemDef(stack.defId);
    const effect = def.consumable;
    if (!effect) return;

    if (effect.escape) {
      if (state.phase !== "dungeon") {
        gameEvents.emit("message", "The feather only works in the dungeon");
        return;
      }
      set({ belt: takeOneAt(state.belt, index) });
      escapeByFeather(set, get);
      return;
    }
    if (effect.heal && state.health >= getStats().maxHealth) {
      gameEvents.emit("message", "Already at full health");
      return;
    }
    if (effect.mana && !effect.heal && state.mana >= PLAYER.maxMana) {
      gameEvents.emit("message", "Mana is already full");
      return;
    }
    set({ belt: takeOneAt(state.belt, index) });
    if (effect.heal) get().heal(effect.heal);
    if (effect.mana) set({ mana: Math.min(PLAYER.maxMana, get().mana + effect.mana) });
    playPickup();
    gameEvents.emit("message", `${def.name} used`);
    syncVillage(get());
  },

  buyItem: (defId) => {
    const state = get();
    if (state.phase !== "village") return;
    const price = merchantPrice(defId);
    if (price === null) return;
    if (state.gold < price) {
      gameEvents.emit("message", "Not enough gold");
      return;
    }
    const def = getItemDef(defId);
    // Purchases land in the belt first (that's where you'll want them).
    const toBelt = def.slot === "consumable" ? addToGrid(state.belt, defId, false) : null;
    const toBag = toBelt ? null : addToGrid(state.bag, defId, false);
    if (!toBelt && !toBag) {
      gameEvents.emit("message", "No room — make space first");
      return;
    }
    set({
      gold: state.gold - price,
      ...(toBelt ? { belt: toBelt } : { bag: toBag! }),
    });
    playPickup();
    gameEvents.emit("message", `Bought ${def.name} for ${price} gold`);
    const s = get();
    persistCurrent(s);
    session.sendBuy(defId, toWireInventory(s));
  },

  setOverlay: (overlay) => {
    if (get().overlay !== overlay) set({ overlay, prompt: overlay === "none" ? get().prompt : null });
  },

  takeDamage: (amount) => {
    const state = get();
    if (state.phase !== "dungeon" && state.phase !== "village") return;
    if (import.meta.env.DEV && devInvuln) return; // dev-room god mode
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

  respawn: async () => {
    // Dragged back up through the tear — the same resurrection crossing as
    // leaving, only this time you had truly died. Village (floor 0) streams in
    // behind the veil while the heart restarts.
    const startedAt = performance.now();
    set({ phase: "loading", transition: "ascend", floor: 0, prompt: null, overlay: "none" });
    await wait(TRANSITION_MIN_MS - (performance.now() - startedAt));
    set({
      phase: "village",
      floor: 0,
      health: getStats().maxHealth,
      mana: PLAYER.maxMana,
      prompt: null,
      overlay: "none",
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

// ── Internals ────────────────────────────────────────────────────────────────

function afterPickup(name: string, where: string): void {
  playPickup();
  gameEvents.emit("message", `${name} → ${where}`);
}

/** Health never exceeds the (possibly just-changed) max. */
function clampedHealth(state: Pick<GameState, "health" | "equipment">): number {
  return Math.min(state.health, computeStats(state.equipment).maxHealth);
}

function carriedOf(state: GameState): Carried {
  return { equipment: state.equipment, bag: state.bag, belt: state.belt, chest: state.chest };
}

/** Everything carried becomes safe; run gold joins the purse. */
function bankCarried(state: GameState) {
  return {
    equipment: {
      staff: { ...state.equipment.staff, runLoot: false },
      amulet: state.equipment.amulet && { ...state.equipment.amulet, runLoot: false },
      cloak: state.equipment.cloak && { ...state.equipment.cloak, runLoot: false },
      boots: state.equipment.boots && { ...state.equipment.boots, runLoot: false },
    },
    bag: markBanked(state.bag),
    belt: markBanked(state.belt),
    gold: state.gold + state.runGold,
    runGold: 0,
  };
}

function persistCurrent(state: {
  checkpoint: number;
  equipment: Equipment;
  bag: Grid;
  belt: Grid;
  chest: Grid;
  gold: number;
}): void {
  persistSave({
    checkpoint: state.checkpoint,
    equipment: state.equipment,
    bag: state.bag,
    belt: state.belt,
    chest: state.chest,
    gold: state.gold,
  });
}

/** Village inventory changes persist immediately and sync to the server (a
 * rearrangement, never new items — the server checks). Mid-run changes are
 * session-local until banked. */
function syncVillage(state: GameState): void {
  if (state.phase === "dungeon" || state.phase === "loading") return;
  persistCurrent(state);
  session.sendStash(toWireInventory(state));
}

/** A spent Feather of Safe Passage: bank the run from wherever you stand.
 * The checkpoint does NOT move — the feather buys safety, not progress. */
function escapeByFeather(
  set: (partial: Partial<GameState>) => void,
  get: () => GameState,
) {
  const state = get();
  const banked = bankCarried(state);
  persistCurrent({ ...state, ...banked });
  session.sendEscape(toWireInventory({ ...banked, chest: state.chest }));
  session.leaveDungeon();
  playPortal();
  set({
    phase: "village",
    ...banked,
    floor: 0,
    health: computeStats(banked.equipment).maxHealth,
    mana: PLAYER.maxMana,
    prompt: null,
    overlay: "none",
  });
  gameEvents.emit("message", "The feather carries you home — loot banked");
}

/** Death: everything picked up during this run is lost. */
function die(
  set: (partial: Partial<GameState>) => void,
  get: () => GameState,
) {
  const state = get();
  const lostItems: string[] = [];
  const strip = (slot: "amulet" | "cloak" | "boots") => {
    const item = state.equipment[slot];
    if (item?.runLoot) {
      lostItems.push(resolveItem(item.defId).name);
      return null;
    }
    return item;
  };
  const kept: Equipment = {
    // The staff is mandatory — a lost run staff falls back to the starter.
    staff: state.equipment.staff.runLoot
      ? (lostItems.push(resolveItem(state.equipment.staff.defId).name),
        defaultSave().equipment.staff)
      : state.equipment.staff,
    amulet: strip("amulet"),
    cloak: strip("cloak"),
    boots: strip("boots"),
  };
  const bagResult = stripRunLoot(state.bag);
  const beltResult = stripRunLoot(state.belt);
  for (const s of [...bagResult.lost, ...beltResult.lost]) {
    const name = resolveItem(s.defId).name;
    lostItems.push(s.qty > 1 ? `${name} ×${s.qty}` : name);
  }
  persistCurrent({ ...state, equipment: kept, bag: bagResult.grid, belt: beltResult.grid });
  session.sendDied(); // the server discards this run's grants
  session.leaveDungeon();
  set({
    phase: "dead",
    equipment: kept,
    bag: bagResult.grid,
    belt: beltResult.grid,
    health: computeStats(kept).maxHealth,
    lastDeath: { floor: state.floor, lostItems, lostGold: state.runGold },
    runGold: 0,
    prompt: null,
    overlay: "none",
  });
}

// Server-authoritative save: applied on login and after each bank ack. The
// local save becomes a cache of it. Never applied mid-run — a reconnecting
// player keeps their in-run gear; the server still validates at the bank.
netBus.on("serverSave", (save) => {
  const state = useGame.getState();
  if (state.phase === "dungeon" || state.phase === "loading") return;
  // Gamble reveal: whatever the authoritative save gained over local state
  // is what the orb produced (nothing gained = the server refused).
  if (pendingGamble) {
    pendingGamble = false;
    const before = multisetOf(toWireInventory(state));
    const after = multisetOf(save.inventory);
    let won: string | null = null;
    for (const [id, qty] of after) if (qty > (before.get(id) ?? 0)) won = id;
    gameEvents.emit(
      "message",
      won ? `The orb reveals: ${resolveItem(won).name}` : "The orb stays dark — nothing changes",
    );
    if (won) playPickup();
  }
  const inv = fromWireInventory(save.inventory);
  useGame.setState({
    checkpoint: save.checkpoint,
    ...inv,
    runGold: 0,
    health: computeStats(inv.equipment).maxHealth,
  });
  persistCurrent({ checkpoint: save.checkpoint, ...inv });
});

// Reconnect resync: the session re-enters our floor after a dropped socket.
// If the new assignment differs (fresh instance/seed), remount the floor so
// we land in a consistent world; the normal join path resyncs its state.
netBus.on("assigned", (a) => {
  const state = useGame.getState();
  if (state.phase !== "dungeon") return;
  if (state.floorSeed === a.seed && state.instanceId === a.instanceId) return;
  useGame.setState({ floor: a.floor, floorSeed: a.seed, instanceId: a.instanceId });
});

// Dev-only hook for debugging and end-to-end scripts.
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__game = useGame;
}

/** Current derived stats — cheap enough to compute on demand. */
export function getStats(): DerivedStats {
  return computeStats(useGame.getState().equipment);
}

/** Enemies think and deal contact damage only while combat is live: the
 * dungeon, or — in dev builds only — the village, so the dev-room slab can
 * spawn a test arena. In production `import.meta.env.DEV` is a literal false,
 * so this is exactly `phase === "dungeon"` and the village branch is stripped. */
export function combatActive(): boolean {
  const phase = useGame.getState().phase;
  return phase === "dungeon" || (import.meta.env.DEV && phase === "village");
}

/** Entry floors selectable at the village portal. */
export function entryFloors(checkpoint: number): number[] {
  const floors = [1];
  for (let f = DUNGEON.checkpointInterval; f <= checkpoint; f += DUNGEON.checkpointInterval) {
    floors.push(f);
  }
  return floors;
}
