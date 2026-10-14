import type { SpellDef } from "./spellCatalog";

/** How heavy a spell is — in the hand as it leaves the staff (the staff's
 * recoil, the eye's kick upward, the view punching in, the screen's shake)
 * and on the body it lands on (how hard the hit confirms, whether the frame
 * catches). A rail should feel like a cannon and a bolt like a flick.
 *
 * Read off the catalog row's own numbers, so a new spell weighs what its
 * numbers say. BASE damage, before gear: weight is the spell's character,
 * and a deep wizard's bolt is still a flick. Pure. */

/** Spells that tick faster than this are held streams (beam, flame, arc
 * bolt): every tick is a cast, so each one weighs next to nothing. */
export const STREAM_COOLDOWN = 0.15;
/** A cooldown at least this long is a heavy spell: the staff gathers light
 * as it comes ready, and chimes when it is. */
export const READY_COOLDOWN = 0.6;

export function isStream(def: Readonly<SpellDef>): boolean {
  return def.cooldown < STREAM_COOLDOWN;
}

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/** How heavy one hit of `def` is, 0…1, from the damage it was cast with at
 * base (before gear): a stream's tick 0.1, a bolt ≈ 0.4, a lance ≈ 0.85, a
 * rail 1. Anything that isn't a spell (a proc, a burning barrel) passes its
 * own base damage. */
export function hitWeight(baseDamage: number, stream = false): number {
  if (stream) return 0.1;
  return Math.max(0.15, clamp01(baseDamage / 40));
}

/** A spell's hit weight (one bolt of a volley, one tick of a beam). */
export function spellHitWeight(def: Readonly<SpellDef>): number {
  if (def.kind === "collapse") return 0.6;
  return hitWeight(def.damage, isStream(def));
}

/** How heavy the whole cast is in the hand, 0…1: the volley's damage, the
 * shove it carries and the ground it covers. */
export function castWeight(def: Readonly<SpellDef>): number {
  if (isStream(def)) return 0.08;
  let raw: number;
  switch (def.kind) {
    case "bolt":
      raw = def.damage * def.count + def.blastImpulse * 0.3 + Math.max(0, def.blastRadius - 1.7) * 6;
      break;
    case "blast":
    case "shockwave":
      raw = def.damage + def.impulse * 0.3 + def.radius * 3;
      break;
    case "ray":
      raw = def.damage + def.impulse * 0.3;
      break;
    case "chain":
      raw = def.damage * (1 + def.jumps * def.falloff * 0.3) + def.impulse * 0.3;
      break;
    case "cone":
      raw = def.damage + def.impulse * 0.3;
      break;
    case "seed":
      // Planting: the weight comes later, when it collapses.
      raw = 10;
      break;
    case "collapse":
      raw = 33;
      break;
  }
  return clamp01(raw / 60);
}

/** What a cast does to the caster's view. */
export interface CastFeel {
  /** The staff's recoil (`staffKick`), 0…1. */
  kick: number;
  /** The eye kicks up this many degrees and springs back. */
  pitch: number;
  /** …and aside up to this many (the caller picks the side). */
  yaw: number;
  /** The view punches in by this share of its field (0.04 = 4%). */
  fov: number;
  /** Screen shake (the `shake` event), 0…1. */
  shake: number;
  /** The staff crystal's flare, 0…1. */
  flare: number;
  /** A heavy spell: its cooldown gathers light and chimes when ready. */
  heavy: boolean;
}

/** The feel of casting `def`. Writes into `out` (pass a scratch object). */
export function castFeel(def: Readonly<SpellDef>, out: CastFeel): CastFeel {
  const w = castWeight(def);
  const stream = isStream(def);
  out.kick = stream ? 0.25 : 0.45 + 0.55 * w;
  out.pitch = stream ? 0.05 : 0.15 + 1.45 * w ** 1.5;
  out.yaw = out.pitch * 0.3;
  out.fov = w > 0.6 ? 0.045 * ((w - 0.6) / 0.4) : 0;
  out.shake = stream ? 0 : 0.03 + 0.22 * w * w;
  out.flare = stream ? 0.5 : 0.6 + 0.4 * w;
  out.heavy = def.cooldown >= READY_COOLDOWN;
  return out;
}

export function newCastFeel(): CastFeel {
  return { kick: 0, pitch: 0, yaw: 0, fov: 0, shake: 0, flare: 0, heavy: false };
}
