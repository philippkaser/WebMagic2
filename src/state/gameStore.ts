import { create } from "zustand";
import { playHurt, playPickup, playWeighing } from "../audio/sound";
import { setHeadphones } from "../audio/spatial";
import { DUNGEON, PLAYER, PVP } from "../core/config";
import { gameEvents } from "../core/events";
import { Rng } from "../core/rng";
import { KillCredit } from "../encounters/killCredit";
import type { DamageSource } from "../game/damageSource";
import { getFloorRules } from "../game/floorRules";
import { harmWizard } from "../game/vitality";
import { computeStats, getItemDef, hasProc, resolveItem } from "../items/catalog";
import { gamblePrice, merchantPrice, multisetOf, sellValue } from "../items/economy";
import {
  addToGrid,
  clearSlot,
  moveItem as moveItemPure,
  readSlot,
  routeAcquire,
  takeOneAt,
  type Carried,
  type Grid,
  type SlotRef,
} from "../items/inventory";
import { addBuff, getBuffDef, liveBuffs, withBlessings, type ActiveBuff } from "../items/buffs";
import { applyCraft, describeOutcome, type CraftOutcome } from "../items/crafting";
import type { WireSlot } from "../net/protocol";
import { rollGamble } from "../items/loot";
import type { DerivedStats, Equipment } from "../items/types";
import { netBus } from "../net/bus";
import { useNet } from "../net/netStore";
import { session } from "../net/session";
import { bankKit, settleDeath, type LostStack } from "../run/outcomes";
import { canLeave, entryFloorFor, floorsUntilExit, gearLevel } from "../run/rules";
import { askFork } from "../transition/fork";
import { isTraveling, travel } from "../transition/travel";
import {
  defaultSave,
  fromWireInventory,
  loadSave,
  persistSave,
  toWireInventory,
  type SaveData,
} from "./persistence";

/** Game flow: menu → village → weighing (the portal reads your gear) →
 * loading → dungeon → (walk home → village) | (dead → village). */
export type Phase = "menu" | "village" | "weighing" | "loading" | "dungeon" | "dead";

/** Fullscreen in-game screens (inventory family, the lore codex). The world
 * keeps simulating (shared floors can't pause), so these are DOM layers, not
 * phases. "devroom" is a dev-only testing panel (see ui/DevRoom) reached from
 * the village dev slab. */
export type Overlay = "none" | "inventory" | "chest" | "merchant" | "cauldron" | "forge" | "guild" | "arena" | "codex" | "devroom";

/** The current run, while in the dungeon. */
export interface RunProgress {
  /** Floor the Weighing cast us to. */
  startFloor: number;
  /** Floors entered this run, counting the current one (the Tithe of Five). */
  floorsPlayed: number;
}

export interface DeathRecord {
  floor: number;
  lostItems: string[];
  lostGold: number;
  /** Name of the wizard credited with the kill, or null (the dungeon). */
  killer: string | null;
  /** True when the loss stayed behind in a grave (a shared floor). */
  grave: boolean;
}

export interface GameState {
  phase: Phase;
  floor: number;
  floorSeed: number;
  instanceId: string;
  /** Deepest floor ever walked home from (0 = never) — a trophy, and the
   * Orb of Fortune's reference depth. */
  deepest: number;
  run: RunProgress | null;
  health: number;
  mana: number;
  equipment: Equipment;
  /** 5 carry slots — at risk in the dungeon until banked, like equipment. */
  bag: Grid;
  /** 2 quick slots for consumables: belt[0] = Q, belt[1] = E. */
  belt: Grid;
  /** The reagent pouch — materials only, at risk like the bag. */
  pouch: Grid;
  /** 30 slots, lives in the village — never carried, never at risk. */
  chest: Grid;
  /** Banked gold (safe). */
  gold: number;
  /** Gold gathered this run — lost on death, banked with the rest. */
  runGold: number;
  /** Timed blessings from elixirs (items/buffs.ts), ended by time or death. */
  buffs: ActiveBuff[];
  overlay: Overlay;
  /** Contextual interaction prompt ("E — Descend…") and where in the world
   * it belongs (null = in front of the player). */
  prompt: string | null;
  promptAt: [number, number, number] | null;
  lastDeath: DeathRecord | null;
  /** Quality toggle: the staff/moon shadow costs several extra scene renders
   * per frame, so it's opt-in. */
  shadows: boolean;
  /** Quality toggle: planar reflections on the dungeon floors (one extra
   * low-res scene render per frame). Off by default — the painted floors
   * carry their own wet glints — and persisted. */
  reflections: boolean;
  /** Sound for headphones (each ear its own cues: the timing round the
   * head, its shadow — sounds outside your head, all round you) or for
   * speakers (a pan). Headphones by default; persisted. */
  headphones: boolean;
  /** Motion blur from the camera's own movement (render/post/LensEffect):
   * on by default — it's a shutter, not a smear — but some eyes dislike it
   * in a first-person game, so it's a setting; persisted. */
  motionBlur: boolean;
  /** Display name shown to floor-mates. */
  playerName: string;

