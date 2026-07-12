import { create } from "zustand";
import type { Vec3 } from "../world/types";

/** Dev-room spawn registry — the shared state between the DevRoom overlay
 * (which pushes spawns) and the DevSpawns renderer (which mounts them). Every
 * consumer of this module is itself gated on `import.meta.env.DEV`, so nothing
 * here runs in a production build. */

export type DevEnemyKind = "wisp" | "sentry" | "boss";

export interface DevSpawn {
  id: string;
  kind: DevEnemyKind;
  pos: Vec3;
  /** Floor level the spawn scales its health/damage/loot to. */
  floor: number;
}

interface DevRoomStore {
  spawns: DevSpawn[];
  /** Floor level applied to newly spawned enemies. */
  spawnFloor: number;
  spawn(kind: DevEnemyKind, pos: Vec3): void;
  remove(id: string): void;
  clear(): void;
  setSpawnFloor(floor: number): void;
}

let nextSpawnId = 0;

export const useDevRoom = create<DevRoomStore>((set, get) => ({
  spawns: [],
  spawnFloor: 1,
  spawn: (kind, pos) => {
    // The Boss component hardcodes the "boss" net-entity id and the boss HUD
    // bar, so only one may live at a time — a new one replaces the old.
    const base = kind === "boss" ? get().spawns.filter((s) => s.kind !== "boss") : get().spawns;
    set({ spawns: [...base, { id: `dev-${nextSpawnId++}`, kind, pos, floor: get().spawnFloor }] });
  },
  remove: (id) => set({ spawns: get().spawns.filter((s) => s.id !== id) }),
  clear: () => set({ spawns: [] }),
  setSpawnFloor: (floor) =>
    set({ spawnFloor: Math.max(1, Math.min(100, Math.round(floor) || 1)) }),
}));
