import { create } from "zustand";
import { getEnemyDef, type EnemyId } from "../combat/enemyRegistry";
import type { TrapKind, Vec3 } from "../world/types";

/** Dev-room spawn registry — the shared state between the DevRoom overlay
 * (which pushes spawns) and the DevSpawns renderer (which mounts them). Every
 * consumer of this module is itself gated on `import.meta.env.DEV`, so nothing
 * here runs in a production build. */

export interface DevSpawn {
  id: string;
  kind: EnemyId;
  pos: Vec3;
  /** Floor level the spawn scales its health/damage/loot to. */
  floor: number;
}

export interface DevTrapSpawn {
  id: string;
  kind: TrapKind;
  pos: Vec3;
  floor: number;
}

interface DevRoomStore {
  spawns: DevSpawn[];
  traps: DevTrapSpawn[];
  /** Floor level applied to newly spawned enemies and traps. */
  spawnFloor: number;
  spawn(kind: EnemyId, pos: Vec3): void;
  spawnTrap(kind: TrapKind, pos: Vec3): void;
  remove(id: string): void;
  clear(): void;
  setSpawnFloor(floor: number): void;
}

let nextSpawnId = 0;

export const useDevRoom = create<DevRoomStore>((set, get) => ({
  spawns: [],
  traps: [],
  spawnFloor: 1,
  spawn: (kind, pos) => {
    // Singleton enemies (the boss hardcodes its net-entity id + HUD bar) may
    // only live one at a time — a new one replaces the old.
    const base = getEnemyDef(kind).singleton
      ? get().spawns.filter((s) => !getEnemyDef(s.kind).singleton)
      : get().spawns;
    set({ spawns: [...base, { id: `dev-${nextSpawnId++}`, kind, pos, floor: get().spawnFloor }] });
  },
  spawnTrap: (kind, pos) =>
    set({ traps: [...get().traps, { id: `devt-${nextSpawnId++}`, kind, pos, floor: get().spawnFloor }] }),
  remove: (id) =>
    set({
      spawns: get().spawns.filter((s) => s.id !== id),
      traps: get().traps.filter((t) => t.id !== id),
    }),
  clear: () => set({ spawns: [], traps: [] }),
  setSpawnFloor: (floor) =>
    set({ spawnFloor: Math.max(1, Math.min(100, Math.round(floor) || 1)) }),
}));
