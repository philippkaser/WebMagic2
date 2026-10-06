import { sanitizeGraveContents, sanitizePicks, takeFromGrave } from "../src/encounters/graveRules";
import { robeColorOf } from "../src/game/wizardLook";
import { resolveItem } from "../src/items/catalog";
import type { LootDrop } from "../src/items/dropTables";
import { DROPPED_ORB_PREFIX, TREASURE_ORB, type IssuedOrb } from "../src/items/lootBook";
import {
  FLOOR,
  GRAVE_LOOT_RANGE_SQ,
  GRAVE_RAISE_RANGE_SQ,
  ORB_TAKE_RANGE_SQ,
  orbSpread,
  SYNC,
  TREASURE_RANGE_SQ,
  type CmdMsg,
  type DespawnMsg,
  type DevOrbMsg,
  type DropOrbMsg,
  type EnemyCueMsg,
  type GraveDropMsg,
  type GraveLootedMsg,
  type GraveLootMsg,
  type LiveGrave,
  type OrbSpawnedMsg,
  type OrbTakenMsg,
  type PoseMsg,
  type SnapMsg,
  type SpawnedEnemy,
  type SyncedOrb,
  type TakeOrbMsg,
  type TreasureTakenMsg,
  type WorldSyncMsg,
} from "../src/net/floorProtocol";
import { CHANNEL_AUTHORITY, CHANNEL_PEER, CHANNEL_TO_HOST } from "../src/net/protocol";
import type { Rapier } from "../src/sim/floorPhysics";
import type { EntitySnap } from "../src/sim/world";
import { FloorSim } from "../src/sim/floorSim";
import { generateFloor } from "../src/world/gen";
import type { Vec3 } from "../src/world/types";

/** A floor hosted by the server: a headless member of a floor instance that
 * does everything a wizard's browser does as the floor's host — the floor's
 * simulation (src/sim/floorSim.ts: enemies, props, dart launchers), every
 * command a floor-mate sends the host (hits, pickups, drops, the treasure,
 * graves), the late-join sync, and the loot book's side of it all through
 * the ledger, in-process.
 *
 * It speaks the floor host's protocol (src/net/floorProtocol.ts) — the very
 * channels and rules the client modules use — so clients play against it
 * unchanged: to them it is a host with the id SERVER_HOST_ID.
 *
 * It can take over a floor someone else has been hosting: until promote()
 * it is a REPLICA, applying the authority traffic of the instance's
 * (browser) host and that host's world sync, exactly as a late joiner would;
 * it says ready() once the sync is in. After that it is the authority, and
 * the router routes every to-host command here.
 *
 * Gameplay-aware by design, unlike the router: this is where the floor's
 * rules run on the server. I/O, the ledger and the clock are injected. */

/** What a floor host may ask of the ledger (server/ledger.ts implements it).
 * Every call is bounded by the instance's own books. */
export interface FloorLedger {
  rollLoot(instanceId: string, id: unknown, source: unknown): IssuedOrb[] | null;
  orbHolds(instanceId: string, orbId: unknown): LootDrop | null;
  claimOrb(instanceId: string, playerId: unknown, orbId: unknown): boolean;
  graveGrant(instanceId: string, playerId: unknown, itemId: unknown): boolean;
  graveGold(instanceId: string, playerId: unknown, amount: unknown): boolean;
}

export interface FloorHostIO {
  /** An authority envelope from this host ("a:" + name added here): to the
   * whole instance, or to one member. */
  send(ch: string, data: unknown, to?: string): void;
  /** A wizard's display name (graves are signed with it). */
  nameOf(playerId: string): string;
  /** The replica has the floor's state and can take it over. */
  ready(): void;
}

export interface FloorHostOptions {
  /** The sim's dice. Default Math.random. */
  random?: () => number;
  /** Simulation rate (fixed steps). Default 60 Hz. */
  tickHz?: number;
  /** Snapshot rate. Default 20 Hz (net/entities.ts SNAP_INTERVAL_S). */
  snapHz?: number;
}

