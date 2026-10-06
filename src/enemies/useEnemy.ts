import type { RigidBody } from "@dimforge/rapier3d-compat";
import type { RapierRigidBody } from "@react-three/rapier";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { playHit } from "../audio/sound";
import { listenerAt } from "../audio/spatial";
import { ENEMY_STRIDE, isEnemyVoice, playEnemyDeath, playEnemyStep, playEnemyWake } from "../audio/voices";
import { PLAYER } from "../core/config";
import { flashLight } from "../fx/DynamicLights";
import { hitSparksFx, soulDissolveFx } from "../fx/effects";
import { spawnBurst, type BurstOptions } from "../fx/Particles";
import { browserSim, onEnemyCue } from "../game/browserSim";
import { ENEMY_SOURCE } from "../game/damageSource";
import { getFloorRules } from "../game/floorRules";
import { getPlayerBody, playerPosition } from "../game/player-state";
import { allocId, registerHittable } from "../game/registry";
import { isHost } from "../net/netStore";
import { useNetBody, type NetBody } from "../net/NetSystems";
import { enemyOptions, type EnemyController } from "../sim/enemies/controllers";
import { EnemyCore, enemyDamage as simEnemyDamage } from "../sim/enemies/core";
import type { SimCue } from "../sim/world";
import { combatActive, useGame } from "../state/gameStore";
import { sanitizeHit, type HitData } from "../weapons/damage";
import type { Vec3 } from "../world/types";
import type { Vec } from "./brains/common";
import type { EnemyId } from "./roster";

/** An enemy's VIEW: its body in the React scene, its looks, its sounds, and
 * its replication wiring. What it IS — health, hits, knockback, the wake
 * latch, death and loot (sim/enemies/core.ts) — and how it fights (its
 * controller, sim/enemies/controllers.ts) are plain TypeScript the headless
 * FloorSim runs too; here they run in the browser through browserSim, and
 * only on the floor's authority. A kind file is left with its model, its
 * visual feedback and its contact burn.
 *
 * Floor rules (game/floorRules.ts) are read live at the moment they matter:
 * health at spawn, damage when it's dealt, speed each frame. That keeps
 * omens out of every component — but it does mean a floor's rules must be
 * installed before its enemies mount. */

/** Damage an enemy deals at `floor` under the current floor's rule — what a
 * contact burn costs the local player. */
