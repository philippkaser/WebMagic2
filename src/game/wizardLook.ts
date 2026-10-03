import { hashSeed } from "../core/rng";

/** How other wizards look to us — derived from their player id so every
 * client paints the same wizard the same robe (and their grave the same
 * glow) without any of it crossing the wire. */

const ROBE_COLORS = ["#3d5a8a", "#6a3d8a", "#8a3d50", "#3d8a5f", "#8a6a3d", "#3d7a8a"];

export function robeColorOf(wizardId: string): string {
  return ROBE_COLORS[hashSeed(wizardId) % ROBE_COLORS.length];
}

/** Name-tag tints by relation. */
export const TAG_COLORS = {
  stranger: "#e8dfc8",
  ally: "#8fe3a0",
  oathbreaker: "#ff6a5a",
} as const;

/** Name tags show within this distance — or always, for sworn allies. Beyond
 * it a stranger is just a silhouette in the dark. */
export const NAME_RANGE = 16;
