import type { BiomeId, DecorKind, Vec3 } from "./types";

/** Set dressing as pure data: what each kind of decor is, where it may
 * stand, how much room it needs, and how often each depth band scatters it.
 * The generator stage (world/gen/dressing.ts) places it; the renderer
 * (render/models/decor/) draws each kind as one instanced mesh.
 *
 * The rule of the house is GAME_DESIGN's "readable chaos": rooms get more
 * texture, not clutter. Decor lives where nobody walks — in the corners, at
 * the foot of the walls, on the walls, hanging from the vault — or lies
 * flat (grates, puddles). The two pieces with any bulk (anvils, braziers)
 * only ever stand in true corners, which can never be a way through, and
 * carry a small collider so wizards and monsters don't walk through iron. */

/** Where a piece of decor stands.
 * - corner: on the floor, tucked into a true room corner (a dead end);
 * - wallBase: on the floor at the foot of a wall;
 * - floor: flat on the open floor (walkable over);
 * - wall: hung on a wall face, anchored on the face;
 * - upperCorner: in the angle of two walls under the vault (anchor at the
 *   corner, at the vault);
 * - ceiling: hanging from the vault (anchor on the vault). */
export type DecorMount = "corner" | "wallBase" | "floor" | "wall" | "upperCorner" | "ceiling";

export interface DecorDef {
  kind: DecorKind;
  mounts: readonly DecorMount[];
  /** Floor footprint radius (m) — spacing and clearances. */
  radius: number;
  /** Wall decor: half its width along the wall, and the height range it
   * covers on the wall (m above the floor). */
  wall?: { halfWidth: number; y0: number; y1: number };
  /** Hanging decor: how far below the vault it reaches at most (m). */
  hang?: number;
  /** A small solid collider (half extents, m) centred over the anchor,
   * standing on the floor. Only corner pieces may have one. */
  collider?: Vec3;
  /** Number of shapes the renderer knows for it. */
  variants: number;
  /** Scale range the generator rolls. */
  scale: [number, number];
}

const DEFS: readonly DecorDef[] = [
  { kind: "bones", mounts: ["corner", "wallBase"], radius: 0.5, variants: 3, scale: [0.85, 1.15] },
  { kind: "candles", mounts: ["corner", "wallBase"], radius: 0.3, variants: 3, scale: [0.9, 1.15] },
  { kind: "chain", mounts: ["ceiling"], radius: 0.25, hang: 2.5, variants: 3, scale: [0.85, 1.05] },
  { kind: "cobweb", mounts: ["upperCorner"], radius: 0.1, variants: 2, scale: [0.8, 1.15] },
  { kind: "banner", mounts: ["wall"], radius: 0.1, wall: { halfWidth: 0.45, y0: 2.6, y1: 5.7 }, variants: 2, scale: [0.95, 1.05] },
  { kind: "grate", mounts: ["floor"], radius: 0.7, variants: 2, scale: [1, 1] },
  { kind: "rubble", mounts: ["corner", "wallBase"], radius: 0.6, variants: 3, scale: [0.8, 1.2] },
  { kind: "niche", mounts: ["wall"], radius: 0.1, wall: { halfWidth: 0.55, y0: 0.75, y1: 2.35 }, variants: 2, scale: [1, 1] },
  { kind: "barnacles", mounts: ["wallBase"], radius: 0.45, variants: 3, scale: [0.8, 1.2] },
  { kind: "kelp", mounts: ["corner", "wallBase"], radius: 0.4, variants: 3, scale: [0.8, 1.25] },
  { kind: "puddle", mounts: ["floor"], radius: 0.95, variants: 3, scale: [0.8, 1.2] },
  { kind: "anvil", mounts: ["corner"], radius: 0.55, collider: [0.36, 0.4, 0.36], variants: 1, scale: [0.95, 1.05] },
  { kind: "slag", mounts: ["corner", "wallBase"], radius: 0.6, variants: 3, scale: [0.8, 1.2] },
  { kind: "brazier", mounts: ["corner"], radius: 0.45, collider: [0.3, 0.55, 0.3], variants: 1, scale: [0.95, 1.05] },
  { kind: "spur", mounts: ["corner", "wallBase"], radius: 0.4, variants: 3, scale: [0.7, 1.3] },
  { kind: "roots", mounts: ["ceiling"], radius: 0.35, hang: 2.3, variants: 3, scale: [0.8, 1.1] },
  { kind: "chime", mounts: ["ceiling"], radius: 0.3, hang: 2.2, variants: 2, scale: [0.9, 1.1] },
];

const byKind = new Map(DEFS.map((d) => [d.kind, d]));

export function allDecorDefs(): readonly DecorDef[] {
  return DEFS;
}