export interface FloorInstance {
  id: string;
  floor: number;
  seed: number;
}

/** At most this many fixed steps per tick: a stalled server catches up a
 * little, never spirals. */
const MAX_STEPS_PER_TICK = 5;
/** A wizard silent this long (s) — dead, frozen, gone — is no longer hunted
 * (where they were still counts: a fallen wizard raises their grave there). */
const POSE_STALE_S = 2;

export class FloorHost {
  readonly sim: FloorSim;
  private promoted = false;
  private readonly members = new Set<string>();
  private readonly orbs = new Map<string, SyncedOrb>();
  private treasureTaken = false;
  private readonly treasurePos: Vec3;
  private graves: LiveGrave[] = [];
  private graveCounter = 1;
  private readonly stepS: number;
  private readonly snapS: number;
  private stepAcc = 0;
  private snapAcc = 0;
  /** Seconds this host has run, and when each wizard last sent a pose. */
  private clock = 0;
  private readonly lastPose = new Map<string, number>();
  /** Where each wizard on the floor last said they were — range checks. */
  private readonly lastPos = new Map<string, Vec3>();

  constructor(
    R: Rapier,
    readonly inst: FloorInstance,
    private readonly ledger: FloorLedger,
    private readonly io: FloorHostIO,
    opts: FloorHostOptions = {},
  ) {
    const layout = generateFloor(inst.seed, inst.floor);
    this.sim = new FloorSim(R, layout, inst.floor, { random: opts.random });
    this.treasurePos = layout.treasure;
    this.stepS = 1 / (opts.tickHz ?? 60);
    this.snapS = 1 / (opts.snapHz ?? 20);
  }

  /** Is it the floor's authority yet (or still a replica)? */
  get isHost(): boolean {
    return this.promoted;
  }

  /** Take the floor: from now on this simulates and answers commands. */
  promote(): void {
    this.promoted = true;
  }

  joined(playerId: string): void {
    this.members.add(playerId);
  }

  left(playerId: string): void {
    this.members.delete(playerId);
    this.lastPose.delete(playerId);
    this.lastPos.delete(playerId);
    this.sim.removeWizard(playerId);
  }

  /** A gameplay envelope from a member of the instance (`ch` with its
   * prefix): its poses, its commands for the host — and, while this is a
   * replica, the current host's authority traffic. */
  receive(from: string, ch: string, data: unknown): void {
    if (typeof ch !== "string") return;
    const prefix = ch.slice(0, 2);
    const name = ch.slice(2);
    if (prefix === CHANNEL_PEER) {
      if (name === FLOOR.pose) this.pose(from, data);
    } else if (prefix === CHANNEL_TO_HOST) {
      if (this.promoted) this.command(from, name, data);
    } else if (prefix === CHANNEL_AUTHORITY) {
      if (!this.promoted) this.mirror(name, data);
    }
  }

  /** A late joiner needs the floor as it stands. */
  sync(playerId: string): void {
    const msg: WorldSyncMsg = {
      dead: this.sim.gone(),
      ents: this.sim.snapshot(true),
      custom: {
        [SYNC.orbs]: [...this.orbs.values()],
        [SYNC.treasure]: this.treasureTaken,
        [SYNC.graves]: this.graves,
        [SYNC.spawnedEnemies]: this.sim.spawns() satisfies SpawnedEnemy[],
      },
    };
    this.io.send(FLOOR.worldSync, msg, playerId);
  }

