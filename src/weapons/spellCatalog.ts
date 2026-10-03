/** The spell catalog as plain data. Staffs reference spells by id
 * (items/catalog.ts), so a new staff is pure data; a new spell of an existing
 * kind is one more row here. Each row's `kind` picks its cast implementation
 * (castKinds.ts) and its tooltip line (spellInfo, below) — the numbers live
 * in exactly one place, so the tooltip can't drift from what the spell does.
 *
 * Pure (no three.js, no physics): the table and spellInfo are unit-tested,
 * and ui/ can read it without pulling in the render stack.
 *
 * All damage values are BASE damage — the caster's damageMult scales them at
 * cast time; cooldowns are before fire-rate gear. */

interface SpellCommon {
  id: string;
  name: string;
  /** Mana spent per cast. */
  mana: number;
  /** Seconds between casts while the button is held. */
  cooldown: number;
}

/** A volley of physical bolts that pop on impact (Bolt, Scatter, Arc, Lance).
 * Multishot gear adds bolts on top of `count`. */
export interface BoltSpell extends SpellCommon {
  kind: "bolt";
  /** Per bolt, at the blast center. */
  damage: number;
  speed: number;
  /** Collider radius (and visual scale). */
  size: number;
  /** Bolts per cast before multishot gear. */
  count: number;
  /** Random aim jitter per axis (unit-direction units). */
  spread: number;
  gravityScale: number;
  /** Radius and peak impulse of each bolt's impact pop. */
  blastRadius: number;
  blastImpulse: number;
}

/** A forward explosion that kicks the caster back — aim at the floor to
 * blast-jump (Force Blast). */
export interface BlastSpell extends SpellCommon {
  kind: "blast";
  damage: number;
  radius: number;
  impulse: number;
  /** How far ahead of the staff tip the blast is centered. */
  reach: number;
  particles: number;
  light: number;
  /** Caster recoil opposite the aim: `back` horizontally, `up` vertically,
   * with at least `minLift` upward so a level shot still hops. */
  recoil: { back: number; up: number; minLift: number };
}

/** A ring of force centered on the caster (Shockwave). */
export interface ShockwaveSpell extends SpellCommon {
  kind: "shockwave";
  damage: number;
  radius: number;
  impulse: number;
  particles: number;
  light: number;
}

/** A slow void seed that plants where it lands and waits for a Collapse
 * (Void Seed). Carries the black hole's implosion damage. */
export interface SeedSpell extends SpellCommon {
  kind: "seed";
  /** Implosion damage of the black hole this seed becomes. */
  damage: number;
  speed: number;
  size: number;
  gravityScale: number;
  /** Seeds glow void-purple whatever staff threw them. */
  color: string;
}

/** Turns the caster's planted seeds into black holes (Collapse). */
export interface CollapseSpell extends SpellCommon {
  kind: "collapse";
}

export type SpellDef = BoltSpell | BlastSpell | ShockwaveSpell | SeedSpell | CollapseSpell;
export type SpellKind = SpellDef["kind"];

export const SPELLS: readonly Readonly<SpellDef>[] = [
  {
    kind: "bolt",
    id: "bolt",
    name: "Bolt",
    mana: 3,
    cooldown: 0.26,
    damage: 16,
    speed: 34,
    size: 0.13,
    count: 1,
    spread: 0.012,
    gravityScale: 0,
    blastRadius: 1.7,
    blastImpulse: 9,
  },
  {
    kind: "bolt",
    id: "scatter",
    name: "Ember Scatter",
    mana: 7,
    cooldown: 0.55,
    damage: 8,
    speed: 26,
    size: 0.1,
    count: 5,
    spread: 0.22,
    gravityScale: 0.35,
    blastRadius: 1.4,
    blastImpulse: 9,
  },
  {
    kind: "bolt",
    id: "rapid",
    name: "Arc Bolt",
    mana: 2,
    cooldown: 0.11,
    damage: 7,
    speed: 42,
    size: 0.09,
    count: 1,
    spread: 0.05,
    gravityScale: 0,
    blastRadius: 1.7,
    blastImpulse: 9,
  },
  {
    kind: "bolt",
    id: "lance",
    name: "Void Lance",
    mana: 9,
    cooldown: 0.7,
    damage: 34,
    speed: 52,
    size: 0.19,
    count: 1,
    spread: 0.012,
    gravityScale: 0,
    blastRadius: 2.4,
    blastImpulse: 18,
  },
  {
    kind: "blast",
    id: "blast",
    name: "Force Blast",
    mana: 18,
    cooldown: 0.95,
    damage: 24,
    radius: 3.8,
    impulse: 30,
    reach: 1.5,
    particles: 40,
    light: 42,
    recoil: { back: 4.2, up: 5.5, minLift: 0.8 },
  },
  {
    kind: "seed",
    id: "voidseed",
    name: "Void Seed",
    mana: 10,
    cooldown: 0.5,
    damage: 30,
    speed: 18,
    size: 0.2,
    gravityScale: 0,
    color: "#a06bff",
  },
  {
    kind: "collapse",
    id: "collapse",
    name: "Collapse",
    mana: 12,
    cooldown: 0.8,
  },
  {
    kind: "shockwave",
    id: "shockwave",
    name: "Shockwave",
    mana: 14,
    cooldown: 1.15,
    damage: 12,
    radius: 5.5,
    impulse: 44,
    particles: 54,
    light: 48,
  },
];

const byId = new Map(SPELLS.map((s) => [s.id, s]));

export function isSpellId(id: string): boolean {
  return byId.has(id);
}

export function getSpellDef(id: string): Readonly<SpellDef> {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown spell: ${id}`);
  return def;
}

// ── Tooltip lines, derived from the numbers above ────────────────────────────

/** A bolt pop at least this wide reads as a real area blast ("+ blast");
 * the standard bolt pop is 1.7. */
export const HEAVY_POP_RADIUS = 2;
/** Aim jitter at or above this is a deliberate cone ("spread"), not wobble. */
export const WIDE_SPREAD = 0.1;
/** Casting this often (≈7+/s held) reads as "rapid". */
export const RAPID_COOLDOWN = 0.15;
/** Explosion impulse at or above this is "huge knockback". */
export const HUGE_KNOCKBACK = 40;

/** One-line stat summary for inventory/tooltip display ("16 dmg"). */
export function spellInfo(def: Readonly<SpellDef>): string {
  switch (def.kind) {
    case "bolt": {
      let s = def.count > 1 ? `${def.count}×${def.damage} dmg` : `${def.damage} dmg`;
      if (def.blastRadius >= HEAVY_POP_RADIUS) s += " + blast";
      if (def.spread >= WIDE_SPREAD) s += ", spread";
      if (def.cooldown <= RAPID_COOLDOWN) s += ", rapid";
      return s;
    }
    case "blast":
    case "shockwave":
      return `${def.damage} dmg, ${def.impulse >= HUGE_KNOCKBACK ? "huge knockback" : "knockback"}`;
    case "seed":
      return `${def.damage} dmg, plant · Collapse to detonate`;
    case "collapse":
      return "implode your seeds → black holes";
    default: {
      const unknown: never = def;
      throw new Error(`Unhandled spell kind: ${(unknown as SpellDef).kind}`);
    }
  }
}
