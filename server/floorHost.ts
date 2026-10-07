import { PactBook } from "../src/encounters/pactBook";
import { sanitizeGraveContents, sanitizePicks, takeFromGrave, type GraveContents } from "../src/encounters/graveRules";
import { robeColorOf } from "../src/game/wizardLook";
import { PLAYER } from "../src/core/config";
import { computeStats, resolveItem } from "../src/items/catalog";
import type { DerivedStats, Equipment, ItemDef } from "../src/items/types";
import type { LootDrop } from "../src/items/dropTables";
import { DROPPED_ORB_PREFIX, TREASURE_ORB, type IssuedOrb } from "../src/items/lootBook";
import {
  FLOOR,
  GRAVE_LOOT_RANGE_SQ,
  GRAVE_RAISE_RANGE_SQ,
  MAX_REWIND_MS,
  ORB_TAKE_RANGE_SQ,
  orbSpread,
  RENDER_DELAY_MS,
  SYNC,
  TREASURE_RANGE_SQ,
  type CorrectMsg,
  type DespawnMsg,
  type DevOrbMsg,
  type DropOrbMsg,
  type EnemyCueMsg,
  type PactMsg,
  type WizardHitMsg,
  type YouFellMsg,
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
import type { WireEquipment } from "../src/net/protocol";
import type { CheckedLoadout } from "./ledger";
import { FloorSim } from "../src/sim/floorSim";
import { MotionGuard } from "../src/sim/motion";
import { castInterval, sanitizeCastMsg } from "../src/weapons/castMessage";
import { getSpellDef } from "../src/weapons/spellCatalog";
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
  /** What a wizard wears, checked against what it carries. */
  loadoutOf(instanceId: string, playerId: unknown): CheckedLoadout | null;
  /** The host knows a wizard is dead: end their run; their grave's contents. */
  forceDeath(instanceId: string, playerId: unknown): GraveContents | null;
}

export interface FloorHostIO {
  /** An authority envelope from this host ("a:" + name added here): to the
   * whole instance, or to one member. */
  send(ch: string, data: unknown, to?: string): void;
  /** A wizard's display name (graves are signed with it). */
  nameOf(playerId: string): string;
  /** The replica has the floor's state and can take it over. */
  ready(): void;
  /** Operational notes (refusals, rate-limited). */
  log?(text: string): void;
}

export interface FloorHostOptions {
  /** The sim's dice. Default Math.random. */
  random?: () => number;
  /** Simulation rate (fixed steps). Default 60 Hz. */
  tickHz?: number;
  /** Snapshot rate. Default 20 Hz (net/entities.ts SNAP_INTERVAL_S). */
  snapHz?: number;
  /** Believe every reported pose (the e2e smoke test teleports wizards
   * around). A cheat by definition: never on a real server. */
  trustMoves?: boolean;
}

/** A wizard as the floor's authority knows them: what they wear (and so
 * what their spells do), their mana, their casting clocks. */
