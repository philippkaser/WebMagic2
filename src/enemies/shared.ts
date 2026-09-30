import { interactionGroups } from "@react-three/rapier";
import { GROUPS } from "../core/config";

export const ENEMY_GROUPS = interactionGroups(GROUPS.ENEMY, [
  GROUPS.WORLD,
  GROUPS.PLAYER,
  GROUPS.ENEMY,
  GROUPS.PROP,
  GROUPS.FRIENDLY_PROJECTILE,
]);

export const LOOT_DROP_CHANCE = 0.24;