  /** Advance the floor by `dt` seconds (fixed steps), announcing what it
   * decided and, at the snapshot rate, where everything is. */
  tick(dt: number): void {
    if (!this.promoted) return;
    this.clock += dt;
    for (const [id, at] of this.lastPose) {
      if (this.clock - at < POSE_STALE_S) continue;
      this.lastPose.delete(id);
      this.sim.removeWizard(id);
    }
    this.stepAcc = Math.min(this.stepAcc + dt, this.stepS * MAX_STEPS_PER_TICK);
    while (this.stepAcc >= this.stepS) {
      this.stepAcc -= this.stepS;
      this.sim.step(this.stepS);
      this.announce();
    }
    this.snapAcc += dt;
    if (this.snapAcc >= this.snapS) {
      this.snapAcc %= this.snapS;
      const ents = this.sim.snapshot();
      if (ents.length > 0) this.io.send(FLOOR.snap, { ents } satisfies SnapMsg);
    }
  }

  free(): void {
    this.sim.free();
  }

  // ── Wizards ────────────────────────────────────────────────────────────────

  private pose(from: string, data: unknown): void {
    const d = data as Partial<PoseMsg> | null;
    const p = d?.p;
    const v = d?.v;
    if (!isVec3(p)) return;
    const vel = isVec3(v) ? { x: v[0], y: v[1], z: v[2] } : { x: 0, y: 0, z: 0 };
    this.sim.setWizard(from, { x: p[0], y: p[1], z: p[2] }, vel);
    this.lastPose.set(from, this.clock);
    this.lastPos.set(from, [p[0], p[1], p[2]]);
  }

  /** Squared distance from a wizard to a point — Infinity for a wizard the
   * floor hasn't seen a pose from (range checks fail closed). */
  private distSq(playerId: string, at: readonly number[]): number {
    const w = this.lastPos.get(playerId);
    if (!w) return Infinity;
    return (w[0] - at[0]) ** 2 + (w[1] - at[1]) ** 2 + (w[2] - at[2]) ** 2;
  }

  // ── Commands (the host's side of every hostCommand) ────────────────────────

  private command(from: string, name: string, data: unknown): void {
    switch (name) {
      case FLOOR.entityCmd: {
        const d = data as Partial<CmdMsg> | null;
        if (d?.cmd === "hit" && typeof d.id === "string") this.sim.hit(d.id, d.data);
        break;
      }
      case FLOOR.takeOrb:
        this.takeOrb(from, data as Partial<TakeOrbMsg> | null);
        break;
      case FLOOR.dropOrb:
        this.dropOrb(from, data as Partial<DropOrbMsg> | null);
        break;
      case FLOOR.takeTreasure:
        this.takeTreasure(from);
        break;
      case FLOOR.graveDrop:
        this.graveDrop(from, data as Partial<GraveDropMsg> | null);
        break;
      case FLOOR.lootGrave:
        this.lootGrave(from, data as Partial<GraveLootMsg> | null);
        break;
      case FLOOR.devOrb: {
        // Honored only by a ledger started for testing (it refuses `dev`).
        const d = data as Partial<DevOrbMsg> | null;
        if (!d || !isVec3(d.pos)) break;
        const orbs = this.ledger.rollLoot(this.inst.id, "dev", { kind: "dev", itemId: d.defId ?? null, gold: d.gold ?? 0 });
        orbs?.forEach((o, i) => this.spawnOrb(o, orbSpread(d.pos!, i, orbs.length)));
        break;
      }
    }
    this.announce(); // a hit can kill, a kill can drop: say so now
  }

  /** First come, first served — only if the orb is still there and the
   * wizard is standing at it; the book grants what it holds, once. */
  private takeOrb(from: string, d: Partial<TakeOrbMsg> | null): void {
    const orb = typeof d?.orbId === "string" ? this.orbs.get(d.orbId) : undefined;
    if (!orb || this.distSq(from, orb.position) > ORB_TAKE_RANGE_SQ) return;
    this.orbs.delete(orb.id);
    this.io.send(FLOOR.orbTaken, { orbId: orb.id, by: from } satisfies OrbTakenMsg);
    this.ledger.claimOrb(this.inst.id, from, orb.id);
  }