interface WizardState {
  /** The loadout the stats below were computed from. */
  key: string;
  stats: DerivedStats;
  staff: ItemDef;
  /** When the ledger was last asked (s, this host's clock). */
  checkedAt: number;
  mana: number;
  /** Mana their carried draughts may still add. */
  reserve: number;
  /** Health their carried draughts could restore (as the ledger counts it). */
  healReserve: number;
  manaAt: number;
  /** Per spell: casts in hand (a token bucket) and when it last refilled. */
  casts: Map<string, { tokens: number; at: number }>;
  /** When they were last put back after an impossible move. */
  correctedAt: number;
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
/** A cast leaves the staff tip, ~1 m from the body; the slack covers a
 * pose's worth of movement (dashes, blasts) and the jitter between them. */
const CAST_REACH_SQ = 4 * 4;
/** Casts in hand per spell: the network bunches casts sent on cooldown. */
const CAST_BURST = 2;
/** Casting may run this much faster than the gear allows (clock jitter). */
const CAST_RATE_SLACK = 1.15;
/** Mana the server's pool may lag the caster's by (regen timing). */
const MANA_SLACK = 5;
/** The ledger is asked about a wizard's gear at most this often (s). */
const GEAR_REFRESH_S = 1;
/** A wizard put back after an impossible move isn't told again sooner. */
const CORRECT_EVERY_S = 0.5;
/** A pose's claimed velocity (it only aims the enemies' shots) is capped. */
const MAX_POSE_SPEED = 40;
/** A refusal of the same kind for the same wizard is logged at most this
 * often (s) — with how many happened meanwhile. */
const REFUSAL_LOG_EVERY_S = 10;

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
  /** Pacts between the wizards here — whose spells may hurt whom. */
  private readonly pacts = new PactBook();
  /** Duel damage each wizard has taken on this floor (through their gear),
   * and the healing their draughts could still do — kept across a
   * reconnect, so leaving can't reset the count. */
  private readonly duelTaken = new Map<string, number>();
  private readonly healLeft = new Map<string, number>();
  /** Wizards whose death this host decided. */
  private readonly fallen = new Set<string>();
  /** Seconds this host has run, and when each wizard last sent a pose. */
  private clock = 0;
  private readonly lastPose = new Map<string, number>();
  /** Where each wizard on the floor last said they were — range checks. */
  private readonly lastPos = new Map<string, Vec3>();
  private readonly wizards = new Map<string, WizardState>();
  private readonly motion: MotionGuard;
  private readonly trustMoves: boolean;
  /** What this host refused, by kind (tests, logs). */
  readonly refused = { casts: 0, moves: 0 };
  /** wizard + reason → when last logged, and how many since. */
  private readonly refusalLog = new Map<string, { at: number; count: number }>();

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
    this.motion = new MotionGuard(R, this.sim.physics.world, layout.extent);
    this.sim.setHostility((caster, wizard) => this.pacts.hostile(caster, wizard));
    this.trustMoves = opts.trustMoves === true;
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
    this.wizards.delete(playerId);
    this.motion.forget(playerId);
    this.pacts.forget(playerId);
    this.sim.removeWizard(playerId);
  }

  /** A gameplay envelope from a member of the instance (`ch` with its
   * prefix): its poses, its commands for the host — and, while this is a
   * replica, the current host's authority traffic. */
  receive(from: string, ch: string, data: unknown, serverTime = 0): void {
    if (typeof ch !== "string") return;
    const prefix = ch.slice(0, 2);
    const name = ch.slice(2);
    if (prefix === CHANNEL_PEER) {
      if (name === FLOOR.pose) this.pose(from, data);
      else if (name === FLOOR.cast && this.promoted) this.cast(from, data, serverTime);
      else if (name === FLOOR.pact) {
        const d = data as Partial<PactMsg> | null;
        this.pacts.onMessage(from, d?.to, d?.kind, serverTime);
      }
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
    this.clock += dt;
    if (!this.promoted) return;
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
    if (!this.trustMoves) {
      const verdict = this.motion.judge(from, p, this.clock, this.gear(from)?.stats.speedMult ?? 1);
      if (verdict !== "ok") {
        this.refuseMove(from, verdict);
        return;
      }
    }
    const vel = isVec3(v) ? { x: v[0], y: v[1], z: v[2] } : { x: 0, y: 0, z: 0 };
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    if (speed > MAX_POSE_SPEED) {
      vel.x *= MAX_POSE_SPEED / speed;
      vel.y *= MAX_POSE_SPEED / speed;
      vel.z *= MAX_POSE_SPEED / speed;
    }
    this.sim.setWizard(from, { x: p[0], y: p[1], z: p[2] }, vel);
    this.lastPose.set(from, this.clock);
    this.lastPos.set(from, [p[0], p[1], p[2]]);
  }

  /** An impossible move: ignored (the wizard stays where this host last
   * believed them), and — once this is the floor's host — the wizard is
   * put back there. */
  private refuseMove(from: string, why: string): void {
    this.refused.moves++;
    this.noteRefusal(from, `move (${why})`);
    const back = this.motion.lastGood(from);
    const w = this.wizards.get(from);
    if (!this.promoted || !back || (w && this.clock - w.correctedAt < CORRECT_EVERY_S)) return;
    if (w) w.correctedAt = this.clock;
    this.io.send(FLOOR.correct, { p: [back[0], back[1], back[2]] } satisfies CorrectMsg, from);
  }

  /** What a wizard wears and can do, as the ledger believes it — asked at
   * most once a second; null for anyone the ledger doesn't place here. */
  private gear(from: string): WizardState | null {
    let w = this.wizards.get(from);
    if (w && this.clock - w.checkedAt < GEAR_REFRESH_S) return w;
    const loadout = this.ledger.loadoutOf(this.inst.id, from);
    if (!loadout) return null;
    const key = JSON.stringify(loadout.equipment);
    if (!w) {
      w = {
        key: "",
        stats: computeStats(equipmentOf(loadout.equipment)),
        staff: resolveItem(loadout.equipment.staff).def,
        checkedAt: this.clock,
        mana: PLAYER.maxMana,
        reserve: loadout.manaReserve,
        healReserve: loadout.healReserve,
        manaAt: this.clock,
        casts: new Map(),
        correctedAt: -Infinity,
      };
      this.wizards.set(from, w);
    }
    if (w.key !== key) {
      w.key = key;
      w.stats = computeStats(equipmentOf(loadout.equipment));
      w.staff = resolveItem(loadout.equipment.staff).def;
    }
    // The reserve only shrinks: re-checking can't refill drunk draughts.
    w.reserve = Math.min(w.reserve, loadout.manaReserve);
    w.healReserve = Math.min(w.healReserve, loadout.healReserve);
    w.checkedAt = this.clock;
    return w;
  }

  /** A wizard casts. On a floor whose spells this host decides, the cast
   * must come from where the wizard stands, be a spell of the staff the
   * ledger believes they wield, keep to that spell's cooldown (with their
   * fire-rate gear) and be paid for in mana — then it is cast HERE, with the
   * server's idea of their stats, and its hits are the only ones that count. */
  private cast(from: string, data: unknown, serverTime: number): void {
    const msg = sanitizeCastMsg(data);
    const at = this.lastPos.get(from);
    const w = this.gear(from);
    if (!msg || !at || !w) return this.refuseCast(from, !msg ? "malformed" : !at ? "no pose yet" : "no loadout");
    const [ox, oy, oz] = msg.origin;
    if ((ox - at[0]) ** 2 + (oy - at[1]) ** 2 + (oz - at[2]) ** 2 > CAST_REACH_SQ) return this.refuseCast(from, "far from the caster");
    if (w.staff.primary !== msg.abilityId && w.staff.secondary !== msg.abilityId) {
      return this.refuseCast(from, `${msg.abilityId.slice(0, 20)} isn't the staff's`);
    }
    const spell = getSpellDef(msg.abilityId);
    // The cooldown, as a bucket: a cast in hand per interval, two at most.
    const interval = castInterval(spell.cooldown, w.stats.fireRateMult) / CAST_RATE_SLACK;
    const clock = w.casts.get(spell.id) ?? { tokens: CAST_BURST, at: this.clock };
    clock.tokens = Math.min(CAST_BURST, clock.tokens + (this.clock - clock.at) / interval);
    clock.at = this.clock;
    w.casts.set(spell.id, clock);
    if (clock.tokens < 1) return this.refuseCast(from, "too fast");
    // Mana: the pool regenerates as the caster's does; draughts top it up.
    const regen = PLAYER.manaRegen * w.stats.manaRegenMult * this.sim.rules.manaRegenMult;
    w.mana = Math.min(PLAYER.maxMana, w.mana + (this.clock - w.manaAt) * regen);
    w.manaAt = this.clock;
    if (w.mana + w.reserve + MANA_SLACK < spell.mana) return this.refuseCast(from, "out of mana");
    clock.tokens -= 1;
    const fromPool = Math.min(w.mana, spell.mana);
    w.mana -= fromPool;
    w.reserve = Math.max(0, w.reserve - (spell.mana - fromPool));
    // Judged as the caster saw the floor: the cast's trip here plus the
    // render delay — never further back than MAX_REWIND_MS.
    const trip = msg.t > 0 && serverTime > 0 ? Math.max(0, serverTime - msg.t) : 0;
    const lag = Math.min(MAX_REWIND_MS, trip + RENDER_DELAY_MS) / 1000;
    this.sim.castSpell(
      from,
      { abilityId: msg.abilityId, origin: { x: ox, y: oy, z: oz }, dir: { x: msg.dir[0], y: msg.dir[1], z: msg.dir[2] }, seed: msg.seed },
      { damageMult: w.stats.damageMult, extraProjectiles: w.stats.extraProjectiles, homing: w.stats.homing },
      lag,
    );
    this.announce();
  }

  private refuseCast(from: string, why: string): void {
    this.refused.casts++;
    this.noteRefusal(from, `cast (${why})`);
  }

  private noteRefusal(from: string, what: string): void {
    const key = `${from} ${what}`;
    const seen = this.refusalLog.get(key) ?? { at: -Infinity, count: 0 };
    seen.count++;
    this.refusalLog.set(key, seen);
    if (this.clock - seen.at < REFUSAL_LOG_EVERY_S) return;
    this.io.log?.(`${this.inst.id}: refused ${from}'s ${what}${seen.count > 1 ? ` ×${seen.count}` : ""}`);
    seen.at = this.clock;
    seen.count = 0;
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
      case FLOOR.entityCmd:
        // "hit": a wizard's word for its own hits counts for nothing here —
        // this host runs every cast itself (see cast()). Clients on a
        // server-hosted floor don't send them (net/netStore.ts reportsOwnHits).
        break;
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
    // A wizard whose death this host decided already has their grave.
    if (this.fallen.has(from)) return;
    const contents = sanitizeGraveContents(d);
    if (!contents || !d || !isVec3(d.pos)) return;
    if (this.distSq(from, d.pos) > GRAVE_RAISE_RANGE_SQ) return;
    const killerId = typeof d.killerId === "string" && this.members.has(d.killerId) ? d.killerId : null;
    this.raiseGrave(from, killerId, d.pos, contents);
  }

  private raiseGrave(owner: string, killerId: string | null, pos: Vec3, contents: GraveContents): void {
    const grave: LiveGrave = {
      id: `grave_${this.graveCounter++}_${Math.random().toString(36).slice(2, 6)}`,
      ownerId: owner,
      ownerName: this.io.nameOf(owner),
      killerId,
      killerName: killerId ? this.io.nameOf(killerId) : null,
      pos: [pos[0], pos[1], pos[2]],
      color: robeColorOf(owner),
      ...contents,
    };
    this.graves.push(grave);
    this.io.send(FLOOR.graveSpawned, grave);
  }

  // ── Duels ──────────────────────────────────────────────────────────────────

  /** A wizard's spell hurt `victim`. The victim's client applies it (their
   * health is theirs to show and to heal) — but this host keeps count: the
   * duel damage alone, through their gear, past their max health and every
   * draught they carry is a death no client can talk its way out of. */
  private duelHit(victim: string, by: string, damage: number, impulse: Vec3): void {
    this.io.send(FLOOR.wizardHit, { by, damage, impulse } satisfies WizardHitMsg, victim);
    const w = this.gear(victim);
    if (!w || this.fallen.has(victim)) return;
    const taken = (this.duelTaken.get(victim) ?? 0) + damage * w.stats.damageTakenMult;
    this.duelTaken.set(victim, taken);
    const heal = Math.min(this.healLeft.get(victim) ?? w.healReserve, w.healReserve);
    this.healLeft.set(victim, heal);
    if (taken > w.stats.maxHealth + heal) this.fall(victim, by);
  }

  /** `victim` is dead by this host's count: their run ends, their grave
   * rises where they were, and they're told. */
  private fall(victim: string, killer: string): void {
    this.fallen.add(victim);
    const contents = this.ledger.forceDeath(this.inst.id, victim);
    const at = this.lastPos.get(victim);
    const grave = contents && sanitizeGraveContents(contents);
    if (grave && at && (grave.items.length > 0 || grave.gold > 0)) {
      this.raiseGrave(victim, this.members.has(killer) ? killer : null, [at[0], Math.max(0, at[1] - 0.9), at[2]], grave);
    }
    this.io.send(FLOOR.youFell, { killer } satisfies YouFellMsg, victim);
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
        case "wizardHit":
          this.duelHit(a.wizard, a.by, a.damage, a.impulse);
          break;
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

/** Wire equipment (checked ids) as the stats code reads it. */
function equipmentOf(e: WireEquipment): Equipment {
  const inst = (id: string | null) => (id ? { defId: id, runLoot: false } : null);
  return { staff: { defId: e.staff, runLoot: false }, amulet: inst(e.amulet), cloak: inst(e.cloak), boots: inst(e.boots) };
}

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
