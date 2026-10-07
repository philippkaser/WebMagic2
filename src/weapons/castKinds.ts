import { Vector3 } from "three";
import { wizardSource } from "../game/damageSource";
import { getPlayerBody } from "../game/player-state";
import type { ItemDef } from "../items/types";
import type { CastStats } from "./castMessage";
import { explode } from "./explosions";
import { fireProjectile } from "./projectiles";
import { boltVolley } from "../sim/spells";
import { activateSingularities } from "./singularity";
import type {
  BlastSpell,
  BoltSpell,
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
  /** The volley's spread seed (the cast message carries it): the caster,
   * every replay and a server host fire the same bolts. */
  seed: number;
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
    default: {
      const unknown: never = def;
      throw new Error(`Unhandled spell kind: ${(unknown as SpellDef).kind}`);
    }
  }
}

// Scratch vectors: casts are synchronous and fireProjectile/explode copy what
// they need, so one set serves every cast.
const aim = new Vector3();
const at = new Vector3();

function castBolt(def: Readonly<BoltSpell>, ctx: AbilityContext): void {
  const source = wizardSource(ctx.caster);
  for (const d of boltVolley(def, ctx.dir, ctx.stats.extraProjectiles ?? 0, ctx.seed)) {
    aim.set(d.x, d.y, d.z).multiplyScalar(def.speed);
    fireProjectile({
      team: "player",
      source,
      position: [ctx.origin.x, ctx.origin.y, ctx.origin.z],
      velocity: [aim.x, aim.y, aim.z],
      damage: def.damage * ctx.stats.damageMult,
      color: ctx.staff.color,
      size: def.size,
      gravityScale: def.gravityScale,
      blastRadius: def.blastRadius,
      blastImpulse: def.blastImpulse,
      homing: ctx.stats.homing ?? 0,
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
    radius: def.radius,
    damage: def.damage * ctx.stats.damageMult,
    impulse: def.impulse,
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
