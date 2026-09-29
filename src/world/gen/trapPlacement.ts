import type { Rng } from "../../core/rng";
import { TRAP_DEFS, type TrapDef } from "../trapCatalog";
import type { Rect, TrapSpawn } from "../types";
import { dist2World } from "./grid";
import type { Pois } from "./pois";
import { randomInRoom } from "./rooms";

/** Stage 6 — traps. Run LAST on the layout stream, after every other draw, so
 * adding or retuning hazards never perturbs the rooms/props/enemies rolled
 * before them — a given seed keeps its exact layout and merely gains traps.
 * (Omens and lore use streams of their own for the same reason.) */

/** Traps keep this far (squared world units) from the entrance. */
const SPAWN_CLEARANCE2 = 64;

function trapBudget(floor: number): number {
  return Math.min(2 + Math.floor(floor / 3), 9);
}

export function placeTraps(rng: Rng, rooms: Rect[], pois: Pois, floor: number, size: number): TrapSpawn[] {
  const { spawn, spawnRoom, exitRoom, isBossFloor } = pois;
  // The exit room offers a smaller menu (no warp beside the way home); rooms
  // elsewhere may roll anything. One weighted draw per trap either way.
  const anywhere = TRAP_DEFS;
  const nearExit = TRAP_DEFS.filter((t) => !t.avoidExitRoom);
  const traps: TrapSpawn[] = [];
  const budget = trapBudget(floor);
  for (let tries = 0; tries < budget * 5 && traps.length < budget; tries++) {
    const room = rng.pick(rooms);
    if (room === spawnRoom || (isBossFloor && room === exitRoom)) continue;
    const pos = randomInRoom(rng, room, size, 0);
    if (dist2World(pos, spawn) < SPAWN_CLEARANCE2) continue;
    const def = pickTrap(rng, room === exitRoom ? nearExit : anywhere);
    traps.push({ kind: def.id, pos });
  }
  return traps;
}

function pickTrap(rng: Rng, defs: readonly TrapDef[]): TrapDef {
  const total = defs.reduce((s, t) => s + t.weight, 0);
  let r = rng.next() * total;
  for (const t of defs) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return defs[0];
}
