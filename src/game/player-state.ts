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

// Dev-only helper for debugging and end-to-end scripts.
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__teleport = (x: number, y: number, z: number) => {
    const body = playerBody as unknown as {
      setTranslation(v: { x: number; y: number; z: number }, wake: boolean): void;
      setLinvel(v: { x: number; y: number; z: number }, wake: boolean): void;
    } | null;
    body?.setTranslation({ x, y, z }, true);
    body?.setLinvel({ x: 0, y: 0, z: 0 }, true);
  };
}
