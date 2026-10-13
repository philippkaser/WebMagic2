import type { BuffId } from "../items/types";
import type { RoomEventSpawn, Vec3 } from "../world/types";
import { ROOM_EVENT_RULES as R, shrineBoon } from "./catalog";

/** The room events' rules, as pure state machines the floor authority runs
 * (roomEvents/net.ts) and every client renders. Each step returns the next
 * state and the EFFECTS it asks for — spawn these guardians, give the
 * reward, bless that wizard — which the authority carries out. Nothing here
 * touches the network, the scene or a random number, so the whole of it is
 * unit-tested (rules.test.ts).
 *
 *   vault:    sealed ─(someone enters the room)→ guarded ─(guardians dead)→ open ─(E)→ looted
 *   ward:     dormant ─(E)→ kindled ─(held long enough)→ won
 *                               └──(left empty too long)→ broken
 *   shrine, fountain: once per wizard, by E. */

export type RoomEventState =
  | { kind: "vault"; phase: "sealed" | "guarded" | "open" | "looted"; t: number; guards: string[] }
  | { kind: "ward"; phase: "dormant" | "kindled" | "won" | "broken"; progress: number; waves: number; idle: number }
  | { kind: "shrine" | "fountain"; takenBy: string[] };

export type RoomGift = { buff: BuffId } | { restore: true };

export type RoomEffect =
  /** Spawn foes with these ids at these points (the authority picks kinds). */
  | { type: "spawn"; ids: string[]; at: Vec3[] }
  /** Give the room's reward at the event. */
  | { type: "reward"; kind: "vault" | "ward" }
  /** A wizard's own gift (a shrine's boon, the fountain's mending). */
  | { type: "gift"; to: string; gift: RoomGift };

/** What the authority sees around an event this tick. */
export interface RoomView {
  /** Wizards inside the event's room. */
  inRoom: number;
  /** Wizards inside a ward's circle. */
  inCircle: number;
  /** Of this event's guards, how many are still alive. */
  guardsAlive: number;
}

export interface RoomStep {
  state: RoomEventState;
  effects: RoomEffect[];
}

export function initialRoomState(spawn: RoomEventSpawn): RoomEventState {
  switch (spawn.kind) {
    case "vault":
      return { kind: "vault", phase: "sealed", t: 0, guards: [] };
    case "ward":
      return { kind: "ward", phase: "dormant", progress: 0, waves: 0, idle: 0 };
    default:
      return { kind: spawn.kind, takenBy: [] };
  }
}

/** A wizard pressed E at the event. Null: nothing happens. */
export function actOnRoomEvent(spawn: RoomEventSpawn, state: RoomEventState, by: string, floor: number): RoomStep | null {
  switch (state.kind) {
    case "vault":
      if (state.phase !== "open") return null;
      return { state: { ...state, phase: "looted" }, effects: [{ type: "reward", kind: "vault" }] };
    case "ward": {
      if (state.phase !== "dormant") return null;
      const wave = waveOf(spawn, 0, floor);
      return {
        state: { ...state, phase: "kindled", progress: 0, waves: 1, idle: 0 },
        effects: [{ type: "spawn", ...wave }],
      };
    }
    case "shrine":
    case "fountain": {
      if (state.takenBy.includes(by)) return null;
      const gift: RoomGift = state.kind === "shrine" ? { buff: shrineBoon(spawn.variant) } : { restore: true };
      return { state: { ...state, takenBy: [...state.takenBy, by] }, effects: [{ type: "gift", to: by, gift }] };
    }
  }
}

/** Advance an event by `dt` seconds. Null: nothing changed (so the authority
 * only announces real changes). */
export function tickRoomEvent(spawn: RoomEventSpawn, state: RoomEventState, dt: number, view: RoomView, floor: number): RoomStep | null {
  switch (state.kind) {
    case "vault": {
      if (state.phase === "sealed") {
        if (view.inRoom === 0) return null;
        const ids = Array.from({ length: R.vaultGuards(floor) }, (_, i) => `${spawn.id}g${i}`);
        return {
          state: { ...state, phase: "guarded", t: 0, guards: ids },
          effects: [{ type: "spawn", ids, at: aroundRoom(spawn, ids.length, 0) }],
        };
      }
      if (state.phase === "guarded") {
        const t = state.t + dt;
        if (t >= R.vaultGrace && view.guardsAlive === 0) return { state: { ...state, phase: "open", t }, effects: [] };
        // Time only matters until the grace is up: don't announce every tick.
        return state.t < R.vaultGrace ? { state: { ...state, t }, effects: [] } : null;
      }
      return null;
    }
    case "ward": {
      if (state.phase !== "kindled") return null;
      const held = view.inCircle > 0;
      const progress = held
        ? Math.min(1, state.progress + dt / R.wardSeconds)
        : Math.max(0, state.progress - (dt / R.wardSeconds) * R.wardDrain);
      const idle = held ? 0 : state.idle + dt;
      if (idle >= R.wardAbandon) return { state: { ...state, phase: "broken", progress, idle }, effects: [] };
      if (progress >= 1) return { state: { ...state, phase: "won", progress: 1, idle: 0 }, effects: [{ type: "reward", kind: "ward" }] };
      const effects: RoomEffect[] = [];
      let waves = state.waves;
      // The next wave lands once progress passes its mark.
      if (waves < R.wardWaves.length && progress >= R.wardWaves[waves]!) {
        effects.push({ type: "spawn", ...waveOf(spawn, waves, floor) });
        waves++;
      }
      return { state: { ...state, progress, idle, waves }, effects };
    }
    default:
      return null;
  }
}

function waveOf(spawn: RoomEventSpawn, wave: number, floor: number): { ids: string[]; at: Vec3[] } {
  const n = R.wardWaveSize(floor);
  const ids = Array.from({ length: n }, (_, i) => `${spawn.id}w${wave}g${i}`);
  return { ids, at: aroundRoom(spawn, n, wave) };
}

/** Where guardians appear: spread round the room's edge (inset from the
 * walls), turned a little each wave so they come from new sides. */
export function aroundRoom(spawn: RoomEventSpawn, count: number, wave: number): Vec3[] {
  const [minX, minZ, maxX, maxZ] = spawn.area;
  const inset = 1.2;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const hx = Math.max(0, (maxX - minX) / 2 - inset);
  const hz = Math.max(0, (maxZ - minZ) / 2 - inset);
  const out: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const a = ((i + 0.5) / count) * Math.PI * 2 + wave * 0.9 + 0.4;
    // Push the direction out to the inset rectangle's edge.
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const k = Math.min(hx / Math.max(1e-6, Math.abs(dx)), hz / Math.max(1e-6, Math.abs(dz)));
    out.push([cx + dx * k, 1.2, cz + dz * k]);
  }
  return out;
}

/** True when nothing more can happen at this event (for map ink, lights). */
export function isSpent(state: RoomEventState): boolean {
  switch (state.kind) {
    case "vault":
      return state.phase === "looted";
    case "ward":
      return state.phase === "won" || state.phase === "broken";
    default:
      return false;
  }
}
