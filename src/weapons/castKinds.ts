import { Vector3 } from "three";
import { flashLight } from "../fx/DynamicLights";
import { hitSparksFx } from "../fx/effects";
import { beamFx, flameConeFx, lightningFx, railFx } from "../fx/spellFx";
import { wizardSource } from "../game/damageSource";
import { isHostileWizard } from "../game/hostility";
import { getPlayerBody, playerPosition } from "../game/player-state";
import { forEachHittable, type Hittable } from "../game/registry";
import { castWorldRay, clearLine } from "../game/worldRay";
import type { ItemDef } from "../items/types";
import { useGame } from "../state/gameStore";
import { localBlastEffect } from "./allegiance";
import type { CastStats } from "./castMessage";
import { explode } from "./explosions";
import { chainPath, coneHits, lightningPoints, rayHits, type HitTarget } from "./hitscan";
import { localWizardId } from "./localWizard";
import { reportLocalHit } from "./procs";
import { fireProjectile } from "./projectiles";
import { activateSingularities } from "./singularity";
import type {
  BlastSpell,
  BoltSpell,
  ChainSpell,
  ConeSpell,
  RaySpell,
  SeedSpell,
  ShockwaveSpell,
  SpellDef,
} from "./spellCatalog";

/** Cast implementations, one per spell kind. The numbers come from the row
 * in spellCatalog.ts; this module only knows HOW each kind behaves.
 *
 * Every cast runs twice on a multiplayer floor: for real on the caster's
 * machine, and as a replay (`remote`) on every floor-mate's, through this
 * exact code. Replays stay cosmetic vs entities (the caster requests the
 * damage), skip caster-only effects (recoil), and carry the caster's
 * wizard source — which is what lets a hostile wizard's replayed spell hurt
 * the local wizard (see allegiance.ts). */

export interface AbilityContext {
  origin: Vector3;
  /** Unit aim direction. */
  dir: Vector3;
  /** The caster's gear stats that shape a cast (local: getStats(); replay:
   * the sanitized stats from the cast message). */
  stats: CastStats;
  staff: ItemDef;
  /** Wizard id of the caster: localWizardId() for our casts, the sender for
   * replays. Attributes damage and decides whose seeds a Collapse detonates. */
  caster: string;
  /** True when replaying a floor-mate's cast — skip caster-only effects. */
  remote?: boolean;
  /** Cast by a legendary power: its hits don't roll powers again. */
  noProc?: boolean;
}

export function castSpell(def: Readonly<SpellDef>, ctx: AbilityContext): void {
  switch (def.kind) {
    case "bolt":
      return castBolt(def, ctx);
    case "blast":
      return castBlast(def, ctx);
    case "shockwave":
      return castShockwave(def, ctx);
    case "seed":
      return castSeed(def, ctx);
    case "collapse":
      return activateSingularities(ctx.caster);
    case "ray":
      return castRay(def, ctx);
    case "chain":
      return castChain(def, ctx);
    case "cone":
      return castCone(def, ctx);
    default: {
      const unknown: never = def;
      throw new Error(`Unhandled spell kind: ${(unknown as SpellDef).kind}`);
    }
  }
}

// Scratch vectors: casts are synchronous and fireProjectile/explode copy what
// they need, so one set serves every cast.
const aim = new Vector3();
const jitter = new Vector3();
const at = new Vector3();

/** When multishot widens a volley, spread it at least this much so stacked
 * bolts don't fly as one indistinguishable line. */
const MULTISHOT_MIN_SPREAD = 0.06;

function castBolt(def: Readonly<BoltSpell>, ctx: AbilityContext): void {
  const source = wizardSource(ctx.caster);
  const s = ctx.stats;
  const extra = Math.max(0, Math.round(s.extraProjectiles ?? 0));
  const total = def.count + extra;
  const spread = total > 1 ? Math.max(def.spread, MULTISHOT_MIN_SPREAD) : def.spread;
  const speed = def.speed * (s.projectileSpeedMult ?? 1);
  for (let i = 0; i < total; i++) {
    jitter.set(
      (Math.random() - 0.5) * spread,
      (Math.random() - 0.5) * spread,
      (Math.random() - 0.5) * spread,
    );
    aim.copy(ctx.dir).add(jitter).normalize().multiplyScalar(speed);
    // A lobbed shell rises before it falls.
    if (def.lob) aim.y += speed * def.lob;
    fireProjectile({
      team: "player",
      source,
      position: [ctx.origin.x, ctx.origin.y, ctx.origin.z],
      velocity: [aim.x, aim.y, aim.z],
      damage: def.damage * ctx.stats.damageMult,
      color: ctx.staff.color,
      size: def.size,
      gravityScale: def.gravityScale,
      blastRadius: def.blastRadius * (s.blastRadiusMult ?? 1),
      blastImpulse: def.blastImpulse * (s.knockbackMult ?? 1),
      homing: s.homing ?? 0,
      bounces: s.bounces ?? 0,
      pierce: s.pierce ?? 0,
      splitShards: s.splitShards ?? 0,
      chain: s.chain ?? 0,
      // A peer's replayed bolt is visual: their own client requests the damage.
      cosmetic: ctx.remote ?? false,
    });
  }
}

