/** Global tuning constants. Keep gameplay feel numbers here so they are easy to iterate on. */

export const TILE = 2; // world units per dungeon tile
export const WALL_HEIGHT = 4;
export const EYE_HEIGHT = 0.7; // camera offset above player body center

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
} as const;

/** Run structure: the extraction rule and how gear maps to depth. */
export const RUN = {
  /** Floors a run must survive before a homeward rift opens (on the Nth). */
  floorsToExtract: 5,
  /** Entry floor ≈ gear level × this. Items drop at ≈ the floor's level, so
   * 1.0 means "the rift sends you where your gear came from". */
  floorPerGearLevel: 1,
} as const;

/** Wizard encounters. Meeting another wizard should be rare enough to be an
 * event and common enough that every presence on the floor is a threat. */
export const ENCOUNTER = {
  /** Chance that entering a floor drops you into an instance someone is
   * already exploring (if one on that floor has room). */
  joinChance: 0.3,
  /** Hard cap of wizards per floor instance. */
  maxPerInstance: 3,
  /** Pact partners are always placed together while there's room. */
  pactsTravelTogether: true,
  /** Unclaimed death chests of a floor linger for new instances of it. */
  remainsTtlMs: 45 * 60 * 1000,
  maxRemainsPerFloor: 4,
} as const;

/** Rapier collision group indices (see interactionGroups). */
export const GROUPS = {
  WORLD: 0,
  PLAYER: 1,
  ENEMY: 2,
  FRIENDLY_PROJECTILE: 3,
  ENEMY_PROJECTILE: 4,
  PROP: 5,
  /** Other wizards (kinematic proxies on this client). */
  PEER: 6,
  /** Floor-mates' spells replayed here: cosmetic, but they splash on us. */
  PEER_PROJECTILE: 7,
} as const;

/** Difficulty scaling per floor. */
export function floorScale(floor: number) {
  return {
    enemyHealth: 1 + (floor - 1) * 0.18,
    enemyDamage: 1 + (floor - 1) * 0.12,
    enemyCount: Math.min(4 + Math.floor(floor * 1.4), 26),
  };
}
