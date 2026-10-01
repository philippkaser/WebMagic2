import { interactionGroups } from "@react-three/rapier";
import { GROUPS } from "../../core/config";
import type { Vec3 } from "../../world/types";

/** Where everything in the village stands. One table, so the decor's
 * scatter (trees, stones, grass) can keep clear of every gameplay fixture
 * the scene places — the gate, the chest, Maro's stall, the dev slab, the
 * crates — without the two drifting apart. */

/** What static village geometry collides with. */
export const WORLD_GROUPS = interactionGroups(GROUPS.WORLD, [
  GROUPS.PLAYER,
  GROUPS.ENEMY,
  GROUPS.FRIENDLY_PROJECTILE,
  GROUPS.ENEMY_PROJECTILE,
  GROUPS.PROP,
]);

export interface Cottage {
  pos: Vec3;
  rot: number;
  size: number;
}

export const COTTAGES: Cottage[] = [
  { pos: [-11, 0, -6], rot: 0.5, size: 4 },
  { pos: [11, 0, -7], rot: -0.6, size: 4.6 },
  { pos: [-13, 0, 5], rot: 1.4, size: 3.6 },
  { pos: [13, 0, 6], rot: -1.9, size: 4.2 },
  { pos: [-3, 0, -14], rot: 0.1, size: 5 },
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
export const WELL: Vec3 = [8.6, 0, 2.2];
/** Lamp posts along the lanes (each arm turns a little — see lanternYaw). */
export const LANTERNS: Vec3[] = [
  [-7.2, 0, -0.8],
  [6.4, 0, -4.2],
  [1.8, 0, -9.5],
  [-11, 0, 8.4],
];
export const FENCES: [Vec3, Vec3][] = [
  [
    [4.5, 0, 9.5],
    [10.5, 0, 12.5],
  ],
  [
    [10.5, 0, 12.5],
    [15, 0, 10],
  ],
  [
    [-5.5, 0, 14.2],
    [-12, 0, 12.2],
  ],
  [
    [-16, 0, -2],
    [-14, 0, -10],
  ],
];
/** Radius of the standing-stone ring around the gate. */
export const STONE_RING = 6.3;
/** The cobbled plaza round the gate, and the lane south to the spawn. */
export const PLAZA_R = 4.8;
export const LANE = { width: 2.6, z0: 4.15, z1: 14.65 };

/** Circles (x, z, radius) the scatter must leave empty: fixtures the scene
 * places and the space a player needs around them. */
export const KEEP_CLEAR: [number, number, number][] = [
  [CHEST.pos[0], CHEST.pos[2], 2],
  [MERCHANT.pos[0], MERCHANT.pos[2], 2.8],
  [DEV_SLAB[0], DEV_SLAB[2], 2],
  [4.2, 6.1, 1.4], // crates
  [-4.6, 6.6, 1.4], // barrel + pot
  ...GATE_TORCHES.map(([x, , z]) => [x, z, 0.8] as [number, number, number]),
];
