/** The enemy roster as pure data — the single table where every enemy kind
 * and its comparable numbers live, mirroring items/catalog.ts. Keep this
 * module free of React/component imports: the registry imports the
 * components, and they import this.
 *
 * An enemy is built in four layers; the brain and the model know nothing of
 * the others, so each can change (or be tested) alone:
 *
 *  1. roster (here)      — identity and comparable numbers (baseHealth,
 *                          singleton, spawn height).
 *  2. shell (useEnemy.ts) — what every enemy shares: health from this table ×
 *                          depth × floor rule, the dead latch, hit flash,
 *                          aggro and knockback, death burst + drops, contact
 *                          burns, and the replication/damage-routing wiring.
 *  3. brain (brains/*.ts) — pure AI: steering, state machines, aim and attack
 *                          choice over plain numbers, unit-tested headless.
 *  4. model (render/models/enemies.tsx) — presentational meshes, with refs
 *                          for whatever the behaviour animates.
 *
 * A kind component (kinds/*.tsx) is the thin join: shell + brain + model +
 * its collider. registry.tsx pairs each row below with its component. */

export type EnemyId = "wisp" | "sentry" | "shadow" | "slime" | "boss";

export interface EnemyStats {
  id: EnemyId;
  name: string;
  /** One-line role summary for at-a-glance comparison (dev room, docs). */
  desc: string;
  /** Health at floor 1; scaled at spawn by floorScale(floor).enemyHealth and
   * the floor's enemyHealthMult (see useEnemy). */
  baseHealth: number;
  /** Only one may be alive at once (the boss hardcodes its net id + HUD bar). */
  singleton: boolean;
  /** Preferred spawn height — sentries sit on the ground, fliers hover. */
  spawnY: number;
}

export const ENEMY_STATS: EnemyStats[] = [
  {
    id: "wisp",
    name: "Wisp",
    desc: "Floating chaser — burns on contact",
    baseHealth: 30,
    singleton: false,
    spawnY: 1.6,
  },
  {
    id: "sentry",
    name: "Sentry",
    desc: "Fixed turret — lobs dodgeable fire bolts on line of sight",
    baseHealth: 60,
    singleton: false,
    spawnY: 0,
  },
  {
    id: "shadow",
    name: "Shadow",
    desc: "Lurking stalker — circles at range, then lunges from the dark",
    baseHealth: 34,
    singleton: false,
    spawnY: 0.8,
  },
  {
    id: "slime",
    name: "Slime",
    desc: "Hopping blob — splits into two smaller, faster slimes when killed",
    baseHealth: 46,
    singleton: false,
    spawnY: 0.6,
  },
  {
    id: "boss",
    name: "Warden of the Deep",
    desc: "Boss — volley / ring / charge / slam phases; seals the exit",
    baseHealth: 420,
    singleton: true,
    spawnY: 1.8,
  },
];

const byId = new Map(ENEMY_STATS.map((s) => [s.id, s]));

export function getEnemyStats(id: EnemyId): EnemyStats {
  const stats = byId.get(id);
  if (!stats) throw new Error(`Unknown enemy id: ${id}`);
  return stats;
}
