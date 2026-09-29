import { ENEMY_SOURCE, WORLD_SOURCE, type DamageSource } from "../game/damageSource";
import { hostEvent } from "../net/channels";
import type { Vec3 } from "../world/types";
import { explode } from "./explosions";
import { fireProjectile } from "./projectiles";

/** Authoritative combat effects (enemy shots, boss slams, trap darts) as host
 * events.
 *
 * One handler covers every machine: on the host (`meta.self`) the effect is
 * real and damages entities; on replicas it replays cosmetically vs entities
 * (host authority — nothing is double-counted) while still hurting and
 * shoving the LOCAL player, so your survival never waits on a round trip. */

/** Who a dungeon effect is blamed on when it hurts a wizard: a monster
 * ("enemy", the default) or the dungeon itself ("world" — traps). Sent as a
 * tag rather than a DamageSource so the wire stays a closed, tiny vocabulary. */
export type DungeonSourceTag = "enemy" | "world";

function dungeonSource(tag: DungeonSourceTag | undefined): DamageSource {
  return tag === "world" ? WORLD_SOURCE : ENEMY_SOURCE;
}

export interface EnemyCastData {
  origin: Vec3;
  velocity: Vec3;
  damage: number;
  color: string;
  size: number;
  blastRadius: number;
  blastImpulse: number;
  /** Default "enemy"; trap darts send "world". */
  source?: DungeonSourceTag;
}

export const enemyCast = hostEvent<EnemyCastData>("enemyCast", (d, meta) => {
  fireProjectile({
    team: "enemy",
    source: dungeonSource(d.source),
    position: d.origin,
    velocity: d.velocity,
    damage: d.damage,
    color: d.color,
    size: d.size,
    blastRadius: d.blastRadius,
    blastImpulse: d.blastImpulse,
    cosmetic: !meta.self,
  });
});

export interface BoomData {
  pos: Vec3;
  radius: number;
  damage: number;
  impulse: number;
  color: string;
  /** Default "enemy" (boss slams); a trap-triggered blast would send "world". */
  source?: DungeonSourceTag;
}

export const enemyBoom = hostEvent<BoomData>("enemyBoom", (d, meta) => {
  explode({
    position: d.pos,
    radius: d.radius,
    damage: d.damage,
    impulse: d.impulse,
    team: "enemy",
    source: dungeonSource(d.source),
    color: d.color,
    particles: 50,
    light: 50,
    remote: !meta.self,
  });
});
