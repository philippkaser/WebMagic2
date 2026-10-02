import { create } from "zustand";
import { Vector3 } from "three";
import { playerPosition } from "../../../game/player-state";
import { useGame } from "../../../state/gameStore";
import { getCurrentLayout, markExplored } from "../../../world/currentFloor";
import { worldView } from "../../bridge";
import { castDistance } from "./mapModel";

/** The cast map: where the wizard last cast it, if it stands. It is a spell
 * placed in the world — it stays where it was cast, a couple of strides
 * ahead (closer in a narrow hall, never inside a wall), and the wizard
 * walks around it, or away from it. */

export interface MapCast {
  id: number;
  /** Where its sigil burns, world (on the floor). */
  at: [number, number, number];
  /** The caster's facing when it was cast (unit, horizontal): the map
   * tilts up toward them. */
  fwd: [number, number];
  kind: "dungeon" | "village";
  /** How far ahead of the caster it stands, m (less in a narrow hall). */
  dist: number;
}

interface MapState {
  cast: MapCast | null;
  /** Cast it ahead of you, or dismiss it if it stands. */
  toggle: () => void;
  dismiss: () => void;
}

let nextId = 1;
const fwd = new Vector3();

/** Feet below the player body's centre (capsule half-height + radius). */
const FEET = 0.9;
/** How far ahead it is cast: as far as this when the hall allows. */
const CAST_MAX = 2.2;
const CAST_MIN = 0.95;

export const useMapCast = create<MapState>((set, get) => ({
  cast: null,
  toggle: () => {
    if (get().cast) {
      set({ cast: null });
      return;
    }
    const phase = useGame.getState().phase;
    if (phase !== "dungeon" && phase !== "village") return;
    const cam = worldView.camera;
    fwd.set(0, 0, -1);
    if (cam) fwd.applyQuaternion(cam.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const layout = phase === "dungeon" ? getCurrentLayout() : null;
    if (layout) markExplored(layout, playerPosition.x, playerPosition.z, 4);
    const d = layout ? castDistance(layout, playerPosition.x, playerPosition.z, fwd.x, fwd.z, CAST_MAX, CAST_MIN) : CAST_MAX;
    set({
      cast: {
        id: nextId++,
        at: [playerPosition.x + fwd.x * d, playerPosition.y - FEET, playerPosition.z + fwd.z * d],
        fwd: [fwd.x, fwd.z],
        kind: phase === "dungeon" ? "dungeon" : "village",
        dist: d,
      },
    });
  },
  dismiss: () => {
    if (get().cast) set({ cast: null });
  },
}));
