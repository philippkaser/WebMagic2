import type RAPIER from "@dimforge/rapier3d-compat";
import { GROUPS } from "../core/config";
import { Rng } from "../core/rng";
import type { Vec } from "../enemies/brains/common";
import { getSpellDef, type BoltSpell, type SpellDef } from "../weapons/spellCatalog";
import { interactionGroups } from "./bodies";
import type { Rapier } from "./floorPhysics";

/** Player spells, as the floor's authority runs them.
 *
 * The browser casts every spell for real on its caster's machine and as a
 * cosmetic replay everywhere else (weapons/castKinds.ts). On a floor the
 * SERVER hosts, the server runs its own copy of each cast — this module —
 * and its copy alone deals the damage: a wizard's client can only say "I
 * cast this, from here, that way", never "I hit that for this much".
 *
 * The numbers are the spell catalog's (weapons/spellCatalog.ts), and the
 * shared behaviour lives here once — a volley's spread (seeded, so the
 * caster, its replays and the server fire the same bolts), homing, the
 * void seed's drag and the black hole — so the browser and the server
 * can't disagree about what a spell does. Pure TypeScript over Rapier. */

// ── Shared numbers ───────────────────────────────────────────────────────────

/** A bolt that hits nothing pops after this long. */
export const BOLT_LIFETIME_S = 3.2;
/** When multishot widens a volley, spread it at least this much so stacked
 * bolts don't fly as one indistinguishable line. */
export const MULTISHOT_MIN_SPREAD = 0.06;
/** Homing bolts curve toward enemies within this range, roughly ahead. */
export const HOMING = { range: 16, minAhead: 0.15, turnRate: 6 } as const;
/** A void seed drags to a stop (linear damping) and fizzles if never
 * collapsed. */
export const SEED = { linearDamping: 2.4, lifetime: 6 } as const;
/** A collapsed seed's black hole: it tugs enemies (a little damage — the
 * hit also stalls their AI so the pull sticks) and props inward for
 * `duration`, then implodes. */
export const BLACK_HOLE = {
  radius: 4.5,
  duration: 1.3,
  pull: 11,
  tugEvery: 0.1,
  tugDamage: 1.5,
  tugLift: 1,
  /** Props are pulled as bodies on a browser host (every frame, ×dt×3);
   * one tug's worth of that. */
  propPull: 0.3,
  implodeImpulse: 15,
} as const;

/** The gear stats that shape a cast (net: weapons/castMessage.ts CastStats). */
export interface SpellStats {
  damageMult: number;
  extraProjectiles: number;
  homing: number;
}

/** Unit directions of a bolt volley: `count` + multishot bolts, each jittered
 * per axis by the spell's spread — from `seed`, so every machine that fires
 * this cast fires the same volley. */
export function boltVolley(def: Readonly<BoltSpell>, dir: Vec, extra: number, seed: number): Vec[] {
  const rng = new Rng(seed);
  const total = def.count + Math.max(0, Math.round(extra));
  const spread = total > 1 ? Math.max(def.spread, MULTISHOT_MIN_SPREAD) : def.spread;
  const out: Vec[] = [];
  for (let i = 0; i < total; i++) {
    const x = dir.x + (rng.next() - 0.5) * spread;
    const y = dir.y + (rng.next() - 0.5) * spread;
    const z = dir.z + (rng.next() - 0.5) * spread;
    const len = Math.hypot(x, y, z) || 1;
    out.push({ x: x / len, y: y / len, z: z / len });
  }
  return out;
}

/** Curve a homing bolt's velocity `vel` (in place) toward `target` — only if
 * it lies roughly ahead (no U-turns), keeping its speed. */
