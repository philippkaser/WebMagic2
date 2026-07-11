import { Vector3 } from "three";
import { getPlayerBody } from "../game/player-state";
import type { DerivedStats, ItemDef } from "../items/types";
import { explode } from "./damage";
import { fireProjectile } from "./projectiles";

/** Staff abilities. Staffs reference these by id, so new staffs are pure data. */

export interface AbilityContext {
  origin: Vector3;
  dir: Vector3;
  stats: DerivedStats;
  staff: ItemDef;
  /** True when replaying a floor-mate's cast — skip caster-only effects. */
  remote?: boolean;
}

export interface Ability {
  id: string;
  name: string;
  mana: number;
  cooldown: number;
  /** One-line stat summary for inventory/tooltip display ("16 dmg"). Kept
   * next to the cast numbers so the two can't drift apart. */
  info: string;
  cast(ctx: AbilityContext): void;
}

const tmp = new Vector3();

function bolt(ctx: AbilityContext, opts: {
  damage: number;
  speed: number;
  size: number;
  spread?: number;
  gravityScale?: number;
  blastRadius?: number;
  blastImpulse?: number;
}) {
  const spread = opts.spread ?? 0.012;
  tmp
    .copy(ctx.dir)
    .add(
      new Vector3(
        (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * spread,
      ),
    )
    .normalize()
    .multiplyScalar(opts.speed);
  fireProjectile({
    team: "player",
    position: [ctx.origin.x, ctx.origin.y, ctx.origin.z],
    velocity: [tmp.x, tmp.y, tmp.z],
    damage: opts.damage * ctx.stats.damageMult,
    color: ctx.staff.color,
    size: opts.size,
    gravityScale: opts.gravityScale ?? 0,
    blastRadius: opts.blastRadius,
    blastImpulse: opts.blastImpulse,
    // A peer's replayed bolt is visual: their own client requests the damage.
    cosmetic: ctx.remote ?? false,
  });
}

const ABILITIES: Record<string, Ability> = {
  bolt: {
    id: "bolt",
    name: "Bolt",
    mana: 3,
    cooldown: 0.26,
    info: "16 dmg",
    cast: (ctx) => bolt(ctx, { damage: 16, speed: 34, size: 0.13 }),
  },
  scatter: {
    id: "scatter",
    name: "Ember Scatter",
    mana: 7,
    cooldown: 0.55,
    info: "5×8 dmg, spread",
    cast: (ctx) => {
      for (let i = 0; i < 5; i++) {
        bolt(ctx, {
          damage: 8,
          speed: 26,
          size: 0.1,
          spread: 0.22,
          gravityScale: 0.35,
          blastRadius: 1.4,
        });
      }
    },
  },
  rapid: {
    id: "rapid",
    name: "Arc Bolt",
    mana: 2,
    cooldown: 0.11,
    info: "7 dmg, rapid",
    cast: (ctx) => bolt(ctx, { damage: 7, speed: 42, size: 0.09, spread: 0.05 }),
  },
  lance: {
    id: "lance",
    name: "Void Lance",
    mana: 9,
    cooldown: 0.7,
    info: "34 dmg + blast",
    cast: (ctx) =>
      bolt(ctx, {
        damage: 34,
        speed: 52,
        size: 0.19,
        blastRadius: 2.4,
        blastImpulse: 18,
      }),
  },
  blast: {
    id: "blast",
    name: "Force Blast",
    mana: 18,
    cooldown: 0.95,
    info: "24 dmg, knockback",
    cast: (ctx) => {
      tmp.copy(ctx.dir).multiplyScalar(1.5).add(ctx.origin);
      explode({
        position: tmp,
        radius: 3.8,
        damage: 24 * ctx.stats.damageMult,
        impulse: 30,
        team: "player",
        color: ctx.staff.color,
        particles: 40,
        light: 42,
        remote: ctx.remote,
      });
      // Recoil: aim at the floor to blast-jump. Caster only — a peer's blast
      // still pushes us via the explosion itself, not via recoil.
      if (!ctx.remote) {
        getPlayerBody()?.applyImpulse(
          { x: -ctx.dir.x * 4.2, y: Math.max(-ctx.dir.y * 5.5, 0.8), z: -ctx.dir.z * 4.2 },
          true,
        );
      }
    },
  },
  shockwave: {
    id: "shockwave",
    name: "Shockwave",
    mana: 14,
    cooldown: 1.15,
    info: "12 dmg, huge knockback",
    cast: (ctx) => {
      explode({
        position: ctx.origin,
        radius: 5.5,
        damage: 12 * ctx.stats.damageMult,
        impulse: 44,
        team: "player",
        color: ctx.staff.color,
        particles: 54,
        light: 48,
        remote: ctx.remote,
      });
    },
  },
};

export function getAbility(id: string): Ability {
  const ability = ABILITIES[id];
  if (!ability) throw new Error(`Unknown ability: ${id}`);
  return ability;
}
