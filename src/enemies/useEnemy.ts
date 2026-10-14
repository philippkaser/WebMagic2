import { getLife, publishLife, updateLife } from "./lifeBoard";
import { interactionGroups, type RapierRigidBody } from "@react-three/rapier";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Group, MeshStandardMaterial } from "three";
import { listenerAt } from "../audio/spatial";
import { ENEMY_STRIDE, isEnemyVoice, playEnemyDeath, playEnemyStep, playEnemyWake } from "../audio/voices";
import { floorScale, GROUPS, PLAYER } from "../core/config";
import { gameEvents } from "../core/events";
import { flashLight } from "../fx/DynamicLights";
import { soulDissolveFx } from "../fx/effects";
import { spawnBurst, type BurstOptions } from "../fx/Particles";
import { ENEMY_SOURCE } from "../game/damageSource";
import { getFloorRules } from "../game/floorRules";
import { getPlayerBody, playerPosition } from "../game/player-state";
import { allocId, registerHittable, type Hittable, type HitInfo } from "../game/registry";
import { nearestWizardTo } from "../game/targets";
import { crossedKnee } from "../game/vitality";
import { GOLD_DROPS } from "../items/economy";
import { dropGold, dropLoot, dropMaterials } from "../items/LootOrbs";
import { isHost } from "../net/netStore";
import { useNetBody, type NetBody } from "../net/NetSystems";
import { combatActive, getStats, useGame } from "../state/gameStore";
import { sanitizeHit, type HitData } from "../weapons/damage";
import { localWizardId } from "../weapons/localWizard";
import type { Vec3 } from "../world/types";
import type { ChaseInput, Steering, Vec } from "./brains/common";
import { encodeDeath, readDeath, type DeathNote } from "./deathNote";
import { ack, createLedger, noteMine, predictedHp, type DoomLedger } from "./doom";
import { createStagger, dirOf, NO_DIR, quantDir, readHitExtras, staggerFor } from "./hitFx";
import { playCorpse } from "./corpses/Corpses";
import { createBlow, LiveBody, type Blow } from "./liveBody";
import type { Puppet } from "./puppet";
import { getEnemyStats, type EnemyId } from "./roster";

/** The shared enemy shell: everything an enemy is that isn't its brain or its
 * looks. Every kind used to carry its own copy of this — health from the
 * roster, the dead latch, the hit flash, aggro and knockback timers, a death
 * that bursts, flashes and drops loot, and the replication wiring — so it
 * lives here once, and a kind file is left with its brain wiring and model.
 *
 * It also owns the body's presentation (liveBody.ts): every kind's model
 * sits on the shell's `view` group, which reacts to blows, breathes, faces
 * its prey, poses wind-ups and wounds — on every client, from what that
 * client knows (its own blows at once, everyone else's from the replicated
 * hp, a quantised blow direction `k`, the act code `a` and the wake bit `w`).
 *
 * Floor rules (game/floorRules.ts) are read live at the moment they matter:
 * health at spawn, damage when it's dealt, speed each frame (loot and gold
 * rules live in items/LootOrbs). That keeps omens out of every component —
 * but it does mean a floor's rules must be installed before its enemies
 * mount. */

/** Enemy bodies collide with the world, wizards, each other, props and
 * wizard spells (never their own bolts). */
export const ENEMY_GROUPS = interactionGroups(GROUPS.ENEMY, [
  GROUPS.WORLD,
  GROUPS.PLAYER,
  GROUPS.ENEMY,
  GROUPS.PROP,
  GROUPS.FRIENDLY_PROJECTILE,
]);

/** Base chance a regular enemy drops an item. */
export const ENEMY_LOOT_CHANCE = 0.24;

/** The break (crossing the knee) staggers a creature this long, at least —
 * host-side, so every client sees the same reel. */
export const BREAK_STAGGER = 0.6;
/** A quiet tug (the singularity) keeps its hold on the body this long. */
const TUG_HOLD = 0.4;

const ZERO: Readonly<Vec> = Object.freeze({ x: 0, y: 0, z: 0 });

