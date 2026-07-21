import { Vector3 } from "three";
import { playBeam, playLob } from "../audio/sound";
import { getPlayerBody } from "../game/player-state";
import type { DerivedStats, ItemDef } from "../items/types";
import { fireBeam } from "./beam";
import { activateSingularities } from "./blackhole";
import { explode } from "./damage";
import { fireProjectile } from "./projectiles";
import { conjureSword } from "./sword";

/** Staff abilities. Staffs reference these by id, so new staffs are pure data. */

export interface AbilityContext {
  origin: Vector3;
  dir: Vector3;
  stats: DerivedStats;
  staff: ItemDef;
  /** Charge fraction 0..1 for abilities with `charge` (1 when absent). */
  power?: number;
  /** True when replaying a floor-mate's cast — skip caster-only effects. */
  remote?: boolean;
}

export interface Ability {
  id: string;
  name: string;
  mana: number;
  cooldown: number;
  /** Hold-to-charge: the button is held to build power and casts on release.
   * `max` is seconds to full charge; the cast receives ctx.power 0..1. */
  charge?: { max: number };
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
  /** Base bolts this cast fires (scatter fires 5); the +extraProjectiles
   * multishot bonus is added on top. */
  count?: number;
  spread?: number;
  gravityScale?: number;
  blastRadius?: number;
  blastImpulse?: number;
}) {
  const spread = opts.spread ?? 0.012;
  const homing = ctx.stats.homing ?? 0;
  const extra = Math.max(0, Math.round(ctx.stats.extraProjectiles ?? 0));
  const total = (opts.count ?? 1) + extra;
  // A little extra scatter when multishot widens the volley, so stacked bolts
  // don't fly as one indistinguishable line.
  const spreadFor = total > 1 ? Math.max(spread, 0.06) : spread;
  for (let i = 0; i < total; i++) {
    tmp
      .copy(ctx.dir)
      .add(
        new Vector3(
          (Math.random() - 0.5) * spreadFor,
          (Math.random() - 0.5) * spreadFor,
          (Math.random() - 0.5) * spreadFor,
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
      homing,
      split: ctx.stats.split,
      bounces: ctx.stats.bounces,
      // A peer's replayed bolt is visual: their own client requests the damage.
      cosmetic: ctx.remote ?? false,
    });
  }
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
    cast: (ctx) =>
      bolt(ctx, {
        damage: 8,
        speed: 26,
        size: 0.1,
        count: 5,
        spread: 0.22,
        gravityScale: 0.35,
        blastRadius: 1.4,
      }),
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
        particles: 30,
        light: 36,
        style: "arcane",
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
  voidseed: {
    id: "voidseed",
    name: "Void Seed",
    mana: 10,
    cooldown: 0.5,
    info: "plant · Collapse to detonate",
    cast: (ctx) => {
      const extra = Math.max(0, Math.round(ctx.stats.extraProjectiles ?? 0));
      for (let i = 0; i <= extra; i++) {
        tmp
          .copy(ctx.dir)
          .add(
            new Vector3(
              (Math.random() - 0.5) * (extra > 0 ? 0.12 : 0),
              (Math.random() - 0.5) * (extra > 0 ? 0.12 : 0),
              (Math.random() - 0.5) * (extra > 0 ? 0.12 : 0),
            ),
          )
          .normalize()
          .multiplyScalar(18);
        fireProjectile({
          team: "player",
          position: [ctx.origin.x, ctx.origin.y, ctx.origin.z],
          velocity: [tmp.x, tmp.y, tmp.z],
          // The seed carries the black hole's implosion damage.
          damage: 30 * ctx.stats.damageMult,
          color: "#a06bff",
          size: 0.2,
          gravityScale: 0,
          homing: ctx.stats.homing,
          split: ctx.stats.split,
          bounces: ctx.stats.bounces,
          singularity: true,
          cosmetic: ctx.remote ?? false,
        });
      }
    },
  },
  collapse: {
    id: "collapse",
    name: "Collapse",
    mana: 12,
    cooldown: 0.8,
    info: "implode all seeds → black holes",
    cast: () => activateSingularities(),
  },
  sword: {
    id: "sword",
    name: "Phantom Blade",
    mana: 5,
    cooldown: 0.42,
    info: "26 dmg arc",
    cast: (ctx) =>
      conjureSword({
        kind: "slash",
        origin: [ctx.origin.x, ctx.origin.y, ctx.origin.z],
        dir: [ctx.dir.x, ctx.dir.y, ctx.dir.z],
        damage: 26 * ctx.stats.damageMult,
        impulse: 14,
        color: ctx.staff.color,
        cosmetic: ctx.remote,
      }),
  },
  cleave: {
    id: "cleave",
    name: "Spectral Cleave",
    mana: 13,
    cooldown: 1.05,
    info: "40 dmg + slam",
    cast: (ctx) =>
      conjureSword({
        kind: "cleave",
        origin: [ctx.origin.x, ctx.origin.y, ctx.origin.z],
        dir: [ctx.dir.x, ctx.dir.y, ctx.dir.z],
        damage: 40 * ctx.stats.damageMult,
        impulse: 22,
        color: ctx.staff.color,
        cosmetic: ctx.remote,
      }),
  },
  laser: {
    id: "laser",
    name: "Piercing Ray",
    mana: 16,
    cooldown: 0.8,
    charge: { max: 1.1 },
    info: "18–76 dmg beam, hold to charge",
    cast: (ctx) => {
      const power = ctx.power ?? 1;
      // Multishot fans extra beams around the aim.
      const extra = Math.max(0, Math.round(ctx.stats.extraProjectiles ?? 0));
      tmp.crossVectors(ctx.dir, new Vector3(0, 1, 0));
      // Aiming straight up/down leaves no horizontal "right" — pick any.
      const right = tmp.lengthSq() < 1e-4 ? tmp.set(1, 0, 0) : tmp.normalize();
      for (let i = 0; i <= extra; i++) {
        const off = extra > 0 ? (i - extra / 2) * 0.07 : 0;
        const d = new Vector3()
          .copy(ctx.dir)
          .addScaledVector(right, off)
          .normalize();
        fireBeam({
          origin: [ctx.origin.x, ctx.origin.y, ctx.origin.z],
          dir: [d.x, d.y, d.z],
          // 18–76 at full charge: ×1.3 fury stays under the networked
          // hit-sanitizer ceiling (100), so online play never clamps it.
          damage: (18 + 58 * power) * ctx.stats.damageMult,
          power,
          bounces: ctx.stats.bounces,
          split: ctx.stats.split,
          color: ctx.staff.color,
          cosmetic: ctx.remote,
        });
      }
      playBeam(power);
      // A full-charge shot kicks like a cannon.
      if (!ctx.remote) {
        const kick = 1.5 + power * 5;
        getPlayerBody()?.applyImpulse(
          { x: -ctx.dir.x * kick, y: Math.max(-ctx.dir.y * kick * 0.5, 0), z: -ctx.dir.z * kick },
          true,
        );
      }
    },
  },
  grenade: {
    id: "grenade",
    name: "Grenade Lob",
    mana: 12,
    cooldown: 0.9,
    info: "38 dmg blast, bounces",
    cast: (ctx) => {
      const extra = Math.max(0, Math.round(ctx.stats.extraProjectiles ?? 0));
      for (let i = 0; i <= extra; i++) {
        // Lobbed: forward pace plus an upward hoist so it arcs like a mortar.
        tmp
          .copy(ctx.dir)
          .add(
            new Vector3(
              (Math.random() - 0.5) * (extra > 0 ? 0.14 : 0.02),
              0,
              (Math.random() - 0.5) * (extra > 0 ? 0.14 : 0.02),
            ),
          )
          .normalize()
          .multiplyScalar(16.5);
        fireProjectile({
          team: "player",
          position: [ctx.origin.x, ctx.origin.y, ctx.origin.z],
          velocity: [tmp.x, tmp.y + 4.2, tmp.z],
          damage: 38 * ctx.stats.damageMult,
          color: ctx.staff.color,
          size: 0.22,
          gravityScale: 1.35,
          blastRadius: 3.7,
          blastImpulse: 34,
          homing: ctx.stats.homing,
          bounces: 1 + ctx.stats.bounces,
          split: ctx.stats.split,
          fuse: 1.15,
          cosmetic: ctx.remote ?? false,
        });
      }
      playLob();
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
        particles: 38,
        light: 40,
        style: "arcane",
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
