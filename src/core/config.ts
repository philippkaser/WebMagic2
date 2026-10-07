/** Global tuning constants. Keep gameplay feel numbers here so they are easy to iterate on. */

export const TILE = 2; // world units per dungeon tile
/** Floor-to-ceiling height of the dungeon: 6 m, half again the classic
 * 4 m, so a room reads as a hall and the light shafts have a drop to fall
 * through — but low enough that the painted walls (moss curtains from the
 * vault, tide lines and grime at the foot, one texture per face) stay in
 * view. Wall textures are painted WALL_HEIGHT × 32 px tall, so changing this
 * keeps texels square (render/textures/surfaces/types.ts). */
export const WALL_HEIGHT = 6;
export const EYE_HEIGHT = 0.7; // camera offset above player body center

/** The generator's architecture plan (world/gen/architecture.ts). Only the
 * light shafts render for now — the dungeon is kept to its basic look —
 * but the planned arcades (ribs on wall piers, pillar pairs) are still laid
 * out on their own seed stream, with these proportions, for later. */
export const ARCHITECTURE = {
  /** Transverse arch ribs: spacing along a room. */
  ribSpacing: 4,
  /** Free-standing pillars: half-size of the base block. */
  pillarBase: 0.52,
  /** Engaged piers under each rib end: width along the wall. */
  pierWidth: 0.7,
} as const;

export const GRAVITY = -26;

export const PLAYER = {
  radius: 0.4,
  halfHeight: 0.5,
  speed: 8.2,
  groundAccel: 11, // exponential approach rate toward wish velocity
  airAccel: 34, // additive air control
  airSpeedCap: 9.5,
  jumpVelocity: 9.6,
  coyoteTime: 0.12,
  jumpBuffer: 0.14,
  hoverFallSpeed: -1.4,
  dashSpeed: 19,
  dashCooldown: 1.4,
  maxHealth: 100,
  maxMana: 100,
  manaRegen: 9,
  contactDamageCooldown: 0.7,
} as const;

export const DUNGEON = {
  maxFloor: 100,
  baseSize: 36,
  sizePerFloor: 1.5,
  maxSize: 64,
  maxPlayersPerFloor: 4,
} as const;

/** How often the deep lets wizards meet (net/matchmaking.ts). Entering a
 * floor rolls an encounter: success joins another wizard's instance of that
 * same floor, failure opens a private one. Every floor walked alone raises
 * the odds — a "tension clock" — so meetings stay rare but never impossible,
 * and a long quiet stretch makes the next floor feel loaded. */
export const ENCOUNTERS = {
  /** Encounter chance on the first floor after a meeting (or of a run). */
  baseChance: 0.12,
  /** Added per consecutive floor entered alone. */
  perSoloFloor: 0.12,
  /** Ceiling — the deep never guarantees company. */
  maxChance: 0.6,
} as const;

/** Rapier collision group indices (see interactionGroups).
 *
 * Wizard-vs-wizard combat needs three extra bits, because a spell must be able
 * to hit "that particular other wizard" without hitting its own caster:
 *  - LOCAL_PLAYER: set only on this client's own capsule (alongside PLAYER).
 *  - PEER_HOSTILE: set on a peer's collision capsule while they're hostile —
 *    our own bolts filter on it, so they burst on enemies of ours only.
 *  - HOSTILE_SPELL: a hostile peer's replayed bolt; collides with LOCAL_PLAYER
 *    (us) but never with peer capsules (so it can't burst on its caster). */
export const GROUPS = {
  WORLD: 0,
  PLAYER: 1,
  ENEMY: 2,
  FRIENDLY_PROJECTILE: 3,
  ENEMY_PROJECTILE: 4,
  PROP: 5,
  LOCAL_PLAYER: 6,
  PEER_HOSTILE: 7,
  HOSTILE_SPELL: 8,
} as const;

/** Wizard-vs-wizard tuning, scaled down so a duel is a fight, not a
 * one-shot. Applied by the victim's machine on a floor a wizard hosts, by
 * the server's copy of the cast on one the server hosts (sim/floorSim.ts). */
export const PVP = {
  damageMult: 0.55,
  /** A hostile hit within this window names the killer on death. */
  killCreditSeconds: 12,
} as const;

/** Difficulty scaling per floor. */
export function floorScale(floor: number) {
  return {
    enemyHealth: 1 + (floor - 1) * 0.18,
    enemyDamage: 1 + (floor - 1) * 0.12,
    // Deliberately lean — rooms should feel tense, not swarmed, and slimes add
    // bodies by splitting. Ramps gently and caps lower than the old 26.
    enemyCount: Math.min(3 + Math.floor(floor * 0.7), 14),
  };
}