/** Shared by Force Blast and Shockwave: a player-team explosion at `center`. */
function burst(
  def: Readonly<BlastSpell | ShockwaveSpell>,
  center: Vector3,
  ctx: AbilityContext,
  vfx: "blast" | "shockwave" = "blast",
): void {
  explode({
    position: center,
    radius: def.radius * (ctx.stats.blastRadiusMult ?? 1),
    damage: def.damage * ctx.stats.damageMult,
    impulse: def.impulse * (ctx.stats.knockbackMult ?? 1),
    team: "player",
    source: wizardSource(ctx.caster),
    color: ctx.staff.color,
    particles: def.particles,
    light: def.light,
    remote: ctx.remote,
    vfx,
  });
}

function castBlast(def: Readonly<BlastSpell>, ctx: AbilityContext): void {
  at.copy(ctx.dir).multiplyScalar(def.reach).add(ctx.origin);
  burst(def, at, ctx);
  // Recoil: aim at the floor to blast-jump. Caster only — a peer's blast
  // still pushes us via the explosion itself, not via recoil.
  if (!ctx.remote) {
    const { back, up, minLift } = def.recoil;
    getPlayerBody()?.applyImpulse(
      { x: -ctx.dir.x * back, y: Math.max(-ctx.dir.y * up, minLift), z: -ctx.dir.z * back },
      true,
    );
  }
}

function castShockwave(def: Readonly<ShockwaveSpell>, ctx: AbilityContext): void {
  burst(def, ctx.origin, ctx, "shockwave");
}

function castSeed(def: Readonly<SeedSpell>, ctx: AbilityContext): void {
  aim.copy(ctx.dir).multiplyScalar(def.speed);
  fireProjectile({
    team: "player",
    source: wizardSource(ctx.caster),
    position: [ctx.origin.x, ctx.origin.y, ctx.origin.z],
    velocity: [aim.x, aim.y, aim.z],
    // The seed carries the black hole's implosion damage.
    damage: def.damage * ctx.stats.damageMult,
    color: def.color,
    size: def.size,
    gravityScale: def.gravityScale,
    singularity: true,
    cosmetic: ctx.remote ?? false,
  });
}

// ── Hitscan: rays, lightning, flame ──────────────────────────────────────────
// No projectile flies; the cast decides at once what it touches. Walls stop
// it (game/worldRay); creatures and props are found by geometry
// (weapons/hitscan). On the caster's machine the hits are real (routed to
// the floor authority like any hit); on a floor-mate's, the replay is
// cosmetic — except that a HOSTILE caster's line can hit the local wizard,
// decided right here on the victim's machine, like every PvP hit.

type Struck = Hittable | "me";

const LOCAL_BODY_RADIUS = 0.45;

function hitTargets(ctx: AbilityContext): HitTarget<Struck>[] {
  const out: HitTarget<Struck>[] = [];
  forEachHittable((h) => out.push({ pos: h.getPosition(), radius: h.radius ?? 0.5, ref: h }));
  if (ctx.remote && hostileToMe(ctx)) {
    out.push({ pos: { x: playerPosition.x, y: playerPosition.y, z: playerPosition.z }, radius: LOCAL_BODY_RADIUS, ref: "me" });
  }
  return out;
}

function hostileToMe(ctx: AbilityContext): boolean {
  return localBlastEffect("player", wizardSource(ctx.caster), localWizardId(), isHostileWizard).damageMult > 0;
}

/** One hit from a hitscan spell. */
function strike(target: HitTarget<Struck>, damage: number, push: { x: number; y: number; z: number }, ctx: AbilityContext): void {
  if (target.ref === "me") {
    const effect = localBlastEffect("player", wizardSource(ctx.caster), localWizardId(), isHostileWizard);
    if (effect.damageMult > 0) useGame.getState().takeDamage(damage * effect.damageMult, effect.source);
    return;
  }
  if (ctx.remote) return; // the caster's own machine requests the damage
  target.ref.hit(damage, push);
  if (target.ref.team === "enemy" && !ctx.noProc) reportLocalHit(target.pos, damage);
}

const end = new Vector3();

