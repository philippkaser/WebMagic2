import type { ComponentType } from "react";
import type { EnemyKind } from "../world/types";
import { Drowned } from "./Drowned";
import { Golem } from "./Golem";
import { Imp } from "./Imp";
import { Mimic } from "./Mimic";
import { Sentry } from "./Sentry";
import { Shade } from "./Shade";
import type { EnemyProps } from "./shared";
import { Skitter } from "./Skitter";
import { Wisp } from "./Wisp";

export type { EnemyProps } from "./shared";

/** Enemy kind → component. Adding an enemy: write the component (useEnemy
 * gives it the host/replica plumbing), add its kind to EnemyKind, register
 * it here and give it rows in spawnTable. */
export const ENEMY_COMPONENTS: Record<EnemyKind, ComponentType<EnemyProps>> = {
  wisp: Wisp,
  sentry: Sentry,
  skitter: Skitter,
  drowned: Drowned,
  shade: Shade,
  imp: Imp,
  golem: Golem,
  mimic: Mimic,
};
