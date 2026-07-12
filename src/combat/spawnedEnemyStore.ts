import { hostEvent } from "../net/channels";
import { isHost } from "../net/netStore";
import type { Vec3 } from "../world/types";
import type { EnemyId } from "./enemyStats";

/** Runtime enemy spawns (slime splits today; nests/summoners later). Mirrors
 * items/LootOrbs: the host alone decides to spawn, and announces it as a host
 * event that replays on every client, so exactly one set of children appears
 * no matter who's on the floor. Late-join is covered by a sync provider the
 * <SpawnedEnemies> component registers. Kept JSX-free so enemies.tsx can call
 * spawnEnemy() from a death handler without an import cycle. */

export interface SpawnedEnemy {
  id: string;
  kind: EnemyId;
  /** Split depth — 0 is a naturally-generated enemy, children count up. */
  generation: number;
  pos: Vec3;
  floor: number;
}

/** Set by the mounted <SpawnedEnemies> component; null when unmounted. */
export const spawnHandlers: {
  push: ((s: SpawnedEnemy) => void) | null;
  remove: ((id: string) => void) | null;
  live: (() => SpawnedEnemy[]) | null;
} = { push: null, remove: null, live: null };

let counter = 1;

const enemySpawned = hostEvent<SpawnedEnemy>("enemySpawned", (d) => spawnHandlers.push?.(d));

/** Host-authoritative spawn. No-op off the host — replicas receive the event,
 * so a split rolls once and every client renders the same children. */
export function spawnEnemy(kind: EnemyId, generation: number, pos: Vec3, floor: number): void {
  if (!isHost()) return;
  enemySpawned.announce({ id: `s${counter++}`, kind, generation, pos, floor });
}

/** Drop a spawned enemy from THIS client's live list (its death fires on every
 * client). Deferred so we never unmount a component from inside its own
 * callback, and so a dead child is gone before the next late-join sync. */
export function despawnSpawned(id: string): void {
  queueMicrotask(() => spawnHandlers.remove?.(id));
}

// Dev-only hook for end-to-end tests (mirrors __game / __teleport).
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__spawnEnemy = spawnEnemy;
}
