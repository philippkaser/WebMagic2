import { BallCollider, CapsuleCollider, CuboidCollider, CylinderCollider } from "@react-three/rapier";
import type { BodySpec } from "../sim/bodies";

/** React bindings for the physical body table (sim/bodies.ts): the
 * RigidBody settings and the collider a spec describes, so components build
 * exactly the body the headless sim builds. */

const LOCKED: [boolean, boolean, boolean] = [false, false, false];
const FREE: [boolean, boolean, boolean] = [true, true, true];

/** Spread onto a <RigidBody> (it brings its own collider: <SpecCollider>). */
export function bodyProps(spec: BodySpec) {
  return {
    type: spec.type,
    colliders: false as const,
    gravityScale: spec.gravityScale,
    linearDamping: spec.linearDamping,
    angularDamping: spec.angularDamping,
    enabledRotations: spec.lockRotations ? LOCKED : FREE,
  };
}

/** The spec's collider, with its mass and collision groups. */
export function SpecCollider({ spec }: { spec: BodySpec }) {
  const s = spec.shape;
  const common = { mass: spec.type === "fixed" ? undefined : spec.mass, collisionGroups: spec.groups };
  switch (s.kind) {
    case "ball":
      return <BallCollider args={[s.radius]} {...common} />;
    case "cuboid":
      return <CuboidCollider args={s.half} position={s.offset} {...common} />;
    case "cylinder":
      return <CylinderCollider args={[s.halfHeight, s.radius]} {...common} />;
    case "capsule":
      return <CapsuleCollider args={[s.halfHeight, s.radius]} {...common} />;
  }
}
