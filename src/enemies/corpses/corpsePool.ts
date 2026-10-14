import type { EnemyId } from "../roster";
import { CorpseState, CUE, startCorpse, stepCorpse, type CorpseInit, type CueSink } from "./corpseScripts";

/** The corpse pool: a fixed set of slots per kind, module-level like the
 * particle pool, so a death never mounts anything — the shell
 * (Corpses.tsx) pre-mounts one model per slot and shows only the live ones.
 * When every slot of a kind is busy (a room of slimes splitting) the oldest
 * death is cut short: its main beat still fires (the splat, the soul), so
 * nothing is lost but the tail. Pure; tested in corpseScripts.test.ts. */

export const SLOTS: Record<EnemyId, number> = { wisp: 6, shadow: 4, slime: 8, sentry: 3, boss: 1 };

export type CorpsePool = Record<EnemyId, CorpseState[]>;

export function createCorpsePool(): CorpsePool {
  const make = (n: number) => Array.from({ length: n }, () => new CorpseState());
  return {
    wisp: make(SLOTS.wisp),
    shadow: make(SLOTS.shadow),
    slime: make(SLOTS.slime),
    sentry: make(SLOTS.sentry),
    boss: make(SLOTS.boss),
  };
}

/** Start a death in a free slot of its kind — or in the oldest one, finishing
 * that death's main beat first. Returns the slot index. */
export function claimCorpse(pool: CorpsePool, init: CorpseInit, onCue: CueSink): number {
  const slots = pool[init.kind];
  let pick = -1;
  let oldest = -1;
  for (let i = 0; i < slots.length; i++) {
    const c = slots[i];
    if (!c.live) {
      pick = i;
      break;
    }
    if (oldest < 0 || c.t > slots[oldest].t) oldest = i;
  }
  if (pick < 0) {
    pick = oldest;
    const stolen = slots[pick];
    if (!(stolen.fired & (1 << CUE.main))) {
      stolen.fired |= 1 << CUE.main;
      onCue(stolen, CUE.main, stolen.x, stolen.y, stolen.z, 0);
    }
  }
  startCorpse(slots[pick], init);
  return pick;
}

/** Advance every live death. Returns how many are still playing. */
export function stepCorpses(pool: CorpsePool, dt: number, onCue: CueSink): number {
  let n = 0;
  for (const kind in pool) {
    for (const c of pool[kind as EnemyId]) if (stepCorpse(c, dt, onCue)) n++;
  }
  return n;
}

export function clearCorpses(pool: CorpsePool): void {
  for (const kind in pool) for (const c of pool[kind as EnemyId]) c.live = false;
}