export function getDecorDef(kind: DecorKind): DecorDef {
  const def = byKind.get(kind);
  if (!def) throw new Error(`Unknown decor kind: ${kind}`);
  return def;
}

/** One line of a band's dressing: each room rolls `chance`; a room that
 * wins gets up to `perRoom` pieces, the floor at most `cap`. */
export interface DressRecipe {
  kind: DecorKind;
  chance: number;
  perRoom: number;
  cap: number;
}

/** What each depth band leaves lying about. Order matters only for who
 * claims a corner first: bulky and signature pieces lead. */
export const DRESSING: Readonly<Record<BiomeId, readonly DressRecipe[]>> = {
  // The builders' tombs: bones in every corner, candles somebody keeps
  // lighting, webs in the vault, the Founders' banners gone to rags.
  catacombs: [
    { kind: "niche", chance: 0.35, perRoom: 1, cap: 5 },
    { kind: "bones", chance: 0.7, perRoom: 2, cap: 14 },
    { kind: "candles", chance: 0.45, perRoom: 2, cap: 9 },
    { kind: "cobweb", chance: 0.6, perRoom: 2, cap: 12 },
    { kind: "chain", chance: 0.35, perRoom: 2, cap: 8 },
    { kind: "banner", chance: 0.3, perRoom: 1, cap: 4 },
    { kind: "rubble", chance: 0.4, perRoom: 1, cap: 6 },
    { kind: "grate", chance: 0.25, perRoom: 1, cap: 3 },
  ],
  // Where the sea got in: barnacles at the foot of every wall, kelp in the
  // corners, drains that never stop gurgling, rust.
  drowned: [
    { kind: "kelp", chance: 0.6, perRoom: 2, cap: 12 },
    { kind: "barnacles", chance: 0.7, perRoom: 3, cap: 16 },
    { kind: "puddle", chance: 0.35, perRoom: 1, cap: 6 },
    { kind: "grate", chance: 0.35, perRoom: 1, cap: 4 },
    { kind: "chain", chance: 0.4, perRoom: 2, cap: 8 },
    { kind: "bones", chance: 0.3, perRoom: 1, cap: 5 },
    { kind: "rubble", chance: 0.35, perRoom: 1, cap: 6 },
    { kind: "banner", chance: 0.15, perRoom: 1, cap: 2 },
    { kind: "candles", chance: 0.1, perRoom: 1, cap: 2 },
  ],
  // Where the wards were hammered out: anvils, braziers still burning,
  // slag heaps still warm, iron chains.
  forge: [
    { kind: "brazier", chance: 0.35, perRoom: 1, cap: 4 },
    { kind: "anvil", chance: 0.3, perRoom: 1, cap: 4 },
    { kind: "slag", chance: 0.5, perRoom: 2, cap: 8 },
    { kind: "chain", chance: 0.55, perRoom: 3, cap: 12 },
    { kind: "banner", chance: 0.3, perRoom: 1, cap: 4 },
    { kind: "rubble", chance: 0.35, perRoom: 1, cap: 6 },
    { kind: "grate", chance: 0.3, perRoom: 1, cap: 4 },
    { kind: "bones", chance: 0.15, perRoom: 1, cap: 3 },
  ],
  // The singing bones: crystal spurs pushing out of the rock, fallen
  // stone, very little that anyone carried down.
  crystal: [
    { kind: "spur", chance: 0.75, perRoom: 3, cap: 18 },
    { kind: "rubble", chance: 0.4, perRoom: 2, cap: 8 },
    { kind: "cobweb", chance: 0.25, perRoom: 1, cap: 4 },
    { kind: "chain", chance: 0.2, perRoom: 1, cap: 4 },
    { kind: "bones", chance: 0.2, perRoom: 1, cap: 4 },
    { kind: "candles", chance: 0.15, perRoom: 1, cap: 3 },
    { kind: "banner", chance: 0.15, perRoom: 1, cap: 2 },
  ],
  // Near the bottom: pale roots through the vault, bone chimes nobody
  // hung, and candles lit by no one.
  hollow: [
    { kind: "roots", chance: 0.6, perRoom: 2, cap: 12 },
    { kind: "chime", chance: 0.35, perRoom: 1, cap: 5 },
    { kind: "niche", chance: 0.25, perRoom: 1, cap: 3 },
    { kind: "bones", chance: 0.6, perRoom: 2, cap: 12 },
    { kind: "candles", chance: 0.4, perRoom: 2, cap: 8 },
    { kind: "cobweb", chance: 0.35, perRoom: 2, cap: 8 },
    { kind: "chain", chance: 0.25, perRoom: 1, cap: 4 },
    { kind: "rubble", chance: 0.3, perRoom: 1, cap: 4 },
  ],
};
