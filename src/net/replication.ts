import { useFrame } from "@react-three/fiber";
import { gameEvents } from "../core/events";
import { isHost, useNet } from "./netStore";
import type { EntityEvent, EntitySnap } from "./protocol";
import { session } from "./session";

/** Host-authority entity replication.
 *
 * Every replicated world entity (enemies, props, the boss) registers here
 * under a stable id derived from the floor layout. On the host, the
 * ReplicationSystem collects changed snapshots ~10 Hz and broadcasts them;
 * on replicas, incoming snapshots/events are routed back to the entity.
 * Offline there is no traffic and entities simply simulate — the host path
 * IS the single-player path. */

export interface ReplicatedEntity {
  id: string;
  /** Host: current snapshot (null while dead/unspawned). */
  snap(): EntitySnap | null;
  /** Host: apply damage requested by a replica. */
  applyHit(damage: number, impulse: { x: number; y: number; z: number }): void;
  /** Replica: consume an authoritative snapshot. */
  applySnap(snap: EntitySnap): void;
  /** Replica: consume a discrete event targeting this entity (death, break). */
  onEvent?(ev: EntityEvent): void;
}

const entities = new Map<string, ReplicatedEntity>();

export function registerEntity(entity: ReplicatedEntity): () => void {
  entities.set(entity.id, entity);
  return () => {
    // Guard against a new floor's entity re-registering under the same id
    // before the old floor finished unmounting.
    if (entities.get(entity.id) === entity) entities.delete(entity.id);
  };
}

// ── Incoming routing (module-level: exactly one subscriber app-wide) ─────────

let appliedSnaps = 0;

gameEvents.on("entitySnaps", (snaps) => {
  if (isHost()) return; // stale packet after host migration
  for (const snap of snaps) {
    entities.get(snap.id)?.applySnap(snap);
    appliedSnaps++;
  }
});

gameEvents.on("entityEvent", (ev) => {
  if ("id" in ev) entities.get(ev.id)?.onEvent?.(ev);
  // Events without an id (orbSpawn/orbTaken/boom/…) are consumed by their
  // own subscribers (LootOrbs, damage system).
});

gameEvents.on("hitRequest", ({ targetId, damage, impulse }) => {
  if (!isHost()) return;
  entities.get(targetId)?.applyHit(damage, impulse);
});

// ── Outgoing (host only) ─────────────────────────────────────────────────────

const SEND_INTERVAL = 0.1; // 10 Hz
const POS_EPSILON_SQ = 0.002;

interface LastSent {
  x: number;
  y: number;
  z: number;
  hp: number;
}

const lastSent = new Map<string, LastSent>();

/** Mounted once in the scene: broadcasts changed entity snapshots while we
 * are the host of an online floor. */
export function ReplicationSystem() {
  let clock = 0;
  useFrame((_, dt) => {
    clock -= dt;
    if (clock > 0) return;
    clock = SEND_INTERVAL;
    const net = useNet.getState();
    if (net.mode !== "online" || net.floorPlayers < 2 || !isHost()) return;

    const batch: EntitySnap[] = [];
    for (const entity of entities.values()) {
      const snap = entity.snap();
      if (!snap) continue;
      const prev = lastSent.get(snap.id);
      const [x, y, z] = snap.p;
      const hp = snap.hp ?? 0;
      if (prev) {
        const moved =
          (prev.x - x) ** 2 + (prev.y - y) ** 2 + (prev.z - z) ** 2 > POS_EPSILON_SQ;
        if (!moved && prev.hp === hp) continue;
        prev.x = x;
        prev.y = y;
        prev.z = z;
        prev.hp = hp;
      } else {
        lastSent.set(snap.id, { x, y, z, hp });
      }
      batch.push(snap);
    }
    if (batch.length > 0) session.sendEntitySnaps(batch);
  });
  return null;
}

/** Called when a floor unmounts. */
export function resetReplication(): void {
  entities.clear();
  lastSent.clear();
}

// Dev-only inspection hook for end-to-end tests.
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__replication = {
    entityCount: () => entities.size,
    entityIds: () => [...entities.keys()],
    appliedSnaps: () => appliedSnaps,
    isHost: () => isHost(),
    net: () => useNet.getState(),
  };
}
