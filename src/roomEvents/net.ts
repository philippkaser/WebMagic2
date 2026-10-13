import { create } from "zustand";
import { PLAYER } from "../core/config";
import { gameEvents } from "../core/events";
import { Rng } from "../core/rng";
import { liveSpawnIds, spawnEnemy } from "../enemies/spawnedStore";
import { playerPosition } from "../game/player-state";
import { wizardDistSqTo } from "../game/targets";
import { addBuff, getBuffDef, liveBuffs } from "../items/buffs";
import { dropGold, dropItem, dropReagent } from "../items/LootOrbs";
import { hostCommand, hostEvent } from "../net/channels";
import { isHost, useNet } from "../net/netStore";
import { estimatePeer, peerIds } from "../net/players";
import { getStats, useGame } from "../state/gameStore";
import { biomeForFloor, getBiomeDef } from "../world/biomes";
import { getCurrentLayout } from "../world/currentFloor";
import { pickEnemyKind } from "../world/gen/population";
import type { RoomEventSpawn, Vec3 } from "../world/types";
import { ROOM_EVENT_RULES, rollRoomReward } from "./catalog";
import {
  actOnRoomEvent,
  initialRoomState,
  tickRoomEvent,
  type RoomEffect,
  type RoomEventState,
  type RoomGift,
  type RoomStep,
  type RoomView,
} from "./rules";

/** The room events on the wire: the floor authority runs the rules
 * (roomEvents/rules.ts) and announces each event's state; everyone renders
 * what was announced. Pressing E is a request to the authority, which
 * range-checks it; a gift (a shrine's boon, the fountain's mending) is
 * announced to the one wizard it's for. Late joiners get every state from a
 * sync provider the <RoomEvents> shell registers. Offline the same requests
 * dispatch locally — one code path. */

interface RoomEventsStore {
  /** Announced state per event id, for the current floor. */
  states: Record<string, RoomEventState>;
}

export const useRoomEvents = create<RoomEventsStore>(() => ({ states: {} }));

export function roomStateOf(spawn: RoomEventSpawn): RoomEventState {
  return useRoomEvents.getState().states[spawn.id] ?? initialRoomState(spawn);
}

export function resetRoomEvents(states: Record<string, RoomEventState> = {}): void {
  useRoomEvents.setState({ states });
  working.clear();
  lastSent.clear();
}

const roomEventChanged = hostEvent<{ id: string; state: RoomEventState }>("roomEvent", (d) => {
  const prev = useRoomEvents.getState().states[d.id];
  useRoomEvents.setState((s) => ({ states: { ...s.states, [d.id]: d.state } }));
  announceChange(d.id, prev, d.state);
});

const roomGift = hostEvent<{ to: string; gift: RoomGift }>("roomGift", (d) => {
  const me = useNet.getState().playerId;
  if (d.to === me || d.to === "self") receiveGift(d.gift);
});

/** E pressed near an event: the authority checks the wizard really is there. */
const ACT_RANGE_SQ = 4 * 4;

const roomAct = hostCommand<{ id: string }>("roomAct", (d, meta) => {
  const spawn = getCurrentLayout()?.events.find((e) => e.id === d.id);
  if (!spawn) return;
  if (wizardDistSqTo(meta.from, spawn.pos[0], 1, spawn.pos[2]) > ACT_RANGE_SQ) return;
  const floor = getCurrentLayout()!.floor;
  const step = actOnRoomEvent(spawn, current(spawn), meta.from, floor);
  if (step) commit(spawn, step, true);
});

export function requestRoomAct(id: string): void {
  roomAct.request({ id });
}

// ── The authority's side ─────────────────────────────────────────────────────

/** The authority's working copy: ticked every frame, announced only when it
 * matters (see commit) — a ward's progress would otherwise flood the wire. */
const working = new Map<string, RoomEventState>();
const lastSent = new Map<string, number>();
/** How often a filling ward re-announces its progress (ms). */
const PROGRESS_EVERY_MS = 250;

function current(spawn: RoomEventSpawn): RoomEventState {
  // A new authority (host migration) starts from what was last announced.
  return working.get(spawn.id) ?? roomStateOf(spawn);
}

function commit(spawn: RoomEventSpawn, step: RoomStep, force: boolean): void {
  const before = current(spawn);
  working.set(spawn.id, step.state);
  const changed = force || step.effects.length > 0 || phaseOf(before) !== phaseOf(step.state);
  const now = performance.now();
  const due = step.state.kind === "ward" && now - (lastSent.get(spawn.id) ?? 0) >= PROGRESS_EVERY_MS;
  if (changed || due) {
    lastSent.set(spawn.id, now);
    roomEventChanged.announce({ id: spawn.id, state: step.state });
  }
  for (const e of step.effects) runEffect(spawn, e);
}

function phaseOf(s: RoomEventState): string {
  return "phase" in s ? s.phase : `${s.takenBy.length}`;
}

