import type { ReactNode } from "react";
import type { Vec3 } from "../world/types";
import { Boss } from "./Boss";
import { Sentry, Shadow, Wisp } from "./enemies";
import { ENEMY_STATS, getEnemyStats, type EnemyId, type EnemyStats } from "./enemyStats";

/** The mount layer over the enemy roster: pairs each data entry in
 * enemyStats.ts with how to render an instance. Both the dungeon floor and the
 * dev-room spawner go through this, so adding an enemy is (1) a row in
 * ENEMY_STATS and (2) a renderer here — no bespoke switch statements anywhere
 * downstream. Behaviour/tuning stay in the components and the stats table; this
 * file is identity + JSX only. */

export type { EnemyId, EnemyStats };
export { ENEMY_STATS, getEnemyStats };

export interface EnemySpawnProps {
  entityId: string;
  pos: Vec3;
  floor: number;
  /** Fired when the instance dies/despawns. Singletons (the boss) use it so
   * their owner can drop them from its list; regular enemies ignore it. */
  onDeath: () => void;
}

type RenderFn = (props: EnemySpawnProps) => ReactNode;

const RENDERERS: Record<EnemyId, RenderFn> = {
  wisp: ({ entityId, pos, floor }) => <Wisp entityId={entityId} position={pos} floor={floor} />,
  sentry: ({ entityId, pos, floor }) => (
    <Sentry entityId={entityId} position={pos} floor={floor} />
  ),
  shadow: ({ entityId, pos, floor }) => (
    <Shadow entityId={entityId} position={pos} floor={floor} />
  ),
  boss: ({ pos, floor, onDeath }) => <Boss position={pos} floor={floor} onDeath={onDeath} />,
};

export interface EnemyDef extends EnemyStats {
  render: RenderFn;
}

export const ENEMY_DEFS: EnemyDef[] = ENEMY_STATS.map((stats) => ({
  ...stats,
  render: RENDERERS[stats.id],
}));

const byId = new Map(ENEMY_DEFS.map((d) => [d.id, d]));

export function getEnemyDef(id: EnemyId): EnemyDef {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown enemy id: ${id}`);
  return def;
}
