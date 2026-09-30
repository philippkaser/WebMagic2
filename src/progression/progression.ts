import { DUNGEON, RUN } from "../core/config";
import type { Rng } from "../core/rng";

/** Run progression rules — pure and unit-tested.
 *
 * The rift reads your gear level and throws you in near a matching floor
 * (with a little chaos: it's a rift, not an elevator). A run must survive
 * RUN.floorsToExtract floors before a homeward rift will open. */

/** Where the rift throws a wizard of this gear level. The jitter is skewed
 * deeper: the dungeon is hungry. */
export function entryFloorFor(gearLevel: number, rng: Rng): number {
  const jitter = rng.pick([-1, 0, 0, 1, 1, 2]);
  const base = Math.round(gearLevel * RUN.floorPerGearLevel);
  return clampFloor(base + jitter);
}

/** The band the waystone shows before you step through. */
export function entryRange(gearLevel: number): [number, number] {
  const base = Math.round(gearLevel * RUN.floorPerGearLevel);
  return [clampFloor(base - 1), clampFloor(base + 2)];
}

function clampFloor(f: number): number {
  return Math.max(1, Math.min(DUNGEON.maxFloor - RUN.floorsToExtract, f));
}

export interface RunState {
  /** Floor the rift threw you onto. */
  startFloor: number;
  /** Floors entered this run, including the current one. */
  floorsVisited: number;
  kills: number;
  wizardsSlain: number;
}

export function newRun(startFloor: number): RunState {
  return { startFloor, floorsVisited: 1, kills: 0, wizardsSlain: 0 };
}

/** On your Nth floor the exit rift is joined by a homeward rift. */
export function canExtract(run: RunState | null): boolean {
  return !!run && run.floorsVisited >= RUN.floorsToExtract;
}

export function floorsUntilExtract(run: RunState | null): number {
  return run ? Math.max(0, RUN.floorsToExtract - run.floorsVisited) : RUN.floorsToExtract;
}
