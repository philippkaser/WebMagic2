import type { RapierRigidBody } from "@react-three/rapier";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { playHit } from "../audio/sound";
import { listenerAt } from "../audio/spatial";
import { ENEMY_STRIDE, isEnemyVoice, playEnemyDeath, playEnemyStep, playEnemyWake } from "../audio/voices";
import { floorScale, PLAYER } from "../core/config";
import { flashLight } from "../fx/DynamicLights";
import { hitSparksFx, soulDissolveFx } from "../fx/effects";
import { spawnBurst, type BurstOptions } from "../fx/Particles";
import { ENEMY_SOURCE } from "../game/damageSource";
import { getFloorRules } from "../game/floorRules";
import { getPlayerBody, playerPosition } from "../game/player-state";
import { allocId, registerHittable } from "../game/registry";
import { nearestWizardTo } from "../game/targets";
import { GOLD_DROPS } from "../items/economy";
import { dropGold, dropLoot } from "../items/LootOrbs";
import { isHost } from "../net/netStore";
import { useNetBody, type NetBody } from "../net/NetSystems";
import { combatActive, getStats, useGame } from "../state/gameStore";
import { sanitizeHit, type HitData } from "../weapons/damage";
import type { Vec3 } from "../world/types";
import type { ChaseInput, Steering, Vec } from "./brains/common";
import { getEnemyStats, type EnemyId } from "./roster";

/** The shared enemy shell: everything an enemy is that isn't its brain or its
 * looks. Every kind used to carry its own copy of this — health from the
 * roster, the dead latch, the hit flash, aggro and knockback timers, a death
 * that bursts, flashes and drops loot, and the replication wiring — so it
 * lives here once, and a kind file is left with its brain wiring and model.
 *
 * Floor rules (game/floorRules.ts) are read live at the moment they matter:
 * health at spawn, damage when it's dealt, speed each frame (loot and gold
 * rules live in items/LootOrbs). That keeps omens out of every component —
 * but it does mean a floor's rules must be installed before its enemies
 * mount. */

/** Base chance a regular enemy drops an item. */
export const ENEMY_LOOT_CHANCE = 0.24;

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
  /** Colour of the small burst when a shot lands (none if omitted). */
  hitColor?: string;
  /** Sentries never move — replicate hp only. */
  immobile?: boolean;
  /** Fraction of knockback impulses that actually applies (bosses resist). */
  knockbackScale?: number;
  /** How fast the hit flash fades (per second). */
  flashDecay?: number;
  /** Authoritative hp changed while alive — applied damage on the authority,
   * a snapshot on a replica. */
  onHp?: (hp: number, maxHp: number) => void;
}

export interface EnemyShell {
  body: RefObject<RapierRigidBody | null>;
  hp: RefObject<number>;
  /** Health at spawn (roster × generation × depth × floor rule). */
  maxHp: number;
  dead: boolean;
  deadRef: RefObject<boolean>;
  /** Hit flash, 1 on a hit and fading to 0 — drive an emissive with it. */
  flash: RefObject<number>;
  /** Woken — set by damage from anyone, or by the brain's proximity check. */
  aggro: RefObject<boolean>;
  /** Knockback in flight (> 0) — brains leave the body to physics. */
  knockTimer: RefObject<number>;
  net: NetBody;
  /** Damage this enemy deals for a base amount (see enemyDamage). */
  damage(base: number): number;
  /** Per-frame preamble: the body when this enemy should act this frame
   * (mounted, alive, combat live), else null. Fades the hit flash and runs
   * down the knockback timer. */
  beginFrame(dt: number): RapierRigidBody | null;
  /** Fill a chase brain's senses: body pose, nearest wizard, clock, wake and
   * knock state, the floor's speed rule. `vel` defaults to a read of the
   * body's velocity, made only when an awake, unstaggered brain will steer
   * with it (it's a physics-engine round trip). */
  sense(input: ChaseInput, b: RapierRigidBody, pos: Vec, time: number, dt: number, vel?: Vec): ChaseInput;
  /** Apply a chase brain's decision: latch its wake state, set its velocity. */
  steer(b: RapierRigidBody, s: Steering): void;
}

