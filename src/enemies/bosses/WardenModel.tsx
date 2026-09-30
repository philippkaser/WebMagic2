import type { Group, MeshStandardMaterial } from "three";
import { BoxGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, OctahedronGeometry, SphereGeometry } from "three";
import { bake, MAT } from "../models/materials";

/** The Warden of the Deep: a single vast eye set in an iron core, the core
 * crazed with molten seams, the whole thing guarded by orbiting armor
 * shards. At half health the shell breaks outward — the shards fly wide and
 * spin, a crown of spikes rises and the seams run white-hot. */

export interface WardenRig {
  eye: Group | null;
  shards: Group | null;
  shardPieces: (Group | null)[];
  crown: Group | null;
}

export const SHARD_COUNT = 8;

const coreGeo = new IcosahedronGeometry(1.0, 1);
const seamGeo = new IcosahedronGeometry(1.03, 1);
const scleraGeo = new SphereGeometry(0.52, 10, 8);
const irisGeo = new CylinderGeometry(0.3, 0.3, 0.06, 10).rotateX(Math.PI / 2);
const pupilGeo = new CylinderGeometry(0.12, 0.12, 0.08, 6).rotateX(Math.PI / 2);
/** An armor plate: tall, curved-ish, thin along Z (its outward face). */
const shardGeo = bake([
  { geo: new OctahedronGeometry(0.5, 0), scale: [1.0, 1.6, 0.35] },
  { geo: new OctahedronGeometry(0.2, 0), pos: [0, 0.85, -0.05], scale: [0.5, 1.4, 0.4] },
]);
/** The molten seam down each plate's face. */
const shardEdgeGeo = bake([
  { geo: new BoxGeometry(0.07, 1.1, 0.04), pos: [0, 0, 0.17] },
  { geo: new BoxGeometry(0.3, 0.05, 0.04), pos: [0, 0.2, 0.16] },
]);
const crownGeo = bake(
  Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * Math.PI * 2;
    return {
      geo: new ConeGeometry(0.1, 0.7, 4),
      pos: [Math.cos(a) * 0.6, 0.95, Math.sin(a) * 0.6] as [number, number, number],
      rot: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5] as [number, number, number],
    };
  }),
);

/** Where shard `i` sits on its orbit at radius r (two tilted rings of four). */
export function shardSlot(i: number, r: number, out: { x: number; y: number; z: number }) {
  const ring = i % 2;
  const a = (Math.floor(i / 2) / (SHARD_COUNT / 2)) * Math.PI * 2 + ring * 0.8;
  const tilt = ring ? 0.45 : -0.45;
  out.x = Math.cos(a) * r;
  out.z = Math.sin(a) * r;
  out.y = Math.sin(a) * r * Math.sin(tilt);
}

export function WardenModel({
  rig,
  seams,
  seamWire,
  iris,
}: {
  rig: WardenRig;
  seams: MeshStandardMaterial;
  /** The same glow, drawn as wireframe cracks over the core. */
  seamWire: MeshStandardMaterial;
  iris: MeshStandardMaterial;
}) {
  return (
    <group>
      <mesh geometry={coreGeo} material={MAT.iron} castShadow />
      <mesh geometry={seamGeo} material={seamWire} />
      <group ref={(g) => void (rig.crown = g)} scale={0.001}>
        <mesh geometry={crownGeo} material={MAT.iron} />
      </group>
      <group ref={(g) => void (rig.eye = g)}>
        <group position={[0, 0, 0.72]}>
          <mesh geometry={scleraGeo} material={MAT.bone} />
          <mesh geometry={irisGeo} material={iris} position={[0, 0, 0.5]} />
          <mesh geometry={pupilGeo} material={MAT.void} position={[0, 0, 0.53]} />
        </group>
      </group>
      <group ref={(g) => void (rig.shards = g)}>
        {Array.from({ length: SHARD_COUNT }, (_, i) => (
          <group key={i} ref={(g) => void (rig.shardPieces[i] = g)}>
            <mesh geometry={shardGeo} material={MAT.iron} castShadow />
            <mesh geometry={shardEdgeGeo} material={seams} />
          </group>
        ))}
      </group>
    </group>
  );
}