  /** A copy the sender gave up to the book lands at their feet. The book
   * must hold exactly that item in exactly that orb. */
  private dropOrb(from: string, d: Partial<DropOrbMsg> | null): void {
    if (!d || typeof d.orbId !== "string" || !d.orbId.startsWith(DROPPED_ORB_PREFIX)) return;
    if (typeof d.defId !== "string" || !isVec3(d.pos) || this.orbs.has(d.orbId)) return;
    try {
      resolveItem(d.defId);
    } catch {
      return;
    }
    if (this.distSq(from, d.pos) > ORB_TAKE_RANGE_SQ) return;
    if (this.ledger.orbHolds(this.inst.id, d.orbId)?.itemId !== d.defId) return;
    this.spawnOrb({ orbId: d.orbId, itemId: d.defId, gold: 0 }, [d.pos[0], d.pos[1], d.pos[2]]);
  }

  private takeTreasure(from: string): void {
    if (this.treasureTaken || this.distSq(from, this.treasurePos) > TREASURE_RANGE_SQ) return;
    this.treasureTaken = true;
    this.io.send(FLOOR.treasureTaken, { by: from } satisfies TreasureTakenMsg);
    this.ledger.claimOrb(this.inst.id, from, TREASURE_ORB);
  }

  /** A wizard who just fell here raises a grave with what the death took. */
  private graveDrop(from: string, d: Partial<GraveDropMsg> | null): void {
    const contents = sanitizeGraveContents(d);
    if (!contents || !d || !isVec3(d.pos)) return;
    if (this.distSq(from, d.pos) > GRAVE_RAISE_RANGE_SQ) return;
    const killerId = typeof d.killerId === "string" && this.members.has(d.killerId) ? d.killerId : null;
    const grave: LiveGrave = {
      id: `grave_${this.graveCounter++}_${Math.random().toString(36).slice(2, 6)}`,
      ownerId: from,
      ownerName: this.io.nameOf(from),
      killerId,
      killerName: killerId ? this.io.nameOf(killerId) : null,
      pos: [d.pos[0], d.pos[1], d.pos[2]],
      color: robeColorOf(from),
      ...contents,
    };
    this.graves.push(grave);
    this.io.send(FLOOR.graveSpawned, grave);
  }

  /** Plunder: what the wizard picked and can carry, from a grave they stand
   * at — granted by the ledger only against what the dead were granted. */
  private lootGrave(from: string, d: Partial<GraveLootMsg> | null): void {
    const grave = this.graves.find((g) => g.id === d?.graveId);
    if (!grave || !d || this.distSq(from, grave.pos) > GRAVE_LOOT_RANGE_SQ) return;
    const picks = sanitizePicks(grave, d.picks);
    const gold = d.gold === true && grave.gold > 0;
    if (picks.length === 0 && !gold) return;
    const { grave: left, taken, gold: goldTaken } = takeFromGrave(grave, picks, gold);
    this.graves = this.graves.map((g) => (g.id === grave.id ? left : g));
    this.io.send(FLOOR.graveLooted, { graveId: grave.id, by: from, picks, gold } satisfies GraveLootedMsg);
    for (const t of taken) for (let n = 0; n < t.qty; n++) this.ledger.graveGrant(this.inst.id, from, t.id);
    if (goldTaken > 0) this.ledger.graveGold(this.inst.id, from, goldTaken);
  }

  // ── What the floor decided ─────────────────────────────────────────────────

  private announce(): void {
    for (const c of this.sim.drainCues()) this.io.send(FLOOR.enemyCue, c satisfies EnemyCueMsg);
    for (const a of this.sim.drain()) {
      switch (a.type) {
        case "cast":
          this.io.send(FLOOR.enemyCast, a.data);
          break;
        case "boom":
          this.io.send(FLOOR.enemyBoom, a.data);
          break;
        case "spawn":
          this.io.send(FLOOR.enemySpawned, {
            id: a.id!,
            kind: a.kind,
            generation: a.generation,
            pos: a.pos,
            floor: a.floor,
          } satisfies SpawnedEnemy);
          break;
        case "died":
          this.io.send(FLOOR.despawn, { id: a.id } satisfies DespawnMsg);
          break;
        case "loot": {
          // The book rolls what fell; the orbs land around where it died.
          const orbs = this.ledger.rollLoot(this.inst.id, a.id, a.source);
          orbs?.forEach((o, i) => this.spawnOrb(o, orbSpread(a.at, i, orbs.length)));
          break;
        }
      }
    }
  }

