import type { RigidBody } from "@dimforge/rapier3d-compat";
import type { Vec } from "../enemies/brains/common";
import type { EnemyId } from "../enemies/roster";
import type { FloorRules } from "../game/floorRules";
import type { LootSource } from "../items/dropTables";
import type { Vec3 } from "../world/types";

/** What a floor simulation needs from wherever it runs.
 *
 * The sim (src/sim — the enemies' cores and controllers, and the headless
 * FloorSim) is plain TypeScript over Rapier bodies: no React, no three.js,
 * no network. Everything it asks of the outside world goes through this
 * interface, and everything it decides comes out of it, so the same code
 * runs as the floor's authority in a host's browser (game/browserSim.ts) and
 * on a server (sim/floorSim.ts):
 *
 *  - ACTIONS are authoritative facts — a bolt fired, a slam, a split, a
 *    death, loot. The browser host announces them as host events; a
 *    headless host sends them to the floor.
 *  - CUES are cosmetic and go to the entity's own view (EnemyCore.onCue):
 *    a muzzle flare, a slam's warning circle — and, through `cue()`, to
 *    every other machine's view of it (the replicas', or all of them when a
 *    headless host runs the floor). */

/** A wizard as the sim sees it: where, how fast, how far. */
export interface SimTarget {
  pos: Vec;
  vel: Vec;
  dist: number;
}

/** An enemy bolt (sentry shots, the Warden's volleys, trap darts). */
export interface CastData {
  origin: Vec3;
  velocity: Vec3;
  damage: number;
  color: string;
  size: number;
  blastRadius: number;
  blastImpulse: number;
  /** Who it's blamed on: a monster (default) or the dungeon itself (traps). */
  source?: "enemy" | "world";
}

/** A blast (the Warden's slam). */
export interface BoomData {
  pos: Vec3;
  radius: number;
  damage: number;
  impulse: number;
  color: string;
  source?: "enemy" | "world";
}

export type SimAction =
  | { type: "cast"; data: CastData }
  | { type: "boom"; data: BoomData }
  /** A body splits off at runtime (a slime's children). The host running
   * the sim names it (`id`). */
  | { type: "spawn"; kind: EnemyId; generation: number; pos: Vec3; floor: number; id?: string }
  /** The authority killed `id`: every machine removes it. */
  | { type: "died"; id: string }
  /** Something died or broke: the loot book rolls what it dropped. */
  | { type: "loot"; id: string; source: LootSource; at: Vec3 }
  /** Something hurt a wizard — the dungeon (`cause` "enemy": a monster's
   * touch, bolt or slam; "world": a trap, a barrel) or another wizard's
   * spell (`by`, with the shove). `damage` is before the victim's own gear. */
  | {
      type: "wizardHurt";
      wizard: string;
      damage: number;
      cause: "enemy" | "world" | "wizard";
      by: string | null;
      impulse: Vec3 | null;
    };

export type SimCue =
  /** A sentry's muzzle flash. */
  | { type: "flare"; at: Vec; dir: Vec; color: string }
  /** The Warden wakes (roar, the boss bar, the message). */
  | { type: "wake"; at: Vec }
  /** The Warden's charge bursts out of it. */
  | { type: "charge"; at: Vec3; vel: Vec; color: string }
  /** The Warden's ring of bolts leaves it. */
  | { type: "ring"; at: Vec3; color: string }
  /** The Warden winds up a slam: the warning circle, at the real radius. */
  | { type: "telegraph"; at: Vec; radius: number; color: string; seconds: number };

/** One entity's state on the wire — what an authority snapshots and replicas
 * interpolate (net/entities.ts): position, velocity (anything that moves),
 * rotation (anything that tumbles), and gameplay fields (hp). Quantized
 * (net/snapshots.ts q2/q3) by whoever sends it. */
export interface EntitySnap {
  id: string;
  p: [number, number, number];
  v?: [number, number, number];
  q?: [number, number, number, number];
  f?: Record<string, number>;
}

export interface SimWorld {
  /** The floor's rules (its omen), read live. */
  rules(): Readonly<FloorRules>;
  /** The nearest wizard to a point (shared scratch — copy what you keep). */
  nearestWizard(x: number, y: number, z: number): SimTarget;
  /** Stealth: how far a sleeping enemy's wake radius reaches (1 = fully). */
  aggroMult(): number;
  /** Is the straight path from `from` along unit `dir` clear for `dist`
   * metres — no wall or prop in the way (`self`, the shooter's body, ignored)? */
  clearShot(from: Vec, dir: Vec, dist: number, self: RigidBody | null): boolean;
  /** The sim's dice. */
  random(): number;
  act(action: SimAction): void;
  /** Show `cue` on every other machine's view of entity `id`. */
  cue(id: string, cue: SimCue): void;
}
