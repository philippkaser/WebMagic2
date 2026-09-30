import { Vector3 } from "three";
import { getPlayerBody } from "../game/player-state";
import type { DerivedStats, ItemDef } from "../items/types";
import { explode } from "./damage";
import { fireProjectile, type FireOptions } from "./projectiles";

/** Staff abilities — the weapon system. Staffs reference these by id, so new
 * staffs are pure data; a new spell is one entry in ABILITIES built from the
 * two primitives: physical projectiles and radial explosions. */

export interface AbilityContext {
  origin: Vector3;
  dir: Vector3;
  stats: DerivedStats;
  staff: ItemDef;
  /** Set when replaying a floor-mate's cast: skip caster-only effects, and
   * the spell is cosmetic here (their client applies its damage). */
  casterId?: string;
}

export interface Ability {
  id: string;
  name: string;
  mana: number;
  cooldown: number;
  cast(ctx: AbilityContext): void;
}

const tmp = new Vector3();
const jitter = new Vector3();

type BoltOptions = Pick<FireOptions, "blastRadius" | "blastImpulse" | "bounces" | "gravityScale"> & {
  damage: number;
  speed: number;
  size: number;
  spread?: number;
  /** Extra upward launch angle (lobbed spells). */
  lift?: number;
};

function bolt(ctx: AbilityContext, opts: BoltOptions) {
  const spread = opts.spread ?? 0.012;
  jitter.set((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread);
  tmp.copy(ctx.dir).add(jitter);
  tmp.y += opts.lift ?? 0;
  tmp.normalize().multiplyScalar(opts.speed);
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
    bounces: opts.bounces,
    ownerId: ctx.casterId,
  });
}

/** Caster recoil — only ever applied on the caster's own client. */
function recoil(ctx: AbilityContext, horizontal: number, vertical: number) {
  if (ctx.casterId) return;
  getPlayerBody()?.applyImpulse(
    { x: -ctx.dir.x * horizontal, y: Math.max(-ctx.dir.y * vertical, 0.8), z: -ctx.dir.z * horizontal },
    true,
  );
}

const ABILITIES: Record<string, Ability> = {
  bolt: {
    id: "bolt",
    name: "Bolt",
    mana: 3,
    cooldown: 0.26,
    cast: (ctx) => bolt(ctx, { damage: 16, speed: 34, size: 0.13 }),
  },
  scatter: {
    id: "scatter",
    name: "Ember Scatter",
    mana: 7,
    cooldown: 0.55,
    cast: (ctx) => {
      for (let i = 0; i < 5; i++) {
        bolt(ctx, { damage: 8, speed: 26, size: 0.1, spread: 0.22, gravityScale: 0.35, blastRadius: 1.4 });
      }
    },
  },
  rapid: {
    id: "rapid",
    name: "Arc Bolt",
    mana: 2,
    cooldown: 0.11,
    cast: (ctx) => bolt(ctx, { damage: 7, speed: 42, size: 0.09, spread: 0.05 }),
  },
  lance: {
    id: "lance",
    name: "Void Lance",
    mana: 9,
    cooldown: 0.7,
    cast: (ctx) => bolt(ctx, { damage: 34, speed: 52, size: 0.19, blastRadius: 2.4, blastImpulse: 18 }),
  },
  ricochet: {
    id: "ricochet",
    name: "Ricochet",
    mana: 5,
    cooldown: 0.4,
    // Bounces off walls up to three times before it bursts — bank shots
    // around corners.
    cast: (ctx) => bolt(ctx, { damage: 14, speed: 30, size: 0.14, bounces: 3, gravityScale: 0.15, blastRadius: 1.9 }),
  },
  blast: {
    id: "blast",
    name: "Force Blast",
    mana: 18,
    cooldown: 0.95,
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
        remote: !!ctx.casterId,
      });
      // Aim at the floor to blast-jump.
      recoil(ctx, 4.2, 5.5);
    },
  },
  shockwave: {
    id: "shockwave",
    name: "Shockwave",
    mana: 14,
    cooldown: 1.15,
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
        remote: !!ctx.casterId,
      });
    },
  },
  gravity: {
    id: "gravity",
    name: "Gravity Well",
    mana: 20,
    cooldown: 1.6,
    // An implosion a few meters ahead: yanks enemies, crates, barrels — and
    // other wizards — into a pile. Then the pile pops.
    cast: (ctx) => {
      const at = ctx.dir.clone().multiplyScalar(5).add(ctx.origin);
      const common = { team: "player" as const, color: ctx.staff.color, remote: !!ctx.casterId };
      explode({ ...common, position: at, radius: 6.5, damage: 6 * ctx.stats.damageMult, impulse: -26, particles: 50, light: 36 });
      setTimeout(
        () => explode({ ...common, position: at, radius: 2.6, damage: 22 * ctx.stats.damageMult, impulse: 22, particles: 36, light: 40 }),
        420,
      );
    },
  },
  meteor: {
    id: "meteor",
    name: "Meteor",
    mana: 26,
    cooldown: 1.8,
    cast: (ctx) =>
      bolt(ctx, {
        damage: 48,
        speed: 22,
        size: 0.32,
        lift: 0.3,
        gravityScale: 1,
        blastRadius: 4.6,
        blastImpulse: 42,
      }),
  },
};

export function getAbility(id: string): Ability {
  const ability = ABILITIES[id];
  if (!ability) throw new Error(`Unknown ability: ${id}`);
  return ability;
}
