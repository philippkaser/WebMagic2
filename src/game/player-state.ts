import { Vector3 } from "three";
import type { PhysBody } from "./registry";

/** Frame-rate hot player data shared between systems (enemy AI, pickups,
 * explosions) without going through React state. Updated once per frame by
 * the PlayerController. */

export const playerPosition = new Vector3(0, 2, 0);
export const playerVelocity = new Vector3();

let playerBody: PhysBody | null = null;

export function setPlayerBody(body: PhysBody | null): void {
  playerBody = body;
}

export function getPlayerBody(): PhysBody | null {
  return playerBody;
}
