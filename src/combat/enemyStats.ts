/** The enemy roster as pure data — the single table where every enemy kind
 * and its comparable numbers live, mirroring items/catalog.ts. Component logic
 * (Wisp/Sentry/Boss) reads its baseHealth from here so the tuning isn't a
 * magic number buried in three files; the render/mount layer lives in
 * enemyRegistry.tsx (which imports the components and would cycle if it lived
 * here). Keep this module free of React/component imports for that reason.
 *
 * Deliberately NOT a behaviour framework: with three enemies, movement and
 * attacks stay as code in each component. When a fourth enemy makes the shared
 * shape obvious, factor the common shell out then — informed by real cases,
 * not guessed from two. */

export type EnemyId = "wisp" | "sentry" | "shadow" | "boss";

export interface EnemyStats {
  id: EnemyId;
  name: string;
  /** One-line role summary for at-a-glance comparison (dev room, docs). */
  desc: string;
  /** Health at floor 1; scaled by floorScale(floor).enemyHealth at spawn. */
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
