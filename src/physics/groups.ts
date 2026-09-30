import { interactionGroups } from "@react-three/rapier";
import { GROUPS } from "../core/config";

/** Every collision filter in the game, in one table. Rapier filters are
 * mutual — A touches B only if each lists the other — so keeping them
 * side by side is the only sane way to reason about who hits what. */
const G = GROUPS;
const ALL_PROJECTILES = [G.FRIENDLY_PROJECTILE, G.ENEMY_PROJECTILE, G.PEER_PROJECTILE];

export const COLLISION = {
  world: interactionGroups(G.WORLD, [G.PLAYER, G.ENEMY, G.PROP, G.PEER, ...ALL_PROJECTILES]),
  prop: interactionGroups(G.PROP, [G.WORLD, G.PLAYER, G.ENEMY, G.PROP, G.PEER, ...ALL_PROJECTILES]),
  enemy: interactionGroups(G.ENEMY, [G.WORLD, G.PLAYER, G.ENEMY, G.PROP, G.FRIENDLY_PROJECTILE, G.PEER_PROJECTILE]),
  player: interactionGroups(G.PLAYER, [G.WORLD, G.ENEMY, G.PROP, G.PEER, G.ENEMY_PROJECTILE, G.PEER_PROJECTILE]),
  /** Other wizards' kinematic proxies: solid to us, and our spells land on them. */
  peer: interactionGroups(G.PEER, [G.WORLD, G.PLAYER, G.PROP, G.PEER, ...ALL_PROJECTILES]),
} as const;
