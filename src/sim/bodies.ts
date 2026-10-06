import { GROUPS } from "../core/config";
import { slimeGeneration } from "../enemies/brains/slime";
import type { EnemyId } from "../enemies/roster";
import type { PropKind, Vec3 } from "../world/types";

/** Physical bodies — the one table of what every simulated thing IS,
 * physically: its collider, mass, damping, gravity and collision groups.
 *
 * Pure data (no React, no three, no Rapier). The React components build
 * their bodies from it (game/bodies.tsx) and so does the headless floor
 * physics (sim/floorPhysics.ts), so a floor simulated in a browser and the
 * same floor simulated on a server are the same floor. A new physical thing
 * is a row here before it's a component. */

// ── Collision groups ─────────────────────────────────────────────────────────

/** Rapier's interaction-groups bitmask: the groups a collider is IN (high 16
 * bits) and the groups it ACCEPTS contacts from (low 16; all when omitted).
 * Two colliders touch only if each accepts the other. The same arithmetic as
 * @react-three/rapier's helper, kept here so the sim needs no React. */
export function interactionGroups(memberships: number | readonly number[], filters?: number | readonly number[]): number {
  const mask = (groups: number | readonly number[]) =>
    (typeof groups === "number" ? [groups] : groups).reduce((acc, g) => acc | (1 << g), 0);
  return (mask(memberships) << 16) + (filters !== undefined ? mask(filters) : 0xffff);
}

/** Walls, floor, ceiling and every fixed piece of the dungeon. */
export const WORLD_GROUPS = interactionGroups(GROUPS.WORLD, [
  GROUPS.PLAYER,
  GROUPS.ENEMY,
  GROUPS.FRIENDLY_PROJECTILE,
  GROUPS.ENEMY_PROJECTILE,
  GROUPS.PROP,
]);

/** Breakable props: knocked about by everything, shot by everyone. */
export const PROP_GROUPS = interactionGroups(GROUPS.PROP, [
  GROUPS.WORLD,
  GROUPS.PLAYER,
  GROUPS.ENEMY,
  GROUPS.FRIENDLY_PROJECTILE,
  GROUPS.ENEMY_PROJECTILE,
  GROUPS.PROP,
]);

/** Enemy bodies collide with the world, wizards, each other, props and
 * wizard spells (never their own bolts). */
export const ENEMY_GROUPS = interactionGroups(GROUPS.ENEMY, [
  GROUPS.WORLD,
  GROUPS.PLAYER,
  GROUPS.ENEMY,
  GROUPS.PROP,
  GROUPS.FRIENDLY_PROJECTILE,
]);

// ── Fixed pieces ─────────────────────────────────────────────────────────────

/** A fixed box collider, relative to the piece it belongs to. */
export interface FixedBox {
  pos: Vec3;
  half: Vec3;
}

/** The solid standing stones of every rift (portal-local centre + half
 * extents; render/models/RiftFrameModel draws them). Both stand behind the
 * tear and inside x ∈ ±2.1, so the way home two tiles along x from the
 * descent never overlaps them. */
export const RIFT_STONES: readonly FixedBox[] = [
  { pos: [-1.75, 1.3, -1.3], half: [0.3, 1.3, 0.3] },
  { pos: [1.75, 0.8, -1.2], half: [0.32, 0.8, 0.32] },
];

// ── Bodies ───────────────────────────────────────────────────────────────────

export type ShapeSpec =
  | { kind: "ball"; radius: number }
  /** `offset`: the collider's position in the body (the sentry stands on its foot). */
  | { kind: "cuboid"; half: Vec3; offset?: Vec3 }
  | { kind: "cylinder"; halfHeight: number; radius: number }
  | { kind: "capsule"; halfHeight: number; radius: number };

export interface BodySpec {
  type: "dynamic" | "fixed";
  shape: ShapeSpec;
  /** Collider mass (kg-ish). Ignored on fixed bodies. */
  mass: number;
  gravityScale: number;
  linearDamping: number;
  angularDamping: number;
  /** Upright creatures never tumble; props do. */
  lockRotations: boolean;
  groups: number;
}

const PROP_BASE = {
  type: "dynamic",
  gravityScale: 1,
  linearDamping: 0.2,
  angularDamping: 0.4,
  lockRotations: false,
  groups: PROP_GROUPS,
} as const;

export const PROP_BODIES: Readonly<Record<PropKind, BodySpec>> = {
  crate: { ...PROP_BASE, shape: { kind: "cuboid", half: [0.42, 0.42, 0.42] }, mass: 1.1 },
  barrel: { ...PROP_BASE, shape: { kind: "cylinder", halfHeight: 0.48, radius: 0.4 }, mass: 2 },
  pot: { ...PROP_BASE, shape: { kind: "ball", radius: 0.3 }, mass: 0.4 },
};

/** Fliers hover (no gravity) and drift to a stop on their damping. */
function flier(radius: number, mass: number, linearDamping: number): BodySpec {
  return {
    type: "dynamic",
    shape: { kind: "ball", radius },
    mass,
    gravityScale: 0,
    linearDamping,
    angularDamping: 0,
    lockRotations: true,
    groups: ENEMY_GROUPS,
  };
}

/** Every enemy but the slime, whose body depends on its generation. */
export const ENEMY_BODIES: Readonly<Record<Exclude<EnemyId, "slime">, BodySpec>> = {
  wisp: flier(0.42, 2, 0.5),
  shadow: flier(0.44, 2, 0.6),
  boss: flier(1.15, 30, 0.8),
  // The sentry never moves: a fixed crystal standing on its foot.
  sentry: {
    type: "fixed",
    shape: { kind: "cuboid", half: [0.42, 0.55, 0.42], offset: [0, 0.55, 0] },
    mass: 0,
    gravityScale: 0,
    linearDamping: 0,
    angularDamping: 0,
    lockRotations: true,
    groups: ENEMY_GROUPS,
  },
};

/** A slime's body: it lives on the floor (gravity on), and each split
 * generation is smaller and lighter (enemies/brains/slime.ts). */
export function slimeBody(generation: number): BodySpec {
  const size = slimeGeneration(generation).size;
  return {
    type: "dynamic",
    shape: { kind: "ball", radius: 0.5 * size },
    mass: 1.2 * size,
    gravityScale: 1,
    linearDamping: 0.1,
    angularDamping: 0,
    lockRotations: true,
    groups: ENEMY_GROUPS,
  };
}

/** The body of any enemy kind (slimes at `generation`). */
export function enemyBody(kind: EnemyId, generation = 0): BodySpec {
  return kind === "slime" ? slimeBody(generation) : ENEMY_BODIES[kind];
}
