import { create } from "zustand";
import { Vector3 } from "three";
import { playerPosition } from "../../../game/player-state";
import { netBus } from "../../../net/bus";
import { peerMessage } from "../../../net/channels";
import { useGame } from "../../../state/gameStore";
import { exploredBits, getCurrentLayout, markExplored, mergeExplored } from "../../../world/currentFloor";
import { worldView } from "../../bridge";
import { castSpot } from "./mapModel";

/** The cast maps standing on this floor: yours, and any your floor-mates
 * cast. A map is a spell placed in the world — it lies on the floor a step
 * ahead of whoever cast it and stays there; anyone can walk around it (or
 * over it) and read it. Casting one also shows the others what you have
 * explored: the bits travel with the cast and join what they have seen. */

/** The caster id for your own map. */
export const SELF = "self";

export interface MapCast {
  /** Unique per cast (a re-cast is a new map). */
  id: string;
  /** Who cast it: SELF, or a floor-mate's player id. */
  owner: string;
  /** The map's centre, on the floor (world). */
  at: [number, number, number];
  kind: "dungeon" | "village";
  /** Metres across. */
  width: number;
}

interface MapState {
  casts: MapCast[];
  /** Cast your map ahead of you, or fold it if it stands. */
  toggle: () => void;
  /** Fold one map (yours by default). */
  dismiss: (owner?: string) => void;
  /** Fold every map (a change of place). */
  clear: () => void;
}

interface MapMsg {
  op: "cast" | "fold";
  at?: [number, number, number];
  width?: number;
  kind?: MapCast["kind"];
  /** The caster's explored tiles (exploredBits). */
  seen?: string;
}

let nextId = 1;
const fwd = new Vector3();

/** Feet below the player body's centre (capsule half-height + radius). */
const FEET = 0.9;

const without = (casts: MapCast[], owner: string) => casts.filter((c) => c.owner !== owner);

export const useMapCast = create<MapState>((set, get) => ({
  casts: [],
  toggle: () => {
    if (get().casts.some((c) => c.owner === SELF)) {
      get().dismiss();
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
    const { dist, width } = castSpot(layout, playerPosition.x, playerPosition.z, fwd.x, fwd.z);
    const cast: MapCast = {
      id: `${SELF}:${nextId++}`,
      owner: SELF,
      at: [playerPosition.x + fwd.x * dist, playerPosition.y - FEET, playerPosition.z + fwd.z * dist],
      kind: layout ? "dungeon" : "village",
      width,
    };
    set({ casts: [...without(get().casts, SELF), cast] });
    mapMsg.send({ op: "cast", at: cast.at, width, kind: cast.kind, seen: layout ? exploredBits(layout) : undefined });
  },
  dismiss: (owner = SELF) => {
    if (!get().casts.some((c) => c.owner === owner)) return;
    set({ casts: without(get().casts, owner) });
    if (owner === SELF) mapMsg.send({ op: "fold" });
  },
  clear: () => {
    if (get().casts.length) set({ casts: [] });
  },
}));

const mapMsg = peerMessage<MapMsg>("map", (msg, meta) => {
  const store = useMapCast.getState();
  if (msg.op === "fold") {
    if (store.casts.some((c) => c.owner === meta.from)) useMapCast.setState({ casts: without(store.casts, meta.from) });
    return;
  }
  if (!msg.at || !msg.width || !msg.kind) return;
  // Only a map of the place we're in.
  const layout = getCurrentLayout();
  const phase = useGame.getState().phase;
  if (msg.kind === "dungeon" ? phase !== "dungeon" || !layout : phase !== "village") return;
  if (layout && msg.seen) mergeExplored(layout, msg.seen);
  const cast: MapCast = { id: `${meta.from}:${nextId++}`, owner: meta.from, at: msg.at, kind: msg.kind, width: msg.width };
  useMapCast.setState({ casts: [...without(useMapCast.getState().casts, meta.from), cast] });
});

// A wizard who leaves takes their map with them.
netBus.on("peerLeft", ({ playerId }) => {
  const casts = useMapCast.getState().casts;
  if (casts.some((c) => c.owner === playerId)) useMapCast.setState({ casts: without(casts, playerId) });
});
