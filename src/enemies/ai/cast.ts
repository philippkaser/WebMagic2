import { fireProjectile } from "../../combat/projectiles";
import { session } from "../../net/session";
import type { Vec3 } from "../../world/types";
import { scheduleBurn } from "../fx/hazards";

export interface EnemyBolt {
  origin: Vec3;
  velocity: Vec3;
  damage: number;
  color: string;
  size: number;
  blastRadius: number;
  blastImpulse: number;
  /** Gravity scale — > 0 makes a lob that arcs. */
  gravity?: number;
  /** Lobs only: seconds of burning ground where it lands. */
  burn?: number;
}

/** Host: fire an enemy spell locally and replay it on every replica (where
 * it hurts *their* wizard but never re-damages entities). Lobs that burn
 * also schedule their ground patch here; replicas schedule theirs from the
 * same replicated launch, so both land in the same spot. */
export function castEnemyBolt(bolt: EnemyBolt): void {
  fireProjectile({
    team: "enemy",
    position: bolt.origin,
    velocity: bolt.velocity,
    damage: bolt.damage,
    color: bolt.color,
    size: bolt.size,
    blastRadius: bolt.blastRadius,
    blastImpulse: bolt.blastImpulse,
    gravityScale: bolt.gravity ?? 0,
  });
  session.sendEntityEvent({ k: "enemyCast", ...bolt });
  if (bolt.burn) {
    scheduleBurn(bolt.origin, bolt.velocity, bolt.gravity ?? 0, {
      ttl: bolt.burn,
      dps: bolt.damage * 0.9,
      radius: bolt.blastRadius * 0.8,
      color: bolt.color,
    });
  }
}