function castRay(def: Readonly<RaySpell>, ctx: AbilityContext): void {
  const wall = castWorldRay(ctx.origin, ctx.dir, def.range);
  const hits = rayHits(ctx.origin, ctx.dir, wall, hitTargets(ctx), def.width);
  const maxStruck = def.pierce + Math.max(0, Math.round(ctx.stats.pierce ?? 0)) + 1;
  const struck = hits.slice(0, maxStruck);
  const damage = def.damage * ctx.stats.damageMult;
  const kb = def.impulse * (ctx.stats.knockbackMult ?? 1);
  const push = { x: ctx.dir.x * kb, y: kb * 0.25, z: ctx.dir.z * kb };
  for (const h of struck) strike(h.target, damage, push, ctx);
  // Stopped by the last body it could burn through, or by stone.
  const dist = struck.length === maxStruck ? struck[struck.length - 1]!.t : wall;
  end.copy(ctx.dir).multiplyScalar(dist).add(ctx.origin);
  if (def.look === "beam") {
    beamFx(ctx.origin, end, ctx.staff.color, dist < def.range - 0.01);
    flashLight([end.x, end.y, end.z], ctx.staff.color, 7, 3);
  } else {
    railFx(ctx.origin, end, ctx.staff.color);
    flashLight([end.x, end.y, end.z], ctx.staff.color, 30, 8);
  }
  // Arcing gear: the burn leaps on (a beam only now and then — it ticks).
  const chain = Math.round(ctx.stats.chain ?? 0);
  const last = struck[struck.length - 1];
  if (chain > 0 && last && (def.cooldown >= 0.25 || Math.random() < 0.25)) {
    leap(last.target, chain, 6, damage * 0.45, 0.8, ctx);
  }
}

function castChain(def: Readonly<ChainSpell>, ctx: AbilityContext): void {
  const wall = castWorldRay(ctx.origin, ctx.dir, def.range);
  const targets = hitTargets(ctx);
  // Lightning finds its mark: a generous aim.
  const first = rayHits(ctx.origin, ctx.dir, wall, targets, 0.9).find((h) => h.target.ref === "me" || (h.target.ref as Hittable).team === "enemy");
  if (!first) {
    // Nothing to strike: it cracks against the stone ahead.
    end.copy(ctx.dir).multiplyScalar(wall).add(ctx.origin);
    lightningFx(lightningPoints(ctx.origin, end, 9, 0.45), ctx.staff.color);
    flashLight([end.x, end.y, end.z], ctx.staff.color, 16, 6);
    return;
  }
  const damage = def.damage * ctx.stats.damageMult;
  lightningFx(lightningPoints(ctx.origin, first.target.pos, 9, 0.45), ctx.staff.color);
  const kb = def.impulse * (ctx.stats.knockbackMult ?? 1);
  strike(first.target, damage, { x: ctx.dir.x * kb, y: kb * 0.3, z: ctx.dir.z * kb }, ctx);
  hitSparksFx(first.target.pos, ctx.staff.color);
  flashLight([first.target.pos.x, first.target.pos.y, first.target.pos.z], ctx.staff.color, 22, 7);
  const jumps = def.jumps + Math.max(0, Math.round(ctx.stats.chain ?? 0));
  leap(first.target, jumps, def.jumpRange, damage * def.falloff, def.falloff, ctx, targets);
}

/** Lightning leaping on from `from`: nearest creature (or, for a hostile
 * caster, the local wizard) in reach and in sight, `jumps` times. */
function leap(
  from: HitTarget<Struck>,
  jumps: number,
  range: number,
  damage: number,
  falloff: number,
  ctx: AbilityContext,
  targets: HitTarget<Struck>[] = hitTargets(ctx),
): void {
  const living = targets.filter((t) => t.ref === "me" || (t.ref as Hittable).team === "enemy");
  const path = chainPath(from, living, jumps, range);
  let dmg = damage;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!.pos;
    const t = path[i]!;
    if (!clearLine(a, t.pos)) break; // lightning doesn't pass through rock
    lightningFx(lightningPoints(a, t.pos, 7, 0.4), ctx.staff.color);
    strike(t, dmg, { x: 0, y: 2, z: 0 }, ctx);
    hitSparksFx(t.pos, ctx.staff.color, 0.8);
    dmg *= falloff;
  }
}

function castCone(def: Readonly<ConeSpell>, ctx: AbilityContext): void {
  const half = (def.angle * Math.PI) / 180;
  flameConeFx(ctx.origin, ctx.dir, def.range, half, ctx.staff.color);
  end.copy(ctx.dir).multiplyScalar(Math.min(2, def.range)).add(ctx.origin);
  flashLight([end.x, end.y, end.z], ctx.staff.color, 6, 5);
  const damage = def.damage * ctx.stats.damageMult;
  const kb = def.impulse * (ctx.stats.knockbackMult ?? 1);
  for (const h of coneHits(ctx.origin, ctx.dir, def.range, half, hitTargets(ctx))) {
    if (!clearLine(ctx.origin, h.target.pos, h.target.radius)) continue;
    // The heart of the cone burns hottest.
    const k = 0.6 + 0.4 * h.centred;
    strike(h.target, damage * k, { x: ctx.dir.x * kb, y: kb * 0.2, z: ctx.dir.z * kb }, ctx);
  }
}