  private spawnOrb(o: IssuedOrb, pos: Vec3): void {
    this.orbs.set(o.orbId, { id: o.orbId, defId: o.itemId, gold: o.gold, position: pos });
    this.io.send(FLOOR.orbSpawned, { orbId: o.orbId, defId: o.itemId, gold: o.gold, pos } satisfies OrbSpawnedMsg);
  }

  // ── Replica: the current host's word, until this one takes over ────────────

  private mirror(name: string, data: unknown): void {
    const d = data as Record<string, unknown> | null;
    if (!d || typeof d !== "object") return;
    switch (name) {
      case FLOOR.snap:
        for (const snap of asArray<EntitySnap>((d as Partial<SnapMsg>).ents)) this.sim.mirror(snap);
        break;
      case FLOOR.despawn:
        if (typeof d.id === "string") this.sim.mirrorDespawn(d.id);
        break;
      case FLOOR.enemySpawned:
        this.sim.mirrorSpawn(d as unknown as SpawnedEnemy);
        break;
      case FLOOR.orbSpawned: {
        const o = d as Partial<OrbSpawnedMsg>;
        if (typeof o.orbId === "string" && isVec3(o.pos)) {
          this.orbs.set(o.orbId, { id: o.orbId, defId: o.defId ?? null, gold: Number(o.gold) || 0, position: o.pos });
        }
        break;
      }
      case FLOOR.orbTaken:
        if (typeof d.orbId === "string") this.orbs.delete(d.orbId);
        break;
      case FLOOR.treasureTaken:
        this.treasureTaken = true;
        break;
      case FLOOR.graveSpawned: {
        const g = d as unknown as LiveGrave;
        if (typeof g.id === "string" && !this.graves.some((x) => x.id === g.id)) this.graves.push(g);
        break;
      }
      case FLOOR.graveLooted: {
        const l = d as Partial<GraveLootedMsg>;
        const grave = this.graves.find((g) => g.id === l.graveId);
        if (!grave) break;
        const { grave: left } = takeFromGrave(grave, sanitizePicks(grave, l.picks), l.gold === true);
        this.graves = this.graves.map((g) => (g.id === grave.id ? left : g));
        break;
      }
      case FLOOR.worldSync:
        this.applySync(d as Partial<WorldSyncMsg>);
        this.io.ready();
        break;
    }
  }

  private applySync(msg: Partial<WorldSyncMsg>): void {
    for (const id of asArray(msg.dead)) if (typeof id === "string") this.sim.mirrorDespawn(id);
    const custom = (msg.custom ?? {}) as Record<string, unknown>;
    for (const s of asArray(custom[SYNC.spawnedEnemies])) this.sim.mirrorSpawn(s as SpawnedEnemy);
    for (const snap of asArray<EntitySnap>(msg.ents)) this.sim.mirror(snap);
    for (const o of asArray(custom[SYNC.orbs])) {
      const orb = o as Partial<SyncedOrb>;
      if (typeof orb.id === "string" && isVec3(orb.position)) {
        this.orbs.set(orb.id, { id: orb.id, defId: orb.defId ?? null, gold: Number(orb.gold) || 0, position: orb.position });
      }
    }
    if (custom[SYNC.treasure] === true) this.treasureTaken = true;
    for (const g of asArray(custom[SYNC.graves])) {
      const grave = g as LiveGrave;
      if (typeof grave?.id === "string" && !this.graves.some((x) => x.id === grave.id)) this.graves.push(grave);
    }
  }
}

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
