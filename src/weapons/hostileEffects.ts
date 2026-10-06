import { ENEMY_SOURCE, WORLD_SOURCE, type DamageSource } from "../game/damageSource";
import { hostEvent } from "../net/channels";
import { FLOOR } from "../net/floorProtocol";
import type { BoomData, CastData } from "../sim/world";
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

/** An enemy bolt — the sim's CastData (sim/world.ts), trap darts included. */
export type EnemyCastData = CastData;

export const enemyCast = hostEvent<EnemyCastData>(FLOOR.enemyCast, (d, meta) => {
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

export type { BoomData };

export const enemyBoom = hostEvent<BoomData>(FLOOR.enemyBoom, (d, meta) => {
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