/** Damage an enemy deals at `floor`: depth scaling × the floor's damage rule.
 * Everything an enemy inflicts (contact, bolts, slams) goes through this. */
export function enemyDamage(base: number, floor: number): number {
  return base * floorScale(floor).enemyDamage * getFloorRules().enemyDamageMult;
}

/** The standard death: the creature's energy dissolving upward as rising
 * soul-light with a flash and a ring (fx/effects#soulDissolveFx), its body
 * bursting into `burst` (goo, crystal shards, shadow smoke — pick a `style`),
 * and a light flash at the body. */
export interface EnemyDeathFx {
  burst: Omit<BurstOptions, "position">;
  light: { color: string; intensity: number };
  /** Height of the burst and flash above the body origin (the sentry's crystal). */
  lift?: number;
  /** Colour of the rising soul (default: the light's colour). */
  soul?: string;
  /** Size of the dissolve (1 = a wisp-sized creature). */
  scale?: number;
}

/** The standard drops: gold at the enemy's usual odds, and maybe an item. */
export interface EnemyDrops {
  /** Base item chance (the floor's loot rule is applied inside dropLoot).
   * 0 = gold only. */
  lootChance: number;
  /** Drops land this far above the body origin… */
  lift?: number;
  /** …but never below this height (fliers can die skimming the floor). */
  minY?: number;
}

/** A sphere of radius `r` at height `y` above the body origin, `fwd` ahead
 * of it along the way the body faces (the shadow's eyes). */
export interface WeakSpot {
  y: number;
  r: number;
  fwd?: number;
}

export interface UseEnemyOptions {
  /** Roster id — where baseHealth comes from. */
  kind: EnemyId;
  entityId: string;
  position: Vec3;
  floor: number;
  /** Multiplier on the roster's baseHealth (slime generations). */
  healthScale?: number;
  /** Omit for a fully custom death (the Warden's, via onDeathFx). */
  deathFx?: EnemyDeathFx;
  drops?: EnemyDrops;
  /** Extra effects of a real (non-silent) death: splits, boss drops, messages. */
  onDeathFx?: (at: Vec) => void;
  /** Runs on EVERY death, including silent late-join catch-up. */
  onKilled?: () => void;
  /** Sentries never move — replicate hp only. */
  immobile?: boolean;
  /** Fraction of knockback impulses that actually applies (bosses resist). */
  knockbackScale?: number;
  /** How fast the hit flash fades (per second). */
  flashDecay?: number;
  /** Authoritative hp changed while alive — applied damage on the authority,
   * a snapshot on a replica. Fires only when it really changed. */
  onHp?: (hp: number, maxHp: number) => void;
  /** Its weak point, for precision hits (HitInfo.crit). */
  weakSpot?: WeakSpot;
  /** Authority: what the body is doing right now, as an act wire number
   * (anticipation.ts#encodeAct) — replicated so every client poses it. */
  act?: () => number;
  /** A kind's own pose on the puppet each frame (the slime's hop squash). */
  posture?: (p: Puppet) => void;
  /** An act began (on every client, from the replicated act): a kind's own
   * tell — the Warden's slam circle on the floor. */
  onAct?: (code: number, progress: number, at: Vec) => void;
  /** Born out of something (a slime's split): spring up from small. */
  emerge?: boolean;
  /** Body scale (a slime generation's size) — its corpse is drawn at it. */
  size?: number;
  /** Which way it faces when it dies, if not the puppet's (the sentry's head). */
  faceYaw?: () => number;
}

