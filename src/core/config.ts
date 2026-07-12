/** Global tuning constants. Keep gameplay feel numbers here so they are easy to iterate on. */

export const TILE = 2; // world units per dungeon tile
// Ceiling height (walls span 0..WALL_HEIGHT; the ceiling collider sits on top).
// Sized so a perfectly-timed double jump clears it: a grounded capsule head
// sits at halfHeight+radius, and a full jump (1.77) chained into a second at
// apex (1.50) lifts it to ~5.07 world units — 6 leaves comfortable headroom.
export const WALL_HEIGHT = 6;
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
  checkpointInterval: 5,
  baseSize: 36,
  sizePerFloor: 1.5,
  maxSize: 64,
  maxPlayersPerFloor: 4,
} as const;

/** Rapier collision group indices (see interactionGroups). */
export const GROUPS = {
  WORLD: 0,
  PLAYER: 1,
  ENEMY: 2,
  FRIENDLY_PROJECTILE: 3,
  ENEMY_PROJECTILE: 4,
  PROP: 5,
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
