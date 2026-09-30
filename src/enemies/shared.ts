import { interactionGroups } from "@react-three/rapier";
import { GROUPS } from "../core/config";
import { COLLISION } from "../physics/groups";
import type { Vec3 } from "../world/types";
import { bandFor, type EnemyBand } from "./spawnTable";

export const ENEMY_GROUPS = COLLISION.enemy;

export const LOOT_DROP_CHANCE = 0.24;

/** Ray-query filter that sees only level geometry (walls, floor) — for line
 * of sight, blink destinations and lob landings. */
export const WALLS_ONLY = interactionGroups(GROUPS.ENEMY_PROJECTILE, [GROUPS.WORLD]);

export interface EnemyProps {
  position: Vec3;
  floor: number;
  /** Stable replication id derived from the layout ("e<index>"). */
  entityId: string;
}

/** The hue a depth band stains its wisps and wards with — the same spirit
 * burns violet in the catacombs and sea-green in the drowned crypts. */
const BAND_TINT: Record<EnemyBand["id"], string> = {
  catacombs: "#b46bff",
  drowned: "#3fe0c0",
  ember: "#ff8a3d",
  crystal: "#5cc8ff",
  abyss: "#ff3d8b",
};

export function bandTint(floor: number): string {
  return BAND_TINT[bandFor(floor).id];
}

/** Dev staging (see fx/EnemyFx): while `calm`, host brains idle so models
 * can be framed and inspected without being mauled. */
export const devStage = { calm: false };