export interface EnemyShell {
  body: RefObject<RapierRigidBody | null>;
  /** The model's parent inside the RigidBody — the living body's puppet
   * writes its pose here. Wrap the model in `<group ref={e.view}>`. */
  view: RefObject<Group | null>;
  /** What this client shows of the body (wounds, act, puppet). */
  live: LiveBody;
  hp: RefObject<number>;
  /** Health at spawn (roster × generation × depth × floor rule). */
  maxHp: number;
  dead: boolean;
  deadRef: RefObject<boolean>;
  /** Hit flash, 1 on a hit and fading to 0 — drive an emissive with it. */
  flash: RefObject<number>;
  /** Woken — set by damage from anyone, or by the brain's proximity check
   * (replicated: every client knows when it woke). */
  aggro: RefObject<boolean>;
  /** Knockback in flight (> 0) — brains leave the body to physics. */
  knockTimer: RefObject<number>;
  net: NetBody;
  /** Damage this enemy deals for a base amount (see enemyDamage). */
  damage(base: number): number;
  /** Per-frame preamble: the body when this enemy should act this frame
   * (mounted, alive, combat live), else null. Animates the living body
   * (flash, puppet, wounds, leaks) and runs down the knockback timer. */
  beginFrame(dt: number): RapierRigidBody | null;
  /** Paint the flash material (hue, white frame, flash, wounds, wind-up
   * heat); `extra` adds glow, `gain` scales the hit flare. */
  paint(mat: MeshStandardMaterial | null, extra?: number, gain?: number): void;
  /** Its contact burn is live (off during death throes: a blow this client
   * knows was lethal disarms it until the host's despawn). */
  armed(): boolean;
  /** Fill a chase brain's senses: body pose, nearest wizard, clock, wake and
   * knock state, the floor's speed rule. `vel` defaults to a read of the
   * body's velocity, made only when an awake, unstaggered brain will steer
   * with it (it's a physics-engine round trip). */
  sense(input: ChaseInput, b: RapierRigidBody, pos: Vec, time: number, dt: number, vel?: Vec): ChaseInput;
  /** Apply a chase brain's decision: latch its wake state, set its velocity. */
  steer(b: RapierRigidBody, s: Steering): void;
}

const blowScratch: Blow = createBlow();
const dirScratch = { x: 0, z: 0 };

/** Dev: every live enemy's own hit, by entity id (screenshot scenarios land
 * exact blows with __hurtEnemy). */
let devCalm = false;
const devBodies = new Map<string, LiveBody>();
/** Dev: brains hold still for a screenshot (__calmEnemies). */
export const enemiesCalmed = (): boolean => devCalm;
const devHits = new Map<string, (damage: number, impulse: { x: number; y: number; z: number }, info?: HitInfo) => void>();
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  const w = window as unknown as Record<string, unknown>;
  w.__enemyIds = () => [...devHits.keys()];
  // Chasers never wake (their brains idle) — bodies hold still for a camera.
  w.__calmEnemies = (on: boolean) => {
    devCalm = on;
  };
  w.__enemyLife = (id: string) => {
    const l = getLife(id);
    return l ? { hp: l.hp, maxHp: l.maxHp } : null;
  };
  // What this client shows of a body (replication checks in scenarios).
  w.__enemyLook = (id: string) => {
    const b = devBodies.get(id);
    return b
      ? { act: b.act.code, progress: b.act.progress, stage: b.wound.stage, broke: b.broke, doomed: b.doomed, life: b.life, yaw: b.puppet.yaw }
      : null;
  };
  w.__hurtEnemy = (id: string, damage: number, ix = 0, iz = 4, mine = true) =>
    devHits.get(id)?.(damage, { x: ix, y: 1, z: iz }, { mine });
}

