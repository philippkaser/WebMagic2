import { BoxGeometry, CylinderGeometry, MeshStandardMaterial, SphereGeometry } from "three";
import type { PropKind } from "../../world/types";
import { getSurface } from "../textures";
import { shared, surfaceMaterial } from "./shared";

/** Breakable-prop meshes: crate, barrel, pot. Pure presentation — the
 * collider, health, loot and replication live in world/props.tsx
 * (Breakable), which renders these inside its RigidBody. Each model is
 * centred on its collider. Geometry and materials are shared by every
 * instance, since a floor scatters dozens of them. */

const crateGeo = shared(() => new BoxGeometry(0.84, 0.84, 0.84));
const crateMat = shared(() => surfaceMaterial("planks"));

const barrelGeo = shared(() => new CylinderGeometry(0.36, 0.4, 0.96, 10));
const barrelMat = shared(() => surfaceMaterial("barrel"));

const potGeo = shared(() => new SphereGeometry(0.3, 10, 8));
const potNeckGeo = shared(() => new CylinderGeometry(0.12, 0.16, 0.12, 8));
const potMat = shared(() => surfaceMaterial("ceramic"));
// The neck is too small for the bumps to read; color only.
const potNeckMat = shared(
  () => new MeshStandardMaterial({ map: getSurface("ceramic").map, roughness: 0.6 }),
);

export function CrateModel() {
  return <mesh geometry={crateGeo()} material={crateMat()} castShadow receiveShadow />;
}

export function BarrelModel() {
  return <mesh geometry={barrelGeo()} material={barrelMat()} castShadow receiveShadow />;
}

export function PotModel() {
  return (
    <group>
      <mesh geometry={potGeo()} material={potMat()} scale={[1, 1.15, 1]} castShadow receiveShadow />
      <mesh geometry={potNeckGeo()} material={potNeckMat()} position={[0, 0.36, 0]} />
    </group>
  );
}

/** Pick the model for a prop kind. */
export function PropModel({ kind }: { kind: PropKind }) {
  switch (kind) {
    case "crate":
      return <CrateModel />;
    case "barrel":
      return <BarrelModel />;
    case "pot":
      return <PotModel />;
  }
}
