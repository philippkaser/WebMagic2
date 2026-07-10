import { Vector3 } from "three";
import { session } from "../net/session";
import { playerPosition } from "./player-state";

/** Enemy target selection. On the simulation host, enemies must threaten
 * EVERY wizard on the floor — not just the host's own — otherwise a replica
 * player standing next to a wisp is invisible to it. Returns the nearest
 * player (local or peer) to a point.
 *
 * NOTE: the returned Vector3 is shared scratch — copy it if you keep it. */

const scratch = new Vector3();

export interface EnemyTarget {
  pos: Vector3;
  dist: number;
  /** True when the target is this client's own player (velocity is known,
   * so shot-leading is possible). */
  isLocal: boolean;
}

const result: EnemyTarget = { pos: scratch, dist: Infinity, isLocal: true };

export function nearestPlayerTo(x: number, y: number, z: number): EnemyTarget {
  let bestD2 =
    (playerPosition.x - x) ** 2 + (playerPosition.y - y) ** 2 + (playerPosition.z - z) ** 2;
  scratch.copy(playerPosition);
  result.isLocal = true;

  for (const peer of session.peers.values()) {
    const p = peer.position;
    if (p.y < -100) continue; // placeholder — hasn't broadcast yet
    const d2 = (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      scratch.set(p.x, p.y, p.z);
      result.isLocal = false;
    }
  }
  result.dist = Math.sqrt(bestD2);
  return result;
}
