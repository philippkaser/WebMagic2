import type RAPIER from "@dimforge/rapier3d-compat";
import { GRAVITY, WALL_HEIGHT } from "../core/config";
import { omenRules } from "../world/omens";
import type { FloorLayout, Vec3 } from "../world/types";
import { enemyBody, PROP_BODIES, RIFT_STONES, WORLD_GROUPS, type BodySpec, type FixedBox } from "./bodies";

/** A floor's physics, headless — the same world the browser builds through
 * React (scenes/DungeonFloor, world/props, enemies/kinds), built straight
 * from the generated layout and the body table (sim/bodies.ts), with no
 * React, three.js or rendering. This is what a floor simulated anywhere but
 * a browser stands on: a server-side floor host, tests, benchmarks
 * (scripts/physics-bench.ts).
 *
 * Bodies are keyed by the client's replication ids ("e3", "p12", "boss"), so
 * snapshots from either simulation address the same entities. The Rapier
 * module is passed in (and initialized by the caller, once per process). */

export type Rapier = typeof RAPIER;

export interface FloorPhysics {
  world: RAPIER.World;
  /** Entity id → body: every enemy, prop and the boss the layout spawns. */
  bodies: Map<string, RAPIER.RigidBody>;
  /** Add a body at runtime (a slime split, a projectile). */
  add(id: string, spec: BodySpec, pos: Vec3): RAPIER.RigidBody;
  /** Take a body out (a death, a break). */
  remove(id: string): void;
  step(dt: number): void;
  /** What the step costs scale with: dynamic bodies, and how many are awake
   * (sleeping bodies are nearly free). */
  counts(): { bodies: number; awake: number; staticColliders: number };
  free(): void;
}

export function buildFloorPhysics(R: Rapier, layout: FloorLayout): FloorPhysics {
  const gravity = GRAVITY * (omenRules(layout.omen).gravityMult ?? 1);
  const world = new R.World({ x: 0, y: gravity, z: 0 });
  const bodies = new Map<string, RAPIER.RigidBody>();

  // Every fixed piece in one fixed body, as the browser does.
  const fixed = world.createRigidBody(R.RigidBodyDesc.fixed());
  const box = (b: FixedBox, at: Vec3 = [0, 0, 0]) =>
    world.createCollider(
      R.ColliderDesc.cuboid(b.half[0], b.half[1], b.half[2])
        .setTranslation(at[0] + b.pos[0], at[1] + b.pos[1], at[2] + b.pos[2])
        .setCollisionGroups(WORLD_GROUPS),
      fixed,
    );
  for (const w of layout.wallBoxes) box({ pos: w.center, half: w.half });
  const slab: Vec3 = [layout.extent, 0.5, layout.extent];
  box({ pos: [0, -0.5, 0], half: slab }); // floor
  box({ pos: [0, WALL_HEIGHT + 0.5, 0], half: slab }); // ceiling
  for (const portal of [layout.exit, layout.leave]) for (const s of RIFT_STONES) box(s, portal);
  const staticColliders = layout.wallBoxes.length + 2 + RIFT_STONES.length * 2;

  const add = (id: string, spec: BodySpec, pos: Vec3): RAPIER.RigidBody => {
    const desc = spec.type === "fixed" ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic();
    desc
      .setTranslation(pos[0], pos[1], pos[2])
      .setGravityScale(spec.gravityScale)
      .setLinearDamping(spec.linearDamping)
      .setAngularDamping(spec.angularDamping);
    if (spec.lockRotations) desc.lockRotations();
    const body = world.createRigidBody(desc);
    const collider = colliderOf(R, spec).setCollisionGroups(spec.groups);
    if (spec.type !== "fixed") collider.setMass(spec.mass);
    world.createCollider(collider, body);
    bodies.set(id, body);
    return body;
  };

  layout.enemies.forEach((e, i) => add(`e${i}`, enemyBody(e.kind), e.pos));
  layout.props.forEach((p, i) => add(`p${i}`, PROP_BODIES[p.kind], p.pos));
  if (layout.boss) add("boss", enemyBody("boss"), layout.boss);

  return {
    world,
    bodies,
    add,
    remove(id) {
      const body = bodies.get(id);
      if (!body) return;
      world.removeRigidBody(body);
      bodies.delete(id);
    },
    step(dt) {
      world.timestep = dt;
      world.step();
    },
    counts() {
      let awake = 0;
      for (const b of bodies.values()) if (b.isDynamic() && !b.isSleeping()) awake++;
      return { bodies: bodies.size, awake, staticColliders };
    },
    free() {
      world.free();
      bodies.clear();
    },
  };
}

function colliderOf(R: Rapier, spec: BodySpec): RAPIER.ColliderDesc {
  const s = spec.shape;
  switch (s.kind) {
    case "ball":
      return R.ColliderDesc.ball(s.radius);
    case "cuboid": {
      const desc = R.ColliderDesc.cuboid(s.half[0], s.half[1], s.half[2]);
      return s.offset ? desc.setTranslation(s.offset[0], s.offset[1], s.offset[2]) : desc;
    }
    case "cylinder":
      return R.ColliderDesc.cylinder(s.halfHeight, s.radius);
    case "capsule":
      return R.ColliderDesc.capsule(s.halfHeight, s.radius);
  }
}
