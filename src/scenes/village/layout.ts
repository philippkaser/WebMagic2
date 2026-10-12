import { interactionGroups } from "@react-three/rapier";
import { GROUPS } from "../../core/config";
import type { Vec3 } from "../../world/types";

/** Where everything in Riftwatch stands — the expedition's camp round the
 * rift they found in the valley floor. One table, so the decor's scatter
 * (trees, stones, grass) keeps clear of every gameplay fixture the scene
 * places — the gate, the chest, Maro's stall, the dev slab, the crates —
 * and so the map, the sound and the colliders all see the same camp.
 *
 * North (−z) is the forest climbing toward the mountains and the moon,
 * straight on past the gate as you come up the lane from the spawn. */

/** What static camp geometry collides with. */
export const WORLD_GROUPS = interactionGroups(GROUPS.WORLD, [
  GROUPS.PLAYER,
  GROUPS.ENEMY,
  GROUPS.FRIENDLY_PROJECTILE,
  GROUPS.ENEMY_PROJECTILE,
  GROUPS.PROP,
]);

export type StructureKind = "tent" | "pavilion" | "tower" | "wagon";

/** A building's footprint: centre, yaw, width (local x) × depth (local z),
 * height. Its front faces local +z. */
export interface Structure {
  kind: StructureKind;
  pos: Vec3;
  rot: number;
  w: number;
  d: number;
  h: number;
}

/** Yaw that turns a structure's front (+z) toward the point (x, z). */
const facing = (from: [number, number], to: [number, number]) => Math.atan2(to[0] - from[0], to[1] - from[1]);

const tent = (x: number, z: number, toward: [number, number], w = 2.4, d = 3.2): Structure => ({
  kind: "tent",
  pos: [x, 0, z],
  rot: facing([x, z], toward),
  w,
  d,
  h: 2.1,
});

export const STRUCTURES: Structure[] = [
  // Sleeping tents either side of the lane, their doors turned to it.
  tent(-6.8, 6.2, [0, 6.5]),
  tent(-10.6, 7.4, [-2, 8]),
  tent(-12.2, 2.4, [-4, 3], 2.6, 3.4),
  tent(11.6, 5.2, [3, 7]),
  tent(12.6, 10.8, [4, 10], 2.6, 3.4),
  tent(-12.8, 13.6, [-4, 11]),
  // The command pavilion, open-sided, east of the gate: the expedition's
  // maps and lamps under a peaked canvas roof.
  { kind: "pavilion", pos: [9.6, 0, -1.4], rot: facing([9.6, -1.4], [0, 0]), w: 4.4, d: 4.4, h: 3.4 },
  // The watchtower over the forest edge, northwest of the gate.
  { kind: "tower", pos: [-8.4, 0, -5.6], rot: 0.35, w: 2.2, d: 2.2, h: 5.6 },
  // A supply wagon, unhitched.
  { kind: "wagon", pos: [-12.4, 0, -1.8], rot: 1.2, w: 1.6, d: 3.2, h: 1.4 },
];

/** Player spawn: on the lane, facing the Weighing Gate at the origin. */
export const SPAWN: Vec3 = [0, 1.2, 10];

export const CHEST = { pos: [8, 0, 9.5] as Vec3, rot: -2.2 };
export const MERCHANT = { pos: [-8.5, 0, 11] as Vec3, rot: 2.5 };
export const DEV_SLAB: Vec3 = [0, 0, 14];
/** Torch posts flanking the gate. */
export const GATE_TORCHES: Vec3[] = [
  [-2.6, 0, 2.8],
  [2.6, 0, 2.8],
];
/** The depth stone: tells you which floor the rift will drop you into. */
export const PILLAR = { pos: [3.7, 0, 0.4] as Vec3, rot: facing([3.7, 0.4], [0, 10]) };
/** The camp's fire, logs round it to sit on. */
export const CAMPFIRE: Vec3 = [7.6, 0, 5.4];
/** The diggers' worktable, between the stones west of the gate. */
export const WORKTABLE = { pos: [-5.7, 0, 1.4] as Vec3, rot: facing([-5.7, 1.4], [0, 0]) };
/** Lamp posts along the camp's ways (each arm turns a little). */
export const LANTERNS: Vec3[] = [
  [-5.6, 0, -3.4],
  [6.2, 0, -4.4],
  [-3.4, 0, 9.4],
  [3.4, 0, 12.6],
];
/** Banner poles: the lane's entrance and the plaza's mouth. */
export const BANNERS: Vec3[] = [
  [-2.3, 0, 14.4],
  [2.3, 0, 14.4],
  [-3.1, 0, 5.6],
  [3.1, 0, 5.6],
];
/** Radius of the standing-stone ring around the gate. */
export const STONE_RING = 6.3;
/** The cobbled plaza round the gate (the ancient paving the diggers
 * uncovered), and the lane south to the spawn. */