export function steerHoming(pos: Vec, vel: Vec, target: Vec, homing: number, dt: number): void {
  const speed = Math.hypot(vel.x, vel.y, vel.z);
  if (speed <= 0.1) return;
  const tx = target.x - pos.x;
  const ty = target.y - pos.y;
  const tz = target.z - pos.z;
  const td = Math.hypot(tx, ty, tz) || 1;
  if ((vel.x * tx + vel.y * ty + vel.z * tz) / (speed * td) <= HOMING.minAhead) return;
  const turn = Math.min(1, homing * dt * HOMING.turnRate);
  const nx = vel.x / speed + (tx / td - vel.x / speed) * turn;
  const ny = vel.y / speed + (ty / td - vel.y / speed) * turn;
  const nz = vel.z / speed + (tz / td - vel.z / speed) * turn;
  const nl = Math.hypot(nx, ny, nz) || 1;
  vel.x = (nx / nl) * speed;
  vel.y = (ny / nl) * speed;
  vel.z = (nz / nl) * speed;
}

// ── The authority's copy ─────────────────────────────────────────────────────

/** What the spells need from the floor they're cast on (sim/floorSim.ts). */
export interface SpellWorld {
  readonly R: Rapier;
  readonly world: RAPIER.World;
  /** World gravity (m/s², the floor's omen included). */
  readonly gravity: number;
  /** The nearest living enemy to `pos` within `range` (homing), or null. */
  nearestEnemy(pos: Vec, range: number): Vec | null;
  /** Every living enemy and standing prop: id, where, which. */
  forEachTarget(fn: (id: string, at: Vec, enemy: boolean) => void): void;
  /** Damage and a shove land on an enemy or prop. */
  strike(id: string, damage: number, impulse: Vec): void;
  /** A player-team explosion: hurts enemies and props, by the shared falloff. */
  explode(at: Vec, radius: number, damage: number, impulse: number): void;
}

/** A cast as the authority accepted it (net-validated and sanitized). */
export interface Cast {
  abilityId: string;
  origin: Vec;
  /** Unit aim. */
  dir: Vec;
  /** The volley's spread seed. */
  seed: number;
}

interface Projectile {
  caster: string;
  pos: Vec;
  vel: Vec;
  size: number;
  gravityScale: number;
  damage: number;
  blastRadius: number;
  blastImpulse: number;
  homing: number;
  age: number;
  /** A void seed (plants and waits for its caster's Collapse). */
  seed: boolean;
  planted: boolean;
}

interface Hole {
  pos: Vec;
  damage: number;
  age: number;
  tug: number;
}

/** Player projectiles fly into walls, enemies and props — never wizards. */
const PROJECTILE_FILTER = interactionGroups(GROUPS.FRIENDLY_PROJECTILE, [GROUPS.WORLD, GROUPS.ENEMY, GROUPS.PROP]);

export class PlayerSpells {
  private projectiles: Projectile[] = [];
  private holes: Hole[] = [];
  private readonly shapes = new Map<number, RAPIER.Ball>();
  private readonly noRotation = { x: 0, y: 0, z: 0, w: 1 };

  constructor(private readonly w: SpellWorld) {}

  /** In flight and waiting (tests, counts). */
  get live(): { projectiles: number; holes: number } {
    return { projectiles: this.projectiles.length, holes: this.holes.length };
  }

  /** `caster` casts: what the spell does starts now. */
  cast(caster: string, c: Cast, stats: SpellStats): void {
    const def: Readonly<SpellDef> = getSpellDef(c.abilityId);
    switch (def.kind) {
      case "bolt":
        for (const d of boltVolley(def, c.dir, stats.extraProjectiles, c.seed)) {
          this.projectiles.push({
            caster,
            pos: { ...c.origin },
            vel: { x: d.x * def.speed, y: d.y * def.speed, z: d.z * def.speed },
            size: def.size,
            gravityScale: def.gravityScale,
            damage: def.damage * stats.damageMult,
            blastRadius: def.blastRadius,
            blastImpulse: def.blastImpulse,
            homing: stats.homing,
            age: 0,
            seed: false,
            planted: false,
          });
        }
        return;
      case "blast": {
        const at = { x: c.origin.x + c.dir.x * def.reach, y: c.origin.y + c.dir.y * def.reach, z: c.origin.z + c.dir.z * def.reach };
        this.w.explode(at, def.radius, def.damage * stats.damageMult, def.impulse);
        return;
      }
      case "shockwave":
        this.w.explode(c.origin, def.radius, def.damage * stats.damageMult, def.impulse);
        return;
      case "seed":
        this.projectiles.push({
          caster,
          pos: { ...c.origin },
          vel: { x: c.dir.x * def.speed, y: c.dir.y * def.speed, z: c.dir.z * def.speed },
          size: def.size,
          gravityScale: def.gravityScale,
          damage: def.damage * stats.damageMult,
          blastRadius: 0,
          blastImpulse: 0,
          homing: 0,
          age: 0,
          seed: true,
          planted: false,
        });
        return;
      case "collapse":
        // Every seed this caster has out becomes a black hole where it is.
        this.projectiles = this.projectiles.filter((p) => {
          if (!p.seed || p.caster !== caster) return true;
          this.holes.push({ pos: { ...p.pos }, damage: p.damage, age: 0, tug: 0 });
          return false;
        });
        return;
    }
  }

