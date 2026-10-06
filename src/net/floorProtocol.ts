import type { GraveItem, GravePick, GraveRecord } from "../encounters/graveRules";
import type { EnemyId } from "../enemies/roster";
import type { BoomData, CastData, EntitySnap, SimCue } from "../sim/world";
import type { Vec3 } from "../world/types";

/** The floor host's protocol: the channels a floor's authority speaks and
 * what travels on them — one contract, whoever hosts the floor. A wizard's
 * browser hosts with the client modules that declare these channels
 * (net/entities, items/LootOrbs, world/props, encounters/Graves,
 * enemies/spawnedStore, weapons/hostileEffects); a server hosts with
 * server/floorHost.ts. Both import the names and shapes from here, so they
 * can't drift apart. (The router never reads any of it — see protocol.ts.)
 *
 * Pure types and constants: no React, no three.js, no sockets. */

/** Channel names, by direction (prefixes are added by net/channels.ts). */
export const FLOOR = {
  // ── Authority → the floor ("a:") ──────────────────────────────────────────
  /** Entity snapshots (SnapMsg), ~20 Hz, delta-filtered. */
  snap: "snap",
  /** An entity died or broke (DespawnMsg). */
  despawn: "despawn",
  /** Everything a late joiner needs (WorldSyncMsg), to one member. */
  worldSync: "worldSync",
  enemyCast: "enemyCast",
  enemyBoom: "enemyBoom",
  enemySpawned: "enemySpawned",
  /** Something an enemy's views should show (EnemyCueMsg) — cosmetic. */
  enemyCue: "enemyCue",
  orbSpawned: "orbSpawned",
  orbTaken: "orbTaken",
  treasureTaken: "treasureTaken",
  graveSpawned: "graveSpawned",
  graveLooted: "graveLooted",
  // ── Anyone → the authority ("h:") ─────────────────────────────────────────
  /** A command for one entity (CmdMsg) — "hit". */
  entityCmd: "entityCmd",
  takeOrb: "takeOrb",
  dropOrb: "dropOrb",
  takeTreasure: "takeTreasure",
  graveDrop: "graveDrop",
  lootGrave: "lootGrave",
  /** Dev builds: ask for a specific orb (honored only by a test server). */
  devOrb: "devOrb",
  // ── Peer ("p:") ───────────────────────────────────────────────────────────
  /** A wizard's pose (PoseMsg), 20 Hz. */
  pose: "pose",
} as const;

/** Late-join sync: the keys of WorldSyncMsg.custom. */
export const SYNC = {
  orbs: "orbs",
  treasure: "treasure",
  graves: "graves",
  spawnedEnemies: "spawnedEnemies",
} as const;

// ── Payloads ─────────────────────────────────────────────────────────────────

export interface SnapMsg {
  ents: EntitySnap[];
}

export interface DespawnMsg {
  id: string;
  data?: unknown;
}

export interface CmdMsg {
  id: string;
  cmd: string;
  data: unknown;
}

export interface WorldSyncMsg {
  /** Layout entities that died or broke (expected − alive). */
  dead: string[];
  ents: EntitySnap[];
  /** SYNC key → that system's state (SyncedOrb[], boolean, LiveGrave[],
   * SpawnedEnemy[]). */
  custom: Record<string, unknown>;
}

export type { BoomData, CastData };

export interface EnemyCueMsg {
  id: string;
  cue: SimCue;
}

/** Runtime enemy spawns (slime splits today; nests/summoners later). */
export interface SpawnedEnemy {
  id: string;
  kind: EnemyId;
  /** Split depth — 0 is a naturally-generated enemy, children count up. */
  generation: number;
  pos: Vec3;
  floor: number;
}

export interface OrbSpawnedMsg {
  orbId: string;
  /** Item orb when set; gold orb when null. */
  defId: string | null;
  gold: number;
  pos: Vec3;
}

/** A live orb as the late-join sync carries it. */
export interface SyncedOrb {
  id: string;
  defId: string | null;
  gold: number;
  position: Vec3;
}

export interface OrbTakenMsg {
  orbId: string;
  by: string;
}

export interface TakeOrbMsg {
  orbId: string;
}

/** A copy the sender gave up to the book (its "released" orb), to spawn at
 * their feet. */
export interface DropOrbMsg {
  orbId: string;
  defId: string;
  pos: Vec3;
}

export interface TreasureTakenMsg {
  by: string;
}

export type LiveGrave = GraveRecord & { killerId: string | null };

export interface GraveDropMsg {
  items: GraveItem[];
  gold: number;
  pos: Vec3;
  killerId: string | null;
}

export interface GraveLootMsg {
  graveId: string;
  picks: GravePick[];
  gold: boolean;
}

export interface GraveLootedMsg {
  graveId: string;
  by: string;
  picks: GravePick[];
  gold: boolean;
}

export interface DevOrbMsg {
  defId: string | null;
  gold: number;
  pos: Vec3;
}

export interface PoseMsg {
  p: [number, number, number];
  v: [number, number, number];
  /** yaw, pitch */
  a: [number, number];
  staffId: string;
}

// ── Rules every host applies ─────────────────────────────────────────────────

/** Orb pickups are offered within ~2.3 m; the slack covers the requester's
 * movement during one round trip. Anything farther is a client trying to
 * vacuum loot across the map. (Also the reach for placing a dropped copy.) */
export const ORB_TAKE_RANGE_SQ = 6 * 6;
/** The treasure is offered within ~2.5 m, plus a round trip of slack. */
export const TREASURE_RANGE_SQ = 6 * 6;
/** A grave is raised within reach of where its owner actually was. */
export const GRAVE_RAISE_RANGE_SQ = 10 * 10;
/** Plunder is granted within ~2.4 m of the grave, plus a round trip of slack. */
export const GRAVE_LOOT_RANGE_SQ = 6 * 6;

/** Where the i-th of n orbs from one source lands: the first on the spot,
 * the rest in a small ring around it. */
export function orbSpread(at: readonly number[], i: number, n: number): Vec3 {
  if (i === 0 || n < 2) return [at[0], at[1], at[2]];
  const a = (i / (n - 1)) * Math.PI * 2;
  return [at[0] + Math.cos(a) * 0.7, at[1], at[2] + Math.sin(a) * 0.7];
}