export const PLAZA_R = 4.8;
export const LANE = { width: 2.6, z0: 4.15, z1: 14.65 };
/** The palisade: sharpened logs round the camp's south half, open to the
 * forest in the north, a gap where the lane leaves. Bearings (0 = +x,
 * toward +z), radius. */
export const PALISADE = { r: 21.5, from: -0.42, to: Math.PI + 0.42, gate: 0.13 };
/** The playfield: the invisible walls stand at ±this. */
export const BOUNDS = 25;

/** Circles (x, z, radius) the scatter must leave empty: fixtures the scene
 * places and the space a player needs around them. */
export const KEEP_CLEAR: [number, number, number][] = [
  [CHEST.pos[0], CHEST.pos[2], 2],
  [MERCHANT.pos[0], MERCHANT.pos[2], 2.8],
  [DEV_SLAB[0], DEV_SLAB[2], 2],
  [4.2, 6.1, 1.4], // crates
  [-4.6, 6.6, 1.4], // barrel + pot
  [PILLAR.pos[0], PILLAR.pos[2], 1.4],
  [CAMPFIRE[0], CAMPFIRE[2], 2.6],
  [WORKTABLE.pos[0], WORKTABLE.pos[2], 1.6],
  ...GATE_TORCHES.map(([x, , z]) => [x, z, 0.8] as [number, number, number]),
  ...LANTERNS.map(([x, , z]) => [x, z, 0.8] as [number, number, number]),
  ...BANNERS.map(([x, , z]) => [x, z, 0.7] as [number, number, number]),
  ...STRUCTURES.map((s) => [s.pos[0], s.pos[2], Math.hypot(s.w, s.d) / 2 + 0.6] as [number, number, number]),
];

/** Whether (x, z) lies inside a structure's footprint, grown by `pad`. */
export function inStructure(s: Structure, x: number, z: number, pad = 0): boolean {
  const dx = x - s.pos[0];
  const dz = z - s.pos[2];
  // Into the structure's own frame (its yaw undone).
  const c = Math.cos(s.rot);
  const n = Math.sin(s.rot);
  const lx = dx * c - dz * n;
  const lz = dx * n + dz * c;
  return Math.abs(lx) <= s.w / 2 + pad && Math.abs(lz) <= s.d / 2 + pad;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** The valley floor's height outside the camp: flat where you can walk,
 * climbing in the north into the forested slope under the mountains,
 * rising gently into wooded hills east and west, a long meadow south. */
export function groundHeight(x: number, z: number): number {
  const north = 7 * smooth(-BOUNDS - 1, -88, z);
  const sides = 6 * smooth(BOUNDS + 2, 70, Math.abs(x)) * (0.6 + 0.4 * smooth(10, -40, z));
  const south = 2.5 * smooth(BOUNDS + 4, 80, z);
  // Folds in the slope, so it isn't one ramp (zero inside the playfield).
  const away = smooth(BOUNDS, BOUNDS + 25, Math.max(Math.abs(x), Math.abs(z)));
  const folds = (Math.sin(x * 0.11 + Math.sin(z * 0.07) * 2) + Math.sin(z * 0.09 - x * 0.05)) * 1.6 * away;
  return Math.max(north, sides, south) + folds;
}