  startGame(): void;
  /** Step up to the village portal: the Weighing reads your gear. */
  openWeighing(): void;
  closeWeighing(): void;
  /** Step through: a fresh run, cast to the floor your gear resonates at.
   * Like every scene switch, it plays as a journey (transition/travel.ts):
   * the phase goes "loading" at once, the switch itself runs under the
   * tunnel, and the promise settles once you've arrived. */
  enterDungeon(): Promise<void>;
  descend(): Promise<void>;
  /** Through an open way-home portal: bank everything carried. */
  walkHome(): Promise<void>;
  /** Into the floor's one rift: it forks (deeper / home) once the Tithe of
   * Five is paid — the wizard chooses in the void (transition/fork.ts). */
  enterRift(): Promise<void>;
  /** Can this pickup go ANYWHERE right now? Gates loot-orb prompts. */
  canAcquire(defId: string): boolean;
  /** Route a granted pickup (items/inventory.ts routeAcquire). Returns false
   * if truly full. */
  acquireItem(defId: string): boolean;
  /** Route `qty` copies (a clutch of reagents) — one message for all. */
  acquireMany(defId: string, qty: number): number;
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
  /** Wenna's cauldron / Brannoc's forge (items/crafting.ts): work `recipe`,
   * on the item at `target` for the forge's item work. Village only;
   * server-rolled online. */
  craft(recipe: string, target?: SlotRef): void;
  buyItem(defId: string): void;
  setOverlay(overlay: Overlay): void;
  /** Hurt the local wizard. `source` attributes the hit (kill credit, grave
   * chests); omitted = the dungeon itself. */
  takeDamage(amount: number, source?: DamageSource): void;
  heal(amount: number): void;
  spendMana(cost: number): boolean;
  regenMana(dt: number): void;
  /** From the death screen back to the village (a journey, like the rest). */
  respawn(): Promise<void>;
  setPrompt(prompt: string | null, at?: [number, number, number] | null): void;
  toggleShadows(): void;
  toggleReflections(): void;
  toggleHeadphones(): void;
  toggleMotionBlur(): void;
  setPlayerName(name: string): void;
}

const SHADOWS_KEY = "webmagic.shadows.v1";
const REFLECTIONS_KEY = "webmagic.reflections.v1";
const HEADPHONES_KEY = "webmagic.headphones.v1";
const MOTION_BLUR_KEY = "webmagic.motionblur.v1";
const NAME_KEY = "webmagic.name.v1";

function loadShadowSetting(): boolean {
  try {
    return localStorage.getItem(SHADOWS_KEY) === "1";
  } catch {
    return false;
  }
}

function loadHeadphoneSetting(): boolean {
  try {
    return localStorage.getItem(HEADPHONES_KEY) !== "0";
  } catch {
    return true;
  }
}

function loadReflectionSetting(): boolean {
  try {
    // Default OFF: a mirror floor reads smooth and modern next to the
    // painted pixel stone, whose wet texels glint on their own. Only an
    // explicit "1" turns the planar reflection on.
    return localStorage.getItem(REFLECTIONS_KEY) === "1";
  } catch {
    return false;
  }
}

