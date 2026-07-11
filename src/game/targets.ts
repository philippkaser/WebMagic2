import { Vector3 } from "three";
import { useNet } from "../net/netStore";
import { estimatePeer, peerIds } from "../net/players";
import { playerPosition, playerVelocity } from "./player-state";

/** Enemy target selection. On the simulation host, enemies must threaten
 * EVERY wizard on the floor — not just the host's own. Peer poses come from
 * the net layer's freshest extrapolated estimate and carry velocity, so
 * shot-leading works against everyone, not only the local player.
 *
 * NOTE: the returned vectors are shared scratch — copy them if you keep them. */

const posScratch = new Vector3();
const velScratch = new Vector3();

export interface EnemyTarget {
  pos: Vector3;
  vel: Vector3;
  dist: number;
  /** True when the target is this client's own player. */
  isLocal: boolean;
}

const result: EnemyTarget = { pos: posScratch, vel: velScratch, dist: Infinity, isLocal: true };

export function nearestWizardTo(x: number, y: number, z: number): EnemyTarget {
  let bestD2 =
    (playerPosition.x - x) ** 2 + (playerPosition.y - y) ** 2 + (playerPosition.z - z) ** 2;
  posScratch.copy(playerPosition);
  velScratch.copy(playerVelocity);
  result.isLocal = true;

  for (const id of peerIds()) {
    const est = estimatePeer(id);
    if (!est) continue; // hasn't broadcast a pose yet
    const d2 = (est.p[0] - x) ** 2 + (est.p[1] - y) ** 2 + (est.p[2] - z) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      posScratch.set(est.p[0], est.p[1], est.p[2]);
      velScratch.set(est.v[0], est.v[1], est.v[2]);
      result.isLocal = false;
    }
  }
  result.dist = Math.sqrt(bestD2);
  return result;
}

/** Squared distance from a wizard to a point — the local player for our own
 * id (or the offline "self"), the freshest extrapolated pose for a peer.
 * Infinity when the peer is unknown or hasn't broadcast a pose yet, so
 * authority-side range checks fail closed. */
export function wizardDistSqTo(playerId: string, x: number, y: number, z: number): number {
  if (playerId === "self" || playerId === useNet.getState().playerId) {
    return (
      (playerPosition.x - x) ** 2 + (playerPosition.y - y) ** 2 + (playerPosition.z - z) ** 2
    );
  }
  const est = estimatePeer(playerId);
  if (!est) return Infinity;
  return (est.p[0] - x) ** 2 + (est.p[1] - y) ** 2 + (est.p[2] - z) ** 2;
}