/** Run the rules for every event on the floor. Authority only. */
export function tickRoomEvents(events: readonly RoomEventSpawn[], dt: number, floor: number): void {
  if (!isHost() || events.length === 0) return;
  const live = liveSpawnIds();
  for (const spawn of events) {
    const state = current(spawn);
    if (!("phase" in state)) continue; // shrines and fountains only answer E
    const step = tickRoomEvent(spawn, state, dt, viewOf(spawn, state, live), floor);
    if (step) commit(spawn, step, false);
  }
}

function viewOf(spawn: RoomEventSpawn, state: RoomEventState, live: Set<string>): RoomView {
  const [minX, minZ, maxX, maxZ] = spawn.area;
  const r2 = ROOM_EVENT_RULES.wardRadius ** 2;
  let inRoom = 0;
  let inCircle = 0;
  const count = (x: number, z: number) => {
    if (x > minX && x < maxX && z > minZ && z < maxZ) inRoom++;
    if ((x - spawn.pos[0]) ** 2 + (z - spawn.pos[2]) ** 2 <= r2) inCircle++;
  };
  if (useGame.getState().phase === "dungeon") count(playerPosition.x, playerPosition.z);
  for (const id of peerIds()) {
    const p = estimatePeer(id);
    if (p) count(p.p[0], p.p[2]);
  }
  const guardsAlive = state.kind === "vault" ? state.guards.filter((g) => live.has(g)).length : 0;
  return { inRoom, inCircle, guardsAlive };
}

function runEffect(spawn: RoomEventSpawn, e: RoomEffect): void {
  const layout = getCurrentLayout();
  if (!layout) return;
  const floor = layout.floor;
  const rng = new Rng((Math.random() * 0xffffffff) >>> 0);
  switch (e.type) {
    case "spawn": {
      const weights = getBiomeDef(biomeForFloor(floor)).enemyWeights;
      e.ids.forEach((id, i) => spawnEnemy(pickEnemyKind(rng, floor, weights), 0, e.at[i]!, floor, id));
      return;
    }
    case "reward": {
      const reward = rollRoomReward(rng, e.kind, floor);
      const at = (k: number, of: number): Vec3 => {
        const a = (k / of) * Math.PI * 2 + spawn.facing;
        return [spawn.pos[0] + Math.cos(a) * 0.9, 1, spawn.pos[2] + Math.sin(a) * 0.9];
      };
      const n = 1 + reward.materials.length + reward.purses;
      let k = 0;
      dropItem(reward.item, at(k++, n));
      for (const m of reward.materials) dropReagent(m.id, m.qty, at(k++, n));
      for (let i = 0; i < reward.purses; i++) dropGold(at(k++, n), floor, 1, "enemy");
      return;
    }
    case "gift":
      roomGift.announce({ to: e.to, gift: e.gift });
      return;
  }
}

// ── Everyone's side ──────────────────────────────────────────────────────────

function receiveGift(gift: RoomGift): void {
  const game = useGame.getState();
  if ("buff" in gift) {
    const now = performance.now();
    useGame.setState({ buffs: addBuff(liveBuffs(game.buffs, now), gift.buff, now) });
    // A bargain that takes health takes it now.
    useGame.setState({ health: Math.min(useGame.getState().health, getStats().maxHealth) });
    const def = getBuffDef(gift.buff);
    gameEvents.emit("buff", { id: gift.buff, seconds: def.seconds });
    gameEvents.emit("message", `${def.name} — ${def.terms ?? "blessed"}`);
    return;
  }
  game.heal(getStats().maxHealth);
  useGame.setState({ mana: PLAYER.maxMana });
  gameEvents.emit("message", "The water mends you");
}

/** Words for the moments everyone on the floor should hear about. */
function announceChange(id: string, prev: RoomEventState | undefined, next: RoomEventState): void {
  if (!("phase" in next) || (prev && "phase" in prev && prev.phase === next.phase)) return;
  const spawn = getCurrentLayout()?.events.find((e) => e.id === id);
  if (!spawn) return;
  gameEvents.emit("roomEvent", { id, kind: spawn.kind, phase: next.phase, at: spawn.pos });
  const line =
    next.kind === "vault"
      ? next.phase === "guarded"
        ? "The vault's guardians wake!"
        : next.phase === "open"
          ? "The vault unseals"
          : null
      : next.phase === "kindled"
        ? "The ward kindles — hold the circle!"
        : next.phase === "won"
          ? "The ward holds. The deep pays its due"
          : next.phase === "broken"
            ? "The ward breaks"
            : null;
  if (line) gameEvents.emit("message", line);
}

// Dev-only hook for scripts: read the states, or force one (as the authority).
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__roomEvents = {
    states: () => useRoomEvents.getState().states,
    force: (id: string, state: RoomEventState) => {
      const spawn = getCurrentLayout()?.events.find((e) => e.id === id);
      if (spawn) commit(spawn, { state, effects: [] }, true);
    },
    act: (id: string) => roomAct.request({ id }),
  };
}