function loadMotionBlurSetting(): boolean {
  try {
    return localStorage.getItem(MOTION_BLUR_KEY) !== "0";
  } catch {
    return true;
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
/** Who's been hurting us — names the killer if we fall (encounters). */
const killCredit = new KillCredit(PVP.killCreditSeconds * 1000);
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
/** A venue's own rule for a fall — in the Proving Ground you yield, you
 * don't die (arena/arenaFlow.ts). Told who struck last; returns true when it
 * took the fall, and the dungeon's death never runs. */
let fallRule: ((killerId: string | null) => boolean) | null = null;
export function setFallRule(rule: ((killerId: string | null) => boolean) | null): void {
  fallRule = rule;
}
/** An Orb of Fortune is in the server's hands — reveal on the next save. */
let pendingGamble = false;
/** The floor (instance:floor) the Phoenix last refused a death on. */
let phoenixFloor = "";
/** Lethal grace (game/vitality): when it can next catch a killing blow,
 * and the end of the Brink's window it opened — seconds, performance clock.
 * Module-level like the Phoenix's floor: rules state, not something the
 * HUD re-renders on. A fresh run (or a death) starts them over. */
let graceReadyAt = 0;
let brinkUntil = 0;
/** After the Brink, nothing lands for this long: a moment to dash, to run,
 * to drink — the world slowed around you (the Brink's slow motion). */
export const BRINK_WINDOW_S = 0.6;

/** Seconds left of the Brink's window (0 outside it). */
export function brinkLeft(now = performance.now() / 1000): number {
  return Math.max(0, brinkUntil - now);
}

function resetGrace(): void {
  graceReadyAt = 0;
  brinkUntil = 0;
}
/** A craft is in the server's hands (its recipe id). */
/** A craft sent to the server and not yet answered (one at a time: a second
 * press would be judged against the same stale inventory). */
let craftInFlight = false;
let craftTimeout: ReturnType<typeof setTimeout> | null = null;

export const useGame = create<GameState>((set, get) => ({
  phase: "menu",
  floor: 0,
  floorSeed: 0,
  instanceId: "",
  deepest: saved.deepest,
  run: null,
  health: computeStats(saved.equipment).maxHealth,
  mana: PLAYER.maxMana,
  equipment: saved.equipment,
  bag: saved.bag,
  belt: saved.belt,
  pouch: saved.pouch,
  chest: saved.chest,
  gold: saved.gold,
  runGold: 0,
  buffs: [],
  overlay: "none",
  prompt: null,
  promptAt: null,
  lastDeath: null,
  shadows: loadShadowSetting(),
  reflections: loadReflectionSetting(),
  headphones: loadHeadphoneSetting(),
  motionBlur: loadMotionBlurSetting(),
  playerName: loadPlayerName(),

  startGame: () => {
    set({ phase: "village" });
    // Log in as whoever this browser is — a member, a guest, or (no token
    // yet) a brand-new guest — so the village holds the server's save.
    void session.ensureConnected(get().playerName);
  },

  openWeighing: () => {
    playWeighing();
    set({ phase: "weighing", prompt: null, overlay: "none" });
  },
  closeWeighing: () => set({ phase: "village" }),

  enterDungeon: async () => {
    if (isTraveling()) return;
    const entry = resonanceOf(get().equipment).entryFloor;
    set({ phase: "loading", prompt: null, overlay: "none" });
    await travel("gate", async () => {
      await session.ensureConnected(get().playerName);
      // Online the server re-derives the floor from our BANKED gear and its
      // answer wins (the assignment carries it).
      const assignment = await session.requestFloor(entry, true);
      const stats = getStats();
      killCredit.reset();
      resetGrace();
      set({
        phase: "dungeon",
        floor: assignment.floor,
        floorSeed: assignment.seed,
        instanceId: assignment.instanceId,
        // The server's count is the one the way home is judged by.
        run: { startFloor: assignment.floor, floorsPlayed: assignment.runFloors ?? 1 },
        health: stats.maxHealth,
        mana: PLAYER.maxMana,
        lastDeath: null,
      });
      gameEvents.emit("message", `The Weighing casts you down to floor ${assignment.floor}.`);
    });
  },

  descend: async () => {
    const run = get().run;
    const next = get().floor + 1;
    if (!run || next > DUNGEON.maxFloor || isTraveling()) return;
    set({ phase: "loading", prompt: null, overlay: "none" });
    await travel("descend", () => descendSwitch(set, get));
  },

  walkHome: async () => {
    const start = get();
    if (!start.run || !canLeave(start.run.floorsPlayed) || isTraveling()) return;
    // "loading" at once: input, casting and damage stop while the portal
    // takes you (the floor stays mounted underneath — floor > 0).
    set({ phase: "loading", prompt: null, overlay: "none" });
    await travel("home", () => homeSwitch(set, get));
  },

  enterRift: async () => {
    const start = get();
    if (!start.run || isTraveling()) return;
    const homeOpen = canLeave(start.run.floorsPlayed);
    const deeperOpen = start.floor + 1 <= DUNGEON.maxFloor;
    if (!homeOpen && !deeperOpen) return;
    set({ phase: "loading", prompt: null, overlay: "none" });
    await travel("fork", async () => {
      const way = await askFork({
        homeOpen,
        deeperOpen,
        nextFloor: start.floor + 1,
        owed: floorsUntilExit(start.run!.floorsPlayed),
      });
      if (way === "home") {
        homeSwitch(set, get);
        return { arriveAs: "home" as const };
      }
      await descendSwitch(set, get);
      return { arriveAs: "descend" as const };
    });
  },

  // Whether a pickup is at risk depends on whether a run is open — not on
  // the phase (a grant can land mid-journey, while the phase is "loading").
  canAcquire: (defId) => routeAcquire(carriedOf(get()), defId, get().run !== null) !== null,

  acquireItem: (defId) => {
    const state = get();
    const item = resolveItem(defId);
    const routed = routeAcquire(carriedOf(state), defId, state.run !== null);
    if (!routed) {
      // Pickups are gated on canAcquire before the grant, so this only
      // happens on a rare co-op race (bag filled while the request flew).
      gameEvents.emit("message", `${item.name} slips away — inventory full`);
      return false;
    }
    set({ ...routed.next, health: clampedHealth({ ...state, ...routed.next }) });
    playPickup();
    gameEvents.emit(
      "message",
      routed.to === "equipped" ? `${item.name} equipped` : `${item.name} → ${routed.to}`,
    );
    syncVillage(get());
    return true;
  },

  acquireMany: (defId, qty) => {
    let carried = carriedOf(get());
    let got = 0;
    let to = "";
    for (let i = 0; i < qty; i++) {
      const routed = routeAcquire(carried, defId, get().run !== null);
      if (!routed) break;
      carried = routed.next;
      to = routed.to;
      got++;
    }
    const name = resolveItem(defId).name;
    if (got === 0) {
      gameEvents.emit("message", `${name} slips away — no room`);
      return 0;
    }
    set({ ...carried, health: clampedHealth({ ...get(), ...carried }) });
    playPickup();
    gameEvents.emit("message", `${name} ×${got} → ${to}${got < qty ? " (no room for the rest)" : ""}`);
    syncVillage(get());
    return got;
  },

  addGold: (amount) => {
    if (amount <= 0) return;
    if (get().run !== null) {
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
    const price = gamblePrice(state.deepest);
    if (state.gold < price) {
      gameEvents.emit("message", "Not enough gold");
      return;
    }
    if (!state.bag.includes(null)) {
      gameEvents.emit("message", "No bag room for what fortune brings");
      return;
    }
    if (useNet.getState().mode === "connecting") {
      gameEvents.emit("message", "Maro waits — the camp's ledger is still opening");
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
    const rolled = rollGamble(new Rng((Math.random() * 0xffffffff) >>> 0), state.deepest);
    const bag = addToGrid(state.bag, rolled, false)!;
    set({ gold: state.gold - price, bag });
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
      // The Proving Ground is the one "dungeon" with no run: nothing to bank,
      // and the only road home is Varr's. Flown anyway, the hall would lose
      // us while this client still thought it held us.
      if (!state.run) {
        gameEvents.emit("message", "The feather won't carry you out of the Proving Ground");
        return;
      }
      if (isTraveling()) return;
      set({ belt: takeOneAt(state.belt, index), phase: "loading", prompt: null, overlay: "none" });
      void travel("feather", () => escapeByFeather(set, get));
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
    if (effect.buff) {
      const now = performance.now();
      set({ buffs: addBuff(liveBuffs(get().buffs, now), effect.buff, now) });
      const buff = getBuffDef(effect.buff);
      gameEvents.emit("buff", { id: effect.buff, seconds: buff.seconds });
    }
    playPickup();
    gameEvents.emit("message", `${def.name} used`);
    syncVillage(get());
  },

  craft: (recipe, target) => {
    const state = get();
    if (state.phase !== "village") {
      gameEvents.emit("message", "The cauldron and the forge are back in the camp");
      return;
    }
    const mode = useNet.getState().mode;
    if (mode === "connecting") {
      gameEvents.emit("message", "The forge is still cold — the camp's ledger is opening");
      return;
    }
    if (craftInFlight) return; // the last work is still on the anvil
    const wireTarget = target ? toWireSlot(target) : undefined;
    const expect = target ? readSlot(carriedOf(state), target)?.defId : undefined;
    // A local dry run answers "can I?" at once (and is the whole craft
    // offline, where the local save is the record).
    const local = applyCraft(toWireInventory(state), { recipe, target: wireTarget }, new Rng((Math.random() * 0xffffffff) >>> 0), {
      deepest: state.deepest,
    });
    if (!local.ok) {
      gameEvents.emit("message", local.reason);
      gameEvents.emit("crafted", { ok: false, recipe, text: local.reason });
      return;
    }
    if (mode === "online") {
      craftInFlight = true;
      // A lost reply mustn't lock the forge for good.
      craftTimeout = setTimeout(() => (craftInFlight = false), 10_000);
      session.sendCraft(recipe, wireTarget, expect);
      return;
    }
    const inv = fromWireInventory(local.inventory);
    set({ ...inv, health: clampedHealth({ ...get(), ...inv }) });
    persistCurrent(get());
    announceCraft(recipe, local);
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

  takeDamage: (amount, source) => {
    const state = get();
    if (state.phase !== "dungeon" && state.phase !== "village") return;
    if (import.meta.env.DEV && devInvuln) return; // dev-room god mode
    const now = performance.now() / 1000;
    // The Brink's window: nothing lands while you get away.
    if (now < brinkUntil) return;
    killCredit.record(source, performance.now(), useNet.getState().playerId || "self");
    const stats = getStats();
    // The blow as your gear takes it, then the wizard's own rules
    // (game/vitality): below the last-stand line harm is halved, and a
    // killing blow taken from half health or more leaves you on 1 — the
    // Brink — once a while. Every blow counts, a wizard's spell as much as a
    // monster's: the rule is the victim's, the same for every wizard, so it
    // is as fair in PvP as in co-op (and the attacker sees the Brink coming:
    // net/players carries it).
    const harm = harmWizard(state.health, stats.maxHealth, amount * stats.damageTakenMult, now, graceReadyAt);
    // What you really lost (overkill included): the hurt, the shake and the
    // HUD's flash report this, not the blow's face value.
    const dealt = state.health - harm.health;
    let health = Math.max(0, harm.health);
    if (harm.brink) {
      graceReadyAt = harm.graceReadyAt;
      brinkUntil = now + BRINK_WINDOW_S;
    }
    // A venue's own rule takes the fall before the Phoenix is asked (the
    // Proving Ground's yield costs nothing, so it mustn't spend the save).
    const yielded = health <= 0 && !!fallRule?.(killCredit.killer(performance.now()));
    // Heart of the Phoenix: once a floor, a killing blow is refused — the
    // true-death save, past grace (which, caught first, leaves it unspent).
    if (!yielded && health <= 0 && state.phase === "dungeon" && hasProc(stats, "phoenix") && phoenixFloor !== `${state.instanceId}:${state.floor}`) {
      phoenixFloor = `${state.instanceId}:${state.floor}`;
      health = Math.round(stats.maxHealth * 0.35);
      gameEvents.emit("phoenix", undefined);
      gameEvents.emit("message", "The Phoenix refuses your death — once.");
    }
    playHurt();
    gameEvents.emit("playerHurt", { amount: dealt });
    gameEvents.emit("shake", Math.min(dealt / 40, 1));
    if (harm.brink) gameEvents.emit("wizardBrink", { from: state.health, max: stats.maxHealth });
    if (yielded) {
      killCredit.reset();
      set({ health: 0 });
    } else if (health <= 0) {
      // "loading" at once so nothing can hurt (or move, or cast for) the
      // falling wizard while the world burns away; the death itself — losses,
      // the grave, leaving the floor — runs at the journey's switch, while
      // the floor is still mounted underneath.
      set({ health: 0, phase: "loading", prompt: null, overlay: "none" });
      void travel("death", () => die(set, get));
    } else {
      set({ health });
    }
  },

  heal: (amount) => {
    const from = get().health;
    const max = getStats().maxHealth;
    const to = Math.min(from + amount, max);
    set({ health: to });
    // Heard by the second wind (game/heart releaseOf) and the orb.
    if (to > from) gameEvents.emit("wizardHealed", { from, to, max });
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
    manaAccumulator +=
      PLAYER.manaRegen * getStats().manaRegenMult * getFloorRules().manaRegenMult * dt;
    if (manaAccumulator >= 1.25) {
      set({ mana: Math.min(PLAYER.maxMana, mana + manaAccumulator) });
      manaAccumulator = 0;
    }
  },

  respawn: async () => {
    if (isTraveling()) return;
    // floor 0 now: the village (already mounted behind the death screen)
    // stays up under the tunnel instead of the lost floor remounting.
    set({ phase: "loading", floor: 0, prompt: null, overlay: "none" });
    await travel("respawn", () => {
      resetGrace();
      set({
        phase: "village",
        floor: 0,
        health: getStats().maxHealth,
        mana: PLAYER.maxMana,
        prompt: null,
        overlay: "none",
      });
    });
  },

  setPrompt: (prompt, at = null) => {
    const prev = get();
    // Same prompt, anchor moved by less than a hand's width: no store churn
    // (floating loot bobs every frame).
    const moved =
      (at === null) !== (prev.promptAt === null) ||
      (at !== null &&
        prev.promptAt !== null &&
        (at[0] - prev.promptAt[0]) ** 2 + (at[1] - prev.promptAt[1]) ** 2 + (at[2] - prev.promptAt[2]) ** 2 > 0.01);
    if (prev.prompt !== prompt || moved) set({ prompt, promptAt: at });
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

  toggleHeadphones: () => {
    const headphones = !get().headphones;
    set({ headphones });
    setHeadphones(headphones);
    try {
      localStorage.setItem(HEADPHONES_KEY, headphones ? "1" : "0");
    } catch {
      // Setting is session-only without storage.
    }
    gameEvents.emit("message", `Sound for ${headphones ? "headphones" : "speakers"}`);
  },

  toggleReflections: () => {
    const reflections = !get().reflections;
    set({ reflections });
    try {
      localStorage.setItem(REFLECTIONS_KEY, reflections ? "1" : "0");
    } catch {
      // Setting is session-only without storage.
    }
    gameEvents.emit("message", `Reflections ${reflections ? "on" : "off"}`);
  },

  toggleMotionBlur: () => {
    const motionBlur = !get().motionBlur;
    set({ motionBlur });
    try {
      localStorage.setItem(MOTION_BLUR_KEY, motionBlur ? "1" : "0");
    } catch {
      // Setting is session-only without storage.
    }
    gameEvents.emit("message", `Motion blur ${motionBlur ? "on" : "off"}`);
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

/** Health never exceeds the (possibly just-changed) max. */
function clampedHealth(state: Pick<GameState, "health" | "equipment">): number {
  return Math.min(state.health, computeStats(state.equipment).maxHealth);
}

function carriedOf(state: GameState): Carried {
  return { equipment: state.equipment, bag: state.bag, belt: state.belt, pouch: state.pouch, chest: state.chest };
}

/** Everything carried becomes safe; run gold joins the purse. */
function bankedState(state: GameState) {
  return {
    ...bankKit(state),
    gold: state.gold + state.runGold,
    runGold: 0,
  };
}

function persistCurrent(state: SaveData): void {
  persistSave({
    deepest: state.deepest,
    equipment: state.equipment,
    bag: state.bag,
    belt: state.belt,
    pouch: state.pouch,
    chest: state.chest,
    gold: state.gold,
  });
}

/** The descent itself, under a journey's tunnel: the next floor's instance
 * (the server counts the run), then the floor. */
async function descendSwitch(set: (partial: Partial<GameState>) => void, get: () => GameState): Promise<void> {
  const run = get().run!;
  const next = get().floor + 1;
  const assignment = await session.requestFloor(next);
  const floorsPlayed = assignment.runFloors ?? run.floorsPlayed + 1;
  set({
    phase: "dungeon",
    floor: assignment.floor,
    floorSeed: assignment.seed,
    instanceId: assignment.instanceId,
    run: { ...run, floorsPlayed },
  });
  const owed = floorsUntilExit(floorsPlayed);
  gameEvents.emit(
    "message",
    owed === 0
      ? `Floor ${assignment.floor} — the way home is open.`
      : `Floor ${assignment.floor} — ${owed} more floor${owed === 1 ? "" : "s"} before the deep lets go.`,
  );
}

/** Walking home, under a journey's tunnel: everything carried is banked. */
function homeSwitch(set: (partial: Partial<GameState>) => void, get: () => GameState): void {
  // Read the state at switch time: a host-granted pickup may still have
  // landed during the ENTER.
  const state = get();
  const banked = bankedState(state);
  const deepest = Math.max(state.deepest, state.floor);
  persistCurrent({ ...state, ...banked, deepest });
  // Server-side bank: provenance-validated; the "saved" ack corrects us if
  // anything didn't check out. Offline this is a no-op (local save rules).
  session.sendBank(toWireInventory({ ...banked, chest: state.chest }));
  session.leaveDungeon();
  resetGrace();
  set({
    phase: "village",
    ...banked,
    deepest,
    run: null,
    floor: 0,
    health: computeStats(banked.equipment).maxHealth,
    mana: PLAYER.maxMana,
    prompt: null,
    overlay: "none",
  });
  gameEvents.emit("message", `Home from floor ${state.floor}. Your loot is safe.`);
}

/** Village inventory changes persist immediately and sync to the server (a
 * rearrangement, never new items — the server checks). Mid-run changes are
 * session-local until banked. */
function syncVillage(state: GameState): void {
  if (state.phase === "dungeon" || state.phase === "loading") return;
  persistCurrent(state);
  session.sendStash(toWireInventory(state));
}

/** A spent Feather of Safe Passage: bank the run from wherever you stand,
 * even before the Tithe of Five is paid. It buys safety, not a new depth. */
function escapeByFeather(
  set: (partial: Partial<GameState>) => void,
  get: () => GameState,
) {
  const state = get();
  const banked = bankedState(state);
  persistCurrent({ ...state, ...banked });
  session.sendEscape(toWireInventory({ ...banked, chest: state.chest }));
  session.leaveDungeon();
  resetGrace();
  set({
    phase: "village",
    ...banked,
    run: null,
    floor: 0,
    health: computeStats(banked.equipment).maxHealth,
    mana: PLAYER.maxMana,
    prompt: null,
    overlay: "none",
  });
  gameEvents.emit("message", "The feather carries you home — loot banked");
}

/** Say what a craft made, and let the stations play it. */
function announceCraft(recipe: string, out: Extract<CraftOutcome, { ok: true }>): void {
  const text = describeOutcome(out);
  playPickup();
  const verb = recipe.startsWith("brew:") ? "Brewed" : recipe === "salvage" ? "Salvaged into" : recipe === "greatwork" ? "The Great Work yields" : "Forged";
  gameEvents.emit("message", `${verb}: ${text}`);
  gameEvents.emit("crafted", { ok: true, recipe, text, changed: out.changed?.to, produced: out.produced.map((s) => s.id) });
}

function toWireSlot(ref: SlotRef): WireSlot {
  return ref.container === "equipment" ? { c: "equipment", s: ref.slot } : { c: ref.container, i: ref.index };
}

/** Death: everything found this run is lost. On a shared floor it stays
 * behind in a grave (encounters/Graves listens for "wizardFell"). */
function die(
  set: (partial: Partial<GameState>) => void,
  get: () => GameState,
) {
  const state = get();
  const outcome = settleDeath(state, defaultSave().equipment.staff.defId);
  const net = useNet.getState();
  const selfId = net.playerId || "self";
  const killerId = killCredit.killer(performance.now());
  const killer = killerId ? (net.roster[killerId] ?? "a wizard") : null;
  const shared = net.mode === "online" && Object.keys(net.roster).some((id) => id !== selfId);
  const lost: LostStack[] = outcome.lost;
  const grave = shared && (lost.length > 0 || state.runGold > 0);

  // Before leaving: the floor must hear of the fall while we're still on it.
  gameEvents.emit("wizardFell", { items: lost, gold: state.runGold, killerId, shared });

  persistCurrent({ ...state, ...outcome.kept });
  session.sendDied(); // the server discards this run's grants
  session.leaveDungeon();
  // …and learns what survived: the banked kit as it stands now (draughts
  // drunk, gifts given away, cells moved) — a sub-multiset of its bank, so
  // the server's copy can't hand back what the run spent.
  session.sendStash(toWireInventory({ ...state, ...outcome.kept }));
  killCredit.reset();
  resetGrace();
  set({
    phase: "dead",
    ...outcome.kept,
    run: null,
    health: computeStats(outcome.kept.equipment).maxHealth,
    lastDeath: {
      floor: state.floor,
      lostItems: outcome.lostNames,
      lostGold: state.runGold,
      killer,
      grave,
    },
    runGold: 0,
    buffs: [],
    prompt: null,
    overlay: "none",
  });
}

// Server-authoritative save: applied on login and after each bank ack. The
// local save becomes a cache of it. Never applied mid-run — a reconnecting
// player keeps their in-run gear; the server still validates at the bank.
netBus.on("serverSave", (save) => {
  const state = useGame.getState();
  if (state.run || state.phase === "dungeon" || state.phase === "loading") return;
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
    deepest: save.deepest,
    ...inv,
    runGold: 0,
    health: computeStats(inv.equipment).maxHealth,
  });
  persistCurrent({ deepest: save.deepest, ...inv });
});

// The server worked (or refused) a craft: its save is the truth either way.
netBus.on("crafted", (msg) => {
  craftInFlight = false;
  if (craftTimeout) clearTimeout(craftTimeout);
  const state = useGame.getState();
  // Mid-run the local inventory holds the run; the bank settles it later.
  if (state.run) return;
  const recipe = msg.recipe;
  const inv = fromWireInventory(msg.save.inventory);
  useGame.setState({ deepest: msg.save.deepest, ...inv, health: clampedHealth({ ...useGame.getState(), ...inv }) });
  persistCurrent({ deepest: msg.save.deepest, ...inv });
  if (msg.ok) {
    announceCraft(recipe, { ok: true, inventory: msg.save.inventory, produced: msg.produced ?? [], changed: msg.changed });
  } else {
    gameEvents.emit("message", msg.reason ?? "The work failed");
    gameEvents.emit("crafted", { ok: false, recipe, text: msg.reason ?? "The work failed" });
  }
});

// Reconnect resync: the session re-enters our floor after a dropped socket.
// If the new assignment differs (fresh instance/seed), remount the floor so
// we land in a consistent world; the normal join path resyncs its state.
netBus.on("assigned", (a) => {
  const state = useGame.getState();
  if (state.phase !== "dungeon") return;
  if (state.run && a.runFloors !== undefined && a.runFloors !== state.run.floorsPlayed) {
    useGame.setState({ run: { ...state.run, floorsPlayed: a.runFloors } });
  }
  if (state.floorSeed === a.seed && state.instanceId === a.instanceId) return;
  useGame.setState({ floor: a.floor, floorSeed: a.seed, instanceId: a.instanceId });
});

// The ears start as the player left them.
setHeadphones(useGame.getState().headphones);

// Dev-only hooks for debugging and end-to-end scripts.
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__game = useGame;
  (window as unknown as Record<string, unknown>).__invuln = setDevInvuln;
}

/** Current derived stats — the gear's (cheap enough to compute on demand)
 * with any live blessings folded over it. */
export function getStats(): DerivedStats {
  const s = useGame.getState();
  const gear = computeStats(s.equipment);
  return s.buffs.length > 0 ? withBlessings(gear, s.buffs, performance.now()) : gear;
}

/** What the Weighing reads from this equipment: gear level and entry floor. */
export function resonanceOf(equipment: Equipment): { gearLevel: number; entryFloor: number } {
  const level = gearLevel([
    equipment.staff.defId,
    equipment.amulet?.defId,
    equipment.cloak?.defId,
    equipment.boots?.defId,
  ]);
  return { gearLevel: level, entryFloor: entryFloorFor(level) };
}

/** Enemies think and deal contact damage only while combat is live: the
 * dungeon, or — in dev builds only — the village, so the dev-room slab can
 * spawn a test arena. In production `import.meta.env.DEV` is a literal false,
 * so this is exactly `phase === "dungeon"` and the village branch is stripped. */
export function combatActive(): boolean {
  const phase = useGame.getState().phase;
  return phase === "dungeon" || (import.meta.env.DEV && phase === "village");
}
