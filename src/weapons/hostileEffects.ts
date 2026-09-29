import { hostEvent } from "../net/channels";
import type { Vec3 } from "../world/types";
import { explode } from "./damage";
import { fireProjectile } from "./projectiles";

/** Authoritative combat effects (enemy shots, boss slams) as host events.
 *
 * One handler covers every machine: on the host (`meta.self`) the effect is
 * real and damages entities; on replicas it replays cosmetically vs entities
 * (host authority — nothing is double-counted) while still hurting and
 * shoving the LOCAL player, so your survival never waits on a round trip. */

export interface EnemyCastData {
  origin: Vec3;
  velocity: Vec3;
  damage: number;
  color: string;
  size: number;
  blastRadius: number;
  blastImpulse: number;
}

export const enemyCast = hostEvent<EnemyCastData>("enemyCast", (d, meta) => {
  fireProjectile({
    team: "enemy",
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
}

export const enemyBoom = hostEvent<BoomData>("enemyBoom", (d, meta) => {
  explode({
    position: d.pos,
    radius: d.radius,
    damage: d.damage,
    impulse: d.impulse,
    team: "enemy",
    color: d.color,
    particles: 50,
    light: 50,
    remote: !meta.self,
  });
});
