import { create } from "zustand";
import { Vector3 } from "three";
import { playerPosition } from "../../../game/player-state";
import { worldView } from "../../bridge";

/** The cast map: where the wizard last cast it, if it stands. It is a spell
 * placed in the world — it stays where it was cast, a stride ahead, and
 * the wizard walks around it (or away from it). */

export interface MapCast {
  id: number;
  /** Centre of the miniature's base, world (on the floor). */
  at: [number, number, number];
}

interface MapState {
  cast: MapCast | null;
  /** Cast it a stride ahead of you, or dismiss it if it stands. */
  toggle: () => void;
  dismiss: () => void;
}

let nextId = 1;
const fwd = new Vector3();

export const useMapCast = create<MapState>((set, get) => ({
  cast: null,
  toggle: () => {
    if (get().cast) {
      set({ cast: null });
      return;
    }
    const cam = worldView.camera;
    fwd.set(0, 0, -1);
    if (cam) fwd.applyQuaternion(cam.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const floorY = playerPosition.y - 0.9;
    set({ cast: { id: nextId++, at: [playerPosition.x + fwd.x * 1.45, floorY, playerPosition.z + fwd.z * 1.45] } });
  },
  dismiss: () => set({ cast: null }),
}));