export function useEnemy(options: UseEnemyOptions): EnemyShell {
  // Latest options behind a ref: the callbacks below stay stable across
  // re-renders, so the hittable and net registrations never churn.
  const opts = useRef(options);
  opts.current = options;
  const { floor, flashDecay = 5 } = options;
  const radius = getEnemyStats(options.kind).hitRadius * Math.sqrt(options.healthScale ?? 1);

  const body = useRef<RapierRigidBody>(null);
  const view = useRef<Group>(null);
  const [maxHp] = useState(
    () =>
      getEnemyStats(options.kind).baseHealth *
      (options.healthScale ?? 1) *
      floorScale(floor).enemyHealth *
      getFloorRules().enemyHealthMult,
  );
  const hp = useRef(maxHp);
  const deadRef = useRef(false);
  const [dead, setDead] = useState(false);
  const flash = useRef(0);
  const aggro = useRef(false);
  const knockTimer = useRef(0);
  const [live] = useState(() => {
    const l = new LiveBody(options.kind, options.entityId, maxHp, radius, flash, flashDecay);
    if (options.emerge) l.emerge();
    return l;
  });
  live.posture = options.posture ?? null;
  live.onAct = options.onAct ?? null;
  // Its voice: woken once, a footfall every stride it walks.
  const voice = useRef({ woke: false, cried: -Infinity, x: NaN, z: NaN, walked: 0 });
  const wasAwake = useRef(false);

  const netRef = useRef<NetBody | null>(null);
  // Host: who struck last and which way — the death note ("" = nobody's own
  // magic: a barrel, a trap) — plus the replicated direction step `k` and
  // the stagger budget.
  const lastBlow = useRef({ by: "", x: 0, z: 0, k: NO_DIR });
  const stagger = useRef(createStagger());
  // Shooter: blows sent and not yet seen land (doom.ts).
  const ledger = useRef<DoomLedger | null>(null);
  const seenFields = useRef(false);
  // Replica: the latest act on the wire.
  const actWire = useRef(0);

  const kill = useCallback((silent = false, note: DeathNote | null = null) => {
    if (deadRef.current) return;
    deadRef.current = true;
    const o = opts.current;
    const t = body.current?.translation() ?? { x: o.position[0], y: o.position[1], z: o.position[2] };
    if (!silent) {
      // Who, where, which way, how hard — on every client (a late joiner's
      // silent catch-up excepted). The host's death note names the killer.
      gameEvents.emit("enemyKilled", {
        id: o.entityId,
        kind: o.kind,
        at: [t.x, t.y, t.z],
        mine: !!note && note.by !== "" && note.by === localWizardId(),
        dir: note?.dir ?? null,
        over: note?.over ?? 0,
        scale: o.deathFx?.scale ?? (o.kind === "boss" ? 2.6 : 1),
      });
      const fx = o.deathFx;
      // The body lingers a moment as a corpse (corpses/): it implodes,
      // unravels, splats, loses its head — and its burst, soul, light and
      // floor splat land on the corpse's own beat. The collider, hittable
      // and net registration still go this frame.
      const pose = live.pose;
      const played = playCorpse(
        {
          kind: o.kind,
          x: t.x + pose.x,
          y: t.y + pose.y,
          z: t.z + pose.z,
          yaw: o.faceYaw?.() ?? pose.yaw,
          size: o.size ?? 1,
          dir: note?.dir ?? null,
          over: note?.over ?? 0,
          seed: live.seed,
        },
        {
          fx: fx ?? null,
          soul: fx?.soul ?? fx?.light.color ?? live.look.soul,
          scale: fx?.scale ?? (o.kind === "boss" ? 2.6 : 1),
          light: fx?.light.intensity ?? 60,
        },
      );
      if (fx && !played) {
        const at: Vec3 = [t.x, t.y + (fx.lift ?? 0), t.z];
        spawnBurst({ ...fx.burst, position: at });
        soulDissolveFx(at, fx.soul ?? fx.light.color, fx.scale ?? 1);
        flashLight(at, fx.light.color, fx.light.intensity);
        // Cosmetic: the mark it leaves on the floor (fx/decals).
        const color = fx.burst.color;
        gameEvents.emit("enemyDied", {
          x: t.x,
          y: t.y,
          z: t.z,
          body: Array.isArray(color) ? color[0] : color,
          soul: fx.soul ?? fx.light.color,
          style: fx.burst.style,
          scale: fx.scale ?? 1,
        });
      }
      const drops = o.drops;
      if (drops) {
        const at: Vec3 = [t.x, Math.max(t.y + (drops.lift ?? 0), drops.minY ?? -Infinity), t.z];
        // Base odds only — LootOrbs applies the floor's loot/gold rules itself.
        if (drops.lootChance > 0) dropLoot(at, o.floor, drops.lootChance);
        dropGold(at, o.floor, GOLD_DROPS.enemyChance, "enemy");
        if (o.kind !== "boss") dropMaterials(at, o.floor, "kill");
      }
      o.onDeathFx?.(t);
      if (isEnemyVoice(o.kind)) playEnemyDeath(o.kind, [t.x, t.y, t.z]);
    }
    o.onKilled?.();
    setDead(true);
  }, []);

  /** Authoritative hp changed. The life board shows `shown` — the shooter's
   * belief, its own unconfirmed blows included — so marks drop on the frame
   * of the blow, not a round trip later. */
  const onHp = useCallback(
    (current: number, shown = current) => {
      updateLife(opts.current.entityId, Math.max(0, shown));
      if (!deadRef.current) opts.current.onHp?.(current, maxHp);
    },
    [maxHp],
  );

  /** A blow as this machine knows it — the shooter's own, the host's view
   * of a remote one, a replica's hp drop: the shared contract's enemyHit,
   * then the body's reaction. */
  const blowLanded = useCallback(
    (b: Blow, lifeAfter: number, mine: boolean, crit: boolean) => {
      const t = body.current?.translation();
      // A quiet tug confirms nothing — unless it's the one that kills.
      if (!t || (b.quiet && lifeAfter > 0)) return;
      const o = opts.current;
      const at = b.at ?? t;
      gameEvents.emit("enemyHit", {
        id: o.entityId,
        kind: o.kind,
        at: [at.x, at.y, at.z],
        damage: b.damage,
        frac: Math.max(0, lifeAfter / maxHp),
        mine,
        crit,
        lethal: lifeAfter <= 0,
      });
      live.react(b, t);
    },
    [live, maxHp],
  );

  // Its life on the board (life marks, the boss bar, wound looks read it).
  useEffect(() => {
    if (dead) return;
    const stats = getEnemyStats(options.kind);
    return publishLife({
      id: options.entityId,
      kind: options.kind,
      maxHp,
      hp: hp.current,
      pos: () => body.current?.translation() ?? null,
      top: stats.hitRadius * Math.sqrt(options.healthScale ?? 1) * 1.6,
      hurtAt: 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dead, maxHp]);

  // ── The authority: damage, stagger, death ──────────────────────────────────
  const knockbackScale = options.knockbackScale ?? 1;
  const applyDamage = useCallback(
    (damage: number, impulse: { x: number; y: number; z: number }, by: string, quiet: boolean) => {
      if (deadRef.current) return;
      const before = hp.current;
      hp.current -= damage;
      const now = performance.now() / 1000;
      if (quiet) {
        knockTimer.current = Math.max(knockTimer.current, TUG_HOLD);
      } else {
        // A bolt knocks it off its stride; a stream of chip damage can't
        // hold it there (hitFx.ts#staggerFor). Breaking at the knee reels it.
        knockTimer.current = Math.max(knockTimer.current, staggerFor(stagger.current, damage, maxHp, now));
        if (crossedKnee(before / maxHp, hp.current / maxHp)) {
          knockTimer.current = Math.max(knockTimer.current, BREAK_STAGGER);
        }
        const blow = lastBlow.current;
        blow.by = by;
        blow.x = impulse.x;
        blow.z = impulse.z;
        blow.k = quantDir(impulse.x, impulse.z);
      }
      body.current?.applyImpulse(
        {
          x: impulse.x * knockbackScale,
          y: impulse.y * knockbackScale,
          z: impulse.z * knockbackScale,
        },
        true,
      );
      live.lifeTo(hp.current, body.current?.translation() ?? null, by !== "" && by === localWizardId());
      onHp(hp.current);
      aggro.current = true; // getting shot wakes an enemy, no matter who shot
      if (hp.current <= 0) {
        const b = lastBlow.current;
        const wire = encodeDeath(b.by, b.x, b.z, -hp.current / maxHp);
        kill(false, readDeath(wire));
        netRef.current?.despawn(wire);
      }
    },
    [kill, knockbackScale, live, maxHp, onHp],
  );

  const net = useNetBody({
    id: options.entityId,
    body,
    immobile: options.immobile,
    enabled: !dead,
    fields: () => {
      const f: Record<string, number> = { hp: hp.current, k: lastBlow.current.k, w: aggro.current ? 1 : 0 };
      const act = opts.current.act;
      if (act) f.a = act();
      return f;
    },
    onFields: (f) => {
      // The first snapshot (a late join, a fresh mount) is the state of
      // things, not a blow landing.
      const first = !seenFields.current;
      seenFields.current = true;
      const t = body.current?.translation() ?? null;
      if (f.w === 1) aggro.current = true;
      // Already awake when we first saw it: no startle.
      if (first) wasAwake.current = aggro.current;
      if (typeof f.a === "number") actWire.current = f.a;
      if (f.hp === undefined || !Number.isFinite(f.hp) || f.hp === hp.current) return;
      const before = hp.current;
      hp.current = f.hp;
      const drop = before - f.hp;
      const now = performance.now() / 1000;
      let believed = f.hp;
      if (ledger.current) {
        // A teammate's blow (or the dungeon's) reads here. Our own already
        // showed on the frame it landed — the ledger knows which is which.
        const ours = drop > 0 ? ack(ledger.current, drop, now) : 0;
        believed = predictedHp(f.hp, ledger.current, now);
        if (!first && drop - ours > 0.01) blowFromWire(drop - ours, f.k, believed);
      } else if (!first && drop > 0.01) {
        blowFromWire(drop, f.k, f.hp);
      }
      live.lifeTo(believed, t, false, first);
      onHp(f.hp, believed);
    },
    onCommand: (cmd, data, from) => {
      if (cmd !== "hit") return;
      // Capped by the depth we're on: staff levels scale legit damage.
      const d = sanitizeHit(data, useGame.getState().floor);
      if (!d || deadRef.current) return;
      const x = readHitExtras(data);
      const b = blowScratch;
      b.at = x.at ? { x: x.at[0], y: x.at[1], z: x.at[2] } : null;
      setDir(b, d.impulse.x, d.impulse.z);
      b.damage = d.damage;
      b.quiet = x.quiet;
      blowLanded(b, hp.current - d.damage, false, x.crit);
      // Only a wizard's own magic earns them the kill.
      applyDamage(d.damage, d.impulse, x.mine ? from : "", x.quiet);
    },
    onDespawn: (data, catchup) => kill(catchup, catchup ? null : readDeath(data)),
  });
  netRef.current = net;

  /** A replica's view of someone else's blow: the drop and the direction step. */
  function blowFromWire(damage: number, k: number | undefined, lifeAfter: number): void {
    const b = blowScratch;
    b.at = null;
    b.hasDir = k !== undefined && dirOf(k, dirScratch);
    b.dx = b.hasDir ? dirScratch.x : 0;
    b.dz = b.hasDir ? dirScratch.z : 0;
    b.damage = damage;
    b.quiet = false;
    blowLanded(b, lifeAfter, false, false);
  }

  // ── The hittable: our own blows ────────────────────────────────────────────
  useEffect(() => {
    if (dead) return;
    const ws = opts.current.weakSpot;
    const id = opts.current.entityId;
    const hittable: Hittable = {
      id: allocId(),
      team: "enemy",
      radius,
      getPosition: () => body.current?.translation() ?? { x: 0, y: -999, z: 0 },
      weakSpot: ws
        ? () => {
            const t = body.current?.translation();
            if (!t) return null;
            const a = live.ahead(ws.fwd ?? 0);
            return { x: t.x + a.x, y: t.y + ws.y + live.pose.y, z: t.z + a.z, r: ws.r };
          }
        : undefined,
      hit: (damage, impulse, info?: HitInfo) => {
        if (deadRef.current) return;
        const mine = info?.mine === true;
        const quiet = info?.quiet === true;
        const crit = info?.crit === true;
        const b = blowScratch;
        b.at = info?.at ? { x: info.at[0], y: info.at[1], z: info.at[2] } : null;
        setDir(b, impulse.x, impulse.z);
        b.damage = damage;
        b.quiet = quiet;
        // Shooter-favored: our shots apply where we saw them land — locally
        // on the authority, via a command to it otherwise (with the physical
        // knockback predicted immediately, so the reaction never waits on
        // the round trip).
        if (isHost()) {
          blowLanded(b, hp.current - damage, mine, crit);
          applyDamage(damage, impulse, mine ? localWizardId() : "", quiet);
          return;
        }
        const now = performance.now() / 1000;
        const l = (ledger.current ??= createLedger());
        noteMine(l, damage, now);
        const believed = predictedHp(hp.current, l, now);
        blowLanded(b, believed, mine, crit);
        live.lifeTo(believed, body.current?.translation() ?? null, mine);
        // Life marks drop on the frame of the blow, not a round trip later.
        updateLife(opts.current.entityId, Math.max(0, believed));
        // Zero-ping kill: we know this was lethal before the host does.
        if (believed <= 0) live.doom();
        // Beside the damage: where it landed (the host's sparks), whose magic
        // it was (the kill's credit), a quiet tug, a precision hit — all
        // read back through hitFx#readHitExtras.
        const cmd: HitData & { at?: [number, number, number]; m?: 1; q?: 1; c?: 1 } = { damage, impulse };
        if (info?.at) cmd.at = info.at;
        if (mine) cmd.m = 1;
        if (quiet) cmd.q = 1;
        if (crit) cmd.c = 1;
        netRef.current?.command("hit", cmd);
        netRef.current?.predictImpulse(impulse, knockbackScale);
      },
    };
    const unregister = registerHittable(hittable);
    if (!import.meta.env?.DEV) return unregister;
    const hit = hittable.hit;
    devHits.set(id, hit);
    devBodies.set(id, live);
    return () => {
      unregister();
      if (devHits.get(id) === hit) devHits.delete(id);
      if (devBodies.get(id) === live) devBodies.delete(id);
    };
  }, [dead, applyDamage, blowLanded, knockbackScale, live, radius]);

  return {
    body,
    view,
    live,
    hp,
    maxHp,
    dead,
    deadRef,
    flash,
    aggro,
    knockTimer,
    net,
    damage: (base) => enemyDamage(base, floor),
    beginFrame(dt) {
      const b = body.current;
      if (!b || deadRef.current || !combatActive()) return null;
      knockTimer.current -= dt;
      const t = b.translation();
      // Woken (here, or on the host): a jolt of fright on every client.
      if (aggro.current && !wasAwake.current) live.startle();
      wasAwake.current = aggro.current;
      const act = opts.current.act;
      live.setAct(net.isAuthority && act ? act() : actWire.current, t);
      live.frame(dt, t, view.current);
      hearEnemy(opts.current.kind, b, aggro.current, voice.current);
      return b;
    },
    paint: (mat, extra, gain) => live.paint(mat, extra, gain),
    armed: () => !live.doomed,
    sense(input, b, pos, time, dt, vel) {
      const target = nearestWizardTo(pos.x, pos.y, pos.z);
      const awake = aggro.current && !devCalm;
      const knocked = knockTimer.current > 0;
      input.pos = pos;
      input.vel = vel ?? (awake && !knocked ? b.linvel() : ZERO);
      input.target = target.pos; // shared scratch — valid until the next query
      input.targetDist = target.dist;
      input.time = time;
      input.dt = dt;
      input.aggro = awake;
      // Only a sleeping enemy needs the stealth factor, so the stat rebuild
      // happens once per wake check, never per frame for an awake enemy.
      input.aggroMult = awake ? 1 : devCalm ? 0 : getStats().aggroMult;
      input.knocked = knocked;
      input.floor = floor;
      input.speedMult = getFloorRules().enemySpeedMult;
      input.vigor = Math.max(0, hp.current / maxHp);
      return input;
    },
    steer(b, s) {
      aggro.current = s.aggro;
      if (s.apply) b.setLinvel(s.vel, true);
    },
  };
}

/** A blow's planar direction from its impulse (none if it pushed straight down). */
function setDir(b: Blow, ix: number, iz: number): void {
  const l = Math.hypot(ix, iz);
  b.hasDir = l > 1e-3;
  b.dx = b.hasDir ? ix / l : 0;
  b.dz = b.hasDir ? iz / l : 0;
}

/** How far off an enemy's steps and waking still carry (m). */
const HEARD_WITHIN = 30;

/** Voice an enemy this frame: a cry on waking, steps as it walks — on every
 * client (replicas walk too, and learn of the waking from the `w` bit), and
 * only within earshot. */
function hearEnemy(
  kind: EnemyId,
  b: RapierRigidBody,
  awake: boolean,
  v: { woke: boolean; cried: number; x: number; z: number; walked: number },
): void {
  if (!isEnemyVoice(kind)) return;
  const t = b.translation();
  const l = listenerAt();
  const near = Math.hypot(t.x - l.x, t.z - l.z) < HEARD_WITHIN;
  // A brain that dozes off and wakes again cries again — but not on repeat.
  const now = performance.now();
  if (awake && !v.woke && near && now - v.cried > 8000) {
    v.cried = now;
    playEnemyWake(kind, [t.x, t.y, t.z]);
  }
  v.woke = awake;
  const stride = ENEMY_STRIDE[kind];
  if (stride > 0 && !Number.isNaN(v.x)) {
    const d = Math.hypot(t.x - v.x, t.z - v.z);
    // A teleport (warp, replica snap) isn't a walk.
    v.walked += d < 1 ? d : 0;
    if (v.walked >= stride) {
      v.walked %= stride;
      if (near) playEnemyStep(kind, [t.x, t.y - 0.4, t.z]);
    }
  }
  v.x = t.x;
  v.z = t.z;
}

export interface ContactDamage {
  /** Touch radius around the enemy's origin (measured to the LOCAL player). */
  range: number;
  /** Damage at floor 1 — scaled by depth and the floor's rule on each touch. */
  damage: number;
  floor: number;
  /** Seconds between burns; defaults to the player's contact cooldown. */
  cooldown?: number;
  /** Shove the player away: planar offset × (force / dist) × planar, plus lift. */
  push?: { force: number; planar: number; lift: number };
  /** Colours of the burst on the player when it lands. */
  burst?: string | string[];
  /** Measure to this height above the player's pose (the Warden aims at the chest). */
  playerLift?: number;
}

/** The contact burn. Local on every client — your health is yours, so it
 * never waits on the authority. Returns a per-frame `touch(pos, dt, armed)`
 * that runs the cooldown and, when the local player is in range, deals the
 * floor-ruled damage attributed to ENEMY_SOURCE and shoves them away. */
export function useContactDamage(spec: ContactDamage): (at: Vec, dt: number, armed?: boolean) => void {
  const latest = useRef(spec);
  latest.current = spec;
  const timer = useRef(0);
  return useCallback((at: Vec, dt: number, armed = true) => {
    const s = latest.current;
    timer.current -= dt;
    if (!armed || timer.current > 0) return;
    const dx = playerPosition.x - at.x;
    const dy = playerPosition.y + (s.playerLift ?? 0) - at.y;
    const dz = playerPosition.z - at.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist >= s.range) return;
    timer.current = s.cooldown ?? PLAYER.contactDamageCooldown;
    useGame.getState().takeDamage(enemyDamage(s.damage, s.floor), ENEMY_SOURCE);
    if (s.burst) {
      // Sparks off the wizard where it bit — low, in the lower edge of view.
      spawnBurst({
        position: [playerPosition.x, playerPosition.y + 0.3, playerPosition.z],
        count: 14,
        color: s.burst,
        endColor: s.burst,
        style: "spark",
        speed: 5,
        upward: 1.5,
        ttl: 0.4,
        size: 0.05,
        intensity: 2.4,
      });
    }
    if (s.push) {
      const k = (s.push.force / Math.max(dist, 0.4)) * s.push.planar;
      getPlayerBody()?.applyImpulse({ x: dx * k, y: s.push.lift, z: dz * k }, true);
    }
  }, []);
}
