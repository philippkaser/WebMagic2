import type { ComponentType } from "react";
import type { EnemyKind, Vec3 } from "../world/types";
import { Sentry } from "./Sentry";
import { Wisp } from "./Wisp";

export interface EnemyProps {
  position: Vec3;
  floor: number;
  /** Stable replication id derived from the layout ("e<index>"). */
  entityId: string;
}

/** Enemy kind → component. Adding an enemy: write the component (use
 * useEnemyNet for the host/replica plumbing), add its kind to EnemyKind,
 * register it here and give it a row in spawnTable. */
export const ENEMY_COMPONENTS: Record<EnemyKind, ComponentType<EnemyProps>> = {
  wisp: Wisp,
  sentry: Sentry,
};