export function useEnemy(options: UseEnemyOptions): EnemyShell {
  // Latest options behind a ref: the callbacks below stay stable across
  // re-renders, so the hittable and net registrations never churn.
  const opts = useRef(options);
  opts.current = options;
  const { floor, flashDecay = 5 } = options;

  const body = useRef<RapierRigidBody>(null);
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
  // Its voice: woken once, a footfall every stride it walks.
  const voice = useRef({ woke: false, cried: -Infinity, x: NaN, z: NaN, walked: 0 });

  const kill = useCallback((silent = false) => {
    if (deadRef.current) return;
    deadRef.current = true;
    const o = opts.current;
    const t = body.current?.translation() ?? { x: o.position[0], y: o.position[1], z: o.position[2] };
    if (!silent) {
      const fx = o.deathFx;
      if (fx) {
        const at: Vec3 = [t.x, t.y + (fx.lift ?? 0), t.z];
        spawnBurst({ ...fx.burst, position: at });
        soulDissolveFx(at, fx.soul ?? fx.light.color, fx.scale ?? 1);
        flashLight(at, fx.light.color, fx.light.intensity);
      }
      const drops = o.drops;
      if (drops) {
        const at: Vec3 = [t.x, Math.max(t.y + (drops.lift ?? 0), drops.minY ?? -Infinity), t.z];
        // Base odds only — LootOrbs applies the floor's loot/gold rules itself.
        if (drops.lootChance > 0) dropLoot(at, o.floor, drops.lootChance);
        dropGold(at, o.floor, GOLD_DROPS.enemyChance, "enemy");
      }
      o.onDeathFx?.(t);
      if (isEnemyVoice(o.kind)) playEnemyDeath(o.kind, [t.x, t.y, t.z]);
    }
    o.onKilled?.();
    setDead(true);
  }, []);

  const hitFeedback = useCallback(() => {
    const color = opts.current.hitColor;
    const t = color ? body.current?.translation() : undefined;
    if (!t || !color) return;
    hitSparksFx(t, color);
  }, []);

  // Getting shot wakes an enemy, no matter who shot.
  const onDamaged = useCallback(() => {
    aggro.current = true;
  }, []);

  const onHp = useCallback(
    (current: number) => {
      if (!deadRef.current) opts.current.onHp?.(current, maxHp);
    },
    [maxHp],
  );

  const net = useEnemyNet({
    entityId: options.entityId,
    body,
    hp,
    deadRef,
    flash,
    dead,
    immobile: options.immobile,
    knockTimer,
    knockbackScale: options.knockbackScale,
    onKill: kill,
    hitFeedback,
    onDamaged,
    onHp,
  });

  return {
    body,
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
      flash.current = Math.max(0, flash.current - dt * flashDecay);
      knockTimer.current -= dt;
      hearEnemy(opts.current.kind, b, aggro.current, voice.current);
      return b;
    },
    sense(input, b, pos, time, dt, vel) {
      const target = nearestWizardTo(pos.x, pos.y, pos.z);
      const awake = aggro.current;
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
      input.aggroMult = awake ? 1 : getStats().aggroMult;
      input.knocked = knocked;
      input.floor = floor;
      input.speedMult = getFloorRules().enemySpeedMult;
      return input;
    },
    steer(b, s) {
      aggro.current = s.aggro;
      if (s.apply) b.setLinvel(s.vel, true);
    },
  };
}

/** How far off an enemy's steps and waking still carry (m). */
const HEARD_WITHIN = 30;

/** Voice an enemy this frame: a cry on waking, steps as it walks — on every
 * client (replicas walk too), and only within earshot. */
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

/** Shared enemy networking: registers the entity with the replication
 * framework (snapshots, interpolation, late-join and migration are all
 * automatic) and wires the hittable so damage routes to the authority. The
 * networking core of useEnemy; exported for anything enemy-like that wants
 * the same routing without the rest of the shell. */
export function useEnemyNet(opts: {
  entityId: string;
  body: RefObject<RapierRigidBody | null>;
  hp: RefObject<number>;
  deadRef: RefObject<boolean>;
  flash: RefObject<number>;
  dead: boolean;
  /** Sentries never move — replicate hp only. */
  immobile?: boolean;
  knockTimer?: RefObject<number>;
  /** Fraction of knockback impulses that actually applies (bosses resist). */
  knockbackScale?: number;
  /** silent = late-join catch-up: apply the death without VFX. */
  onKill: (silent?: boolean) => void;
  hitFeedback?: () => void;
  /** Authority: damage landed (from anyone) — wake up and fight back. */
  onDamaged?: () => void;
  /** Authoritative hp changed (applied here, or a snapshot on a replica). */
  onHp?: (hp: number) => void;
}): NetBody {
  const {
    entityId,
    body,
    hp,
    deadRef,
    flash,
    dead,
    immobile,
    knockTimer,
    knockbackScale = 1,
    onKill,
    hitFeedback,
    onDamaged,
    onHp,
  } = opts;

  const netRef = useRef<NetBody | null>(null);

  const applyDamage = useCallback(
    (damage: number, impulse: { x: number; y: number; z: number }) => {
      if (deadRef.current) return;
      hp.current -= damage;
      flash.current = 1;
      if (knockTimer) knockTimer.current = 0.4;
      body.current?.applyImpulse(
        {
          x: impulse.x * knockbackScale,
          y: impulse.y * knockbackScale,
          z: impulse.z * knockbackScale,
        },
        true,
      );
      onHp?.(hp.current);
      onDamaged?.();
      if (hp.current <= 0) {
        onKill();
        netRef.current?.despawn();
      }
    },
    [body, deadRef, flash, hp, knockTimer, knockbackScale, onKill, onDamaged, onHp],
  );

  const net = useNetBody({
    id: entityId,
    body,
    immobile,
    enabled: !dead,
    fields: () => ({ hp: hp.current }),
    onFields: (f) => {
      if (f.hp !== undefined) {
        hp.current = f.hp;
        onHp?.(f.hp);
      }
    },
    onCommand: (cmd, data) => {
      if (cmd === "hit") {
        // Capped by the depth we're on: staff levels scale legit damage.
        const d = sanitizeHit(data, useGame.getState().floor);
        if (d) applyDamage(d.damage, d.impulse);
      }
    },
    onDespawn: (_data, catchup) => onKill(catchup),
  });
  netRef.current = net;

  useEffect(() => {
    if (dead) return;
    return registerHittable({
      id: allocId(),
      team: "enemy",
      getPosition: () => body.current?.translation() ?? { x: 0, y: -999, z: 0 },
      hit: (damage, impulse) => {
        if (deadRef.current) return;
        flash.current = 1;
        const at = body.current?.translation();
        playHit(at ? [at.x, at.y, at.z] : undefined);
        hitFeedback?.();
        // Shooter-favored: our shots apply where we saw them land — locally
        // on the authority, via a command to it otherwise (with the physical
        // knockback predicted immediately, so the reaction never waits on
        // the round trip).
        if (isHost()) {
          applyDamage(damage, impulse);
        } else {
          netRef.current?.command("hit", { damage, impulse } satisfies HitData);
          netRef.current?.predictImpulse(impulse, knockbackScale);
        }
      },
    });
  }, [dead, applyDamage, body, deadRef, flash, hitFeedback, knockbackScale]);

  return net;
}
