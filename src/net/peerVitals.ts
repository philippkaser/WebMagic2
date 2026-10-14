import { Color } from "three";

/** What the HUD shows of each floor-mate's life: the seam between their
 * body in the world (net/RemoteWizards writes it every frame, from the life
 * their pose carries and a heart beating at their rate) and the pixel heart
 * the HUD's life marks hang over them (ui3d/layers/hud/LifeMarks). The two
 * live on different canvases; this is the one place both see. Entries are
 * mutated in place — nothing is allocated per frame. */

export interface PeerMark {
  id: string;
  /** Over their head (world). */
  x: number;
  y: number;
  z: number;
  /** Worth showing: their life is known and they're in their last stand. */
  shown: boolean;
  /** Visibility, 0…1 in hard steps. */
  alpha: number;
  /** Their heart's lub-dub, 0…1. */
  beat: number;
  /** 1 while they stand at the Brink. */
  brink: number;
  /** How they're shown to us (ally, stranger, oathbreaker). */
  tint: Color;
}

const marks = new Map<string, PeerMark>();

/** A floor-mate's mark (made the first time it's asked for). */
export function peerMark(id: string): PeerMark {
  let m = marks.get(id);
  if (!m) {
    m = { id, x: 0, y: 0, z: 0, shown: false, alpha: 0, beat: 0, brink: 0, tint: new Color(1, 1, 1) };
    marks.set(id, m);
  }
  return m;
}

export function dropPeerMark(id: string): void {
  marks.delete(id);
}

export function forEachPeerMark(fn: (m: PeerMark) => void): void {
  for (const m of marks.values()) fn(m);
}
