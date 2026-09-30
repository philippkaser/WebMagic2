/** Minimal typed event bus decoupling gameplay systems from UI/FX. */

type Listener<T> = (payload: T) => void;

export class Emitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<never>);
    return () => set!.delete(fn as Listener<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) (fn as Listener<Events[K]>)(payload);
  }
}

export interface GameEvents extends Record<string, unknown> {
  /** HUD message feed. */
  message: string;
  /** Player took damage — HUD flash. */
  playerHurt: { amount: number };
  /** Camera shake request, strength 0..1. */
  shake: number;
  /** Staff viewmodel recoil, strength 0..1. */
  staffKick: number;
  /** Boss health fraction 0..1 for the HUD bar, or null to hide it. */
  bossHp: { name: string; frac: number } | null;
  /** A floor-mate cast an ability — replay it locally. */
  peerCast: {
    playerId: string;
    abilityId: string;
    origin: { x: number; y: number; z: number };
    dir: { x: number; y: number; z: number };
  };
  /** Host→replica entity snapshots arrived (routed by net/replication). */
  entitySnaps: import("../net/protocol").EntitySnap[];
  /** Host→replica discrete world event. */
  entityEvent: import("../net/protocol").EntityEvent;
  /** Replica asked us (the host) to apply damage. */
  hitRequest: {
    targetId: string;
    damage: number;
    impulse: { x: number; y: number; z: number };
  };
  /** Replica asked us (the host) to grant a pickup. */
  orbRequest: { playerId: string; orbId: string };
  /** Server asked us (the host) to bring a late joiner up to date. */
  stateRequest: { playerId: string };
  /** The host sent us the authoritative floor state (we're a late joiner). */
  stateSync: import("../net/protocol").FloorSyncState;
  /** Another wizard's spell hit us (their client decided it landed). */
  pvpHit: { fromId: string; damage: number; impulse: { x: number; y: number; z: number } };
  /** A wizard arrived on / left our floor. Arrivals are deliberately vague. */
  presence: { kind: "arrived"; playerId: string } | { kind: "left"; playerId: string; name: string };
  /** A floor-mate fell. */
  peerDied: { playerId: string; name: string; killerId: string | null; killerName: string | null };
  chestSpawn: import("../net/protocol").ChestInfo;
  chestOpened: { chestId: string; by: string };
  /** We claimed a death chest: its items are ours now. */
  chestGrant: { chestId: string; items: import("../items/types").ItemInstance[] };
  /** Our spell damaged something — for hit markers. */
  hitConfirm: { kind: "enemy" | "wizard"; killed?: boolean };
}

export const gameEvents = new Emitter<GameEvents>();

// Dev-only hook: end-to-end scripts emit HUD events (hits, presence, boss).
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__events = gameEvents;
}