export function enemyDamage(base: number, floor: number): number {
  return simEnemyDamage(base, floor, getFloorRules().enemyDamageMult);
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

/** A view's options. What the enemy IS beyond its kind — its health scale,
 * where its loot lands, how hard it is to shove — is the sim's
 * (sim/enemies/controllers.ts enemyOptions), so it's the same wherever the
 * floor is simulated. */
export interface UseEnemyOptions {
  /** Roster id — where baseHealth comes from. */
  kind: EnemyId;
  entityId: string;
  position: Vec3;
  floor: number;
  /** A slime's split generation (0 for everything else). */
  generation?: number;
  /** Omit for a fully custom death (the Warden's, via onDeathFx). */
  deathFx?: EnemyDeathFx;
  /** Extra effects of a real (non-silent) death, on every machine. */
  onDeathFx?: (at: Vec) => void;
  /** Runs on EVERY death, including silent late-join catch-up. */
  onKilled?: () => void;
  /** Colour of the small burst when a shot lands (none if omitted). */
  hitColor?: string;
  /** Sentries never move — replicate hp only. */
  immobile?: boolean;
  /** Health changed while alive — applied damage on the authority, a
   * snapshot on a replica. */
  onHp?: (hp: number, maxHp: number) => void;
  /** Something the authority's controller wants shown (sim/world.ts SimCue). */
  onCue?: (cue: SimCue) => void;
}

export interface EnemyShell<C extends EnemyController> {
  body: RefObject<RapierRigidBody | null>;
  /** Its authority state (health, flash, wake…) — see sim/enemies/core.ts. */
  core: EnemyCore;
  /** Its kind's controller (brain state the view may read). */
  ctl: C;
  dead: boolean;
  net: NetBody;
  /** Per frame: the body when this enemy should act (mounted, alive, combat
   * live), else null — after letting the controller think, on the authority
   * only, and voicing it. */
  frame(dt: number, time: number): RapierRigidBody | null;
}

export function useEnemy<C extends EnemyController>(
  options: UseEnemyOptions,
  makeController: (core: EnemyCore) => C,
): EnemyShell<C> {
  // Latest options behind a ref: the hooks below stay stable across
  // re-renders, so the hittable and net registrations never churn.
  const opts = useRef(options);
  opts.current = options;
  const body = useRef<RapierRigidBody>(null);
  const [dead, setDead] = useState(false);
  // Its voice: woken once, a footfall every stride it walks.
  const voice = useRef({ woke: false, cried: -Infinity, x: NaN, z: NaN, walked: 0 });

  const [{ core, ctl }] = useState(() => {
    const o = options;
    const core = new EnemyCore(
      browserSim,
      enemyOptions(o.entityId, o.kind, o.floor, o.position, o.generation),
      () => body.current,
    );
    core.onHp = (hp, maxHp) => opts.current.onHp?.(hp, maxHp);
    core.onCue = (cue) => opts.current.onCue?.(cue);
    core.onDeath = (t, silent) => {
      const c = opts.current;
      if (!silent) {
        const fx = c.deathFx;
        if (fx) {
          const at: Vec3 = [t.x, t.y + (fx.lift ?? 0), t.z];
          spawnBurst({ ...fx.burst, position: at });
          soulDissolveFx(at, fx.soul ?? fx.light.color, fx.scale ?? 1);
          flashLight(at, fx.light.color, fx.light.intensity);
        }
        c.onDeathFx?.(t);
        if (isEnemyVoice(c.kind)) playEnemyDeath(c.kind, [t.x, t.y, t.z]);
      }
      c.onKilled?.();
      setDead(true);
    };
    return { core, ctl: makeController(core) };
  });

  const hitFeedback = useCallback(() => {
    const color = opts.current.hitColor;
    const t = color ? body.current?.translation() : undefined;
    if (!t || !color) return;
    hitSparksFx(t, color);
  }, []);

  const net = useEnemyNet({
    entityId: options.entityId,
    body,
    core,
    dead,
    immobile: options.immobile,
    hitFeedback,
  });

  // What the floor's authority shows for this enemy elsewhere (its slam's
  // warning circle, its muzzle flash) shows here too.
  useEffect(() => {
    if (dead) return;
    return onEnemyCue(options.entityId, (cue) => core.onCue?.(cue));
  }, [dead, core, options.entityId]);

  return {
    body,
    core,
    ctl,
    dead,
    net,
    frame(dt, time) {
      const b = core.beginFrame(dt, combatActive()) as RapierRigidBody | null;
      if (!b) return null;
      hearEnemy(opts.current.kind, b, core.aggro, voice.current);
      if (net.isAuthority) ctl.think(b, dt, time);
      return b;
    },
  };
}

/** How far off an enemy's steps and waking still carry (m). */
const HEARD_WITHIN = 30;

/** Voice an enemy this frame: a cry on waking, steps as it walks — on every
 * client (replicas walk too), and only within earshot. */
function hearEnemy(
  kind: EnemyId,
  b: RigidBody,
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
 * automatic) and wires the hittable so damage routes to the authority — the
 * core takes it there. */
function useEnemyNet(opts: {
  entityId: string;
  body: RefObject<RapierRigidBody | null>;
  core: EnemyCore;
  dead: boolean;
  /** Sentries never move — replicate hp only. */
  immobile?: boolean;
  hitFeedback?: () => void;
}): NetBody {
  const { entityId, body, core, dead, immobile, hitFeedback } = opts;
  const knockbackScale = core.opts.knockbackScale ?? 1;
  const netRef = useRef<NetBody | null>(null);

  const net = useNetBody({
    id: entityId,
    body,
    immobile,
    enabled: !dead,
    fields: () => core.fields(),
    onFields: (f) => {
      if (f.hp !== undefined) core.syncHp(f.hp);
    },
    onCommand: (cmd, data) => {
      if (cmd === "hit") {
        // Capped by the depth we're on: staff levels scale legit damage.
        const d = sanitizeHit(data, useGame.getState().floor);
        if (d) core.hit(d.damage, d.impulse);
      }
    },
    onDespawn: (_data, catchup) => core.despawned(catchup),
  });
  netRef.current = net;

  useEffect(() => {
    if (dead) return;
    return registerHittable({
      id: allocId(),
      team: "enemy",
      getPosition: () => body.current?.translation() ?? { x: 0, y: -999, z: 0 },
      hit: (damage, impulse) => {
        if (core.dead) return;
        core.flash = 1;
        const at = body.current?.translation();
        playHit(at ? [at.x, at.y, at.z] : undefined);
        hitFeedback?.();
        // Shooter-favored: our shots apply where we saw them land — locally
        // on the authority, via a command to it otherwise (with the physical
        // knockback predicted immediately, so the reaction never waits on
        // the round trip).
        if (isHost()) {
          core.hit(damage, impulse);
        } else {
          netRef.current?.command("hit", { damage, impulse } satisfies HitData);
          netRef.current?.predictImpulse(impulse, knockbackScale);
        }
      },
    });
  }, [dead, core, body, hitFeedback, knockbackScale]);

  return net;
}