  step(dt: number): void {
    this.projectiles = this.projectiles.filter((p) => this.fly(p, dt));
    this.holes = this.holes.filter((h) => this.pull(h, dt));
  }

  /** One step of a projectile's flight; false once it's spent. */
  private fly(p: Projectile, dt: number): boolean {
    p.age += dt;
    if (p.seed) {
      if (p.age >= SEED.lifetime) return false; // never collapsed: fizzles
      if (p.planted) return true;
      const damp = 1 / (1 + dt * SEED.linearDamping);
      p.vel.x *= damp;
      p.vel.y *= damp;
      p.vel.z *= damp;
    } else if (p.age >= BOLT_LIFETIME_S) {
      this.pop(p);
      return false;
    }
    p.vel.y += this.w.gravity * p.gravityScale * dt;
    if (p.homing > 0) {
      const target = this.w.nearestEnemy(p.pos, HOMING.range);
      if (target) steerHoming(p.pos, p.vel, target, p.homing, dt);
    }
    // Sweep the ball along this step's travel: the first wall, enemy or prop
    // it touches stops it there (bolts pop, seeds plant).
    const hit = this.w.world.castShape(
      p.pos,
      this.noRotation,
      p.vel,
      this.ball(p.size),
      0,
      dt,
      true,
      undefined,
      PROJECTILE_FILTER,
    );
    const toi = hit ? hit.time_of_impact : dt;
    p.pos.x += p.vel.x * toi;
    p.pos.y += p.vel.y * toi;
    p.pos.z += p.vel.z * toi;
    if (!hit) return true;
    if (p.seed) {
      p.planted = true;
      p.vel.x = p.vel.y = p.vel.z = 0;
      return true;
    }
    this.pop(p);
    return false;
  }

  private pop(p: Projectile): void {
    this.w.explode(p.pos, p.blastRadius, p.damage, p.blastImpulse);
  }

  /** One step of a black hole; false once it has imploded. */
  private pull(h: Hole, dt: number): boolean {
    h.age += dt;
    h.tug -= dt;
    if (h.tug <= 0) {
      h.tug = BLACK_HOLE.tugEvery;
      const B = BLACK_HOLE;
      this.w.forEachTarget((id, at, enemy) => {
        const dx = h.pos.x - at.x;
        const dy = h.pos.y - at.y;
        const dz = h.pos.z - at.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > B.radius || dist < 0.2) return;
        const inv = (B.pull * (1 - dist / B.radius) * (enemy ? 1 : B.propPull)) / dist;
        this.w.strike(id, enemy ? B.tugDamage : 0, { x: dx * inv, y: dy * inv + (enemy ? B.tugLift : 0), z: dz * inv });
      });
    }
    if (h.age < BLACK_HOLE.duration) return true;
    this.w.explode(h.pos, BLACK_HOLE.radius, h.damage, BLACK_HOLE.implodeImpulse);
    return false;
  }

  private ball(radius: number): RAPIER.Ball {
    let shape = this.shapes.get(radius);
    if (!shape) {
      shape = new this.w.R.Ball(radius);
      this.shapes.set(radius, shape);
    }
    return shape;
  }
}
