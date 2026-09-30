/** Where the portals are, for the journey that starts at one.
 *
 * The store's scene-switching actions (descend, walkHome, enterDungeon) are
 * plain game logic: they don't know — and shouldn't have to be told — which
 * ring in the world the player stepped into. Every open portal registers an
 * anchor here instead, and a journey that begins within reach of one pulls the
 * view toward it and opens the vortex around it on screen. Scripts and the
 * warp rune, which call the actions away from any portal, simply get a vortex
 * that opens in front of the player. Import-free on purpose (a seam, like
 * game/hostility.ts). */

export interface PortalAnchor {
  /** Ring centre in world space. */
  x: number;
  y: number;
  z: number;
  /** A journey is starting through this portal — flare up. */
  surge(): void;
}

const anchors = new Set<PortalAnchor>();

/** Register an open portal; returns the unregister function. */
export function registerPortalAnchor(anchor: PortalAnchor): () => void {
  anchors.add(anchor);
  return () => {
    anchors.delete(anchor);
  };
}

/** The nearest registered portal within `maxDist` metres (horizontal), or
 * null. */
export function nearestPortalAnchor(x: number, z: number, maxDist: number): PortalAnchor | null {
  let best: PortalAnchor | null = null;
  let bestD2 = maxDist * maxDist;
  for (const a of anchors) {
    const d2 = (a.x - x) ** 2 + (a.z - z) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = a;
    }
  }
  return best;
}
