import type { Group, MeshStandardMaterial } from "three";
import { BoxGeometry, ConeGeometry, CylinderGeometry, DodecahedronGeometry, OctahedronGeometry, TorusGeometry } from "three";
import { bake, MAT } from "./materials";

/** Crystal golem: a hunched boulder-body that grew a slab of living crystal
 * over its chest like a shield. Its heart — a raw, glowing geode — sits
 * exposed in its back. Origin = body center, ~1.15 above the floor. */

export interface GolemRig {
  torso: Group | null;
  armL: Group | null;
  armR: Group | null;
  legL: Group | null;
  legR: Group | null;
}

type V3 = [number, number, number];

const rockGeo = bake([
  { geo: new DodecahedronGeometry(0.72, 0), pos: [0, 0.12, 0], scale: [1.2, 0.95, 0.85] },
  { geo: new DodecahedronGeometry(0.4, 0), pos: [0, -0.42, 0], scale: [1.3, 0.8, 1] },
  { geo: new BoxGeometry(0.36, 0.28, 0.32), pos: [0, 0.66, 0.3], rot: [0.2, 0, 0] },
  { geo: new DodecahedronGeometry(0.34, 0), pos: [0.78, 0.46, 0] },
  { geo: new DodecahedronGeometry(0.34, 0), pos: [-0.78, 0.46, 0] },
]);
/** Back-frame around the exposed heart. */
const frameGeo = bake([{ geo: new TorusGeometry(0.26, 0.08, 4, 7), pos: [0, 0.2, -0.6] }]);
const crystalGeo = bake([
  // The chest shield: a thick hexagonal slab facing forward.
  { geo: new CylinderGeometry(0.62, 0.66, 0.16, 6), pos: [0, 0.1, 0.62], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 1.25] },
  ...(
    [
      [0.82, 0.8, -0.05, -0.3, 0.4],
      [0.66, 0.78, 0.1, -0.1, 0.5],
      [-0.82, 0.8, -0.05, -0.3, -0.4],
      [-0.64, 0.76, 0.12, -0.1, -0.5],
      [0.25, 0.62, -0.42, -0.7, 0.2],
      [-0.2, 0.66, -0.45, -0.8, -0.3],
    ] as [number, number, number, number, number][]
  ).map(([x, y, z, rx, rz], i) => ({
    geo: new ConeGeometry(0.1 + (i % 2) * 0.04, 0.42 + (i % 3) * 0.14, 5),
    pos: [x, y, z] as V3,
    rot: [rx, 0, rz] as V3,
  })),
]);
const heartGeo = new OctahedronGeometry(0.2, 0);
const eyeGeo = new BoxGeometry(0.24, 0.05, 0.03);
const legGeo = bake([
  { geo: new BoxGeometry(0.36, 0.48, 0.4), pos: [0, -0.24, 0] },
  { geo: new BoxGeometry(0.42, 0.14, 0.5), pos: [0, -0.5, 0.05] },
]);
const armGeo = bake([
  { geo: new BoxGeometry(0.3, 0.62, 0.3), pos: [0, -0.4, 0] },
  { geo: new DodecahedronGeometry(0.3, 0), pos: [0, -0.86, 0.04], scale: [1, 0.9, 1.1] },
]);

export function GolemModel({
  rig,
  eye,
  heart,
}: {
  rig: GolemRig;
  eye: MeshStandardMaterial;
  heart: MeshStandardMaterial;
}) {
  return (
    <group>
      <group ref={(g) => void (rig.legL = g)} position={[-0.32, -0.6, 0]}>
        <mesh geometry={legGeo} material={MAT.rockDark} castShadow />
      </group>
      <group ref={(g) => void (rig.legR = g)} position={[0.32, -0.6, 0]}>
        <mesh geometry={legGeo} material={MAT.rockDark} castShadow />
      </group>
      <group ref={(g) => void (rig.torso = g)}>
        <mesh geometry={rockGeo} material={MAT.rock} castShadow receiveShadow />
        <mesh geometry={crystalGeo} material={MAT.crystal} castShadow />
        <mesh geometry={frameGeo} material={MAT.rockDark} />
        <mesh geometry={heartGeo} material={heart} position={[0, 0.2, -0.58]} />
        <mesh geometry={eyeGeo} material={eye} position={[0, 0.7, 0.47]} rotation={[0.2, 0, 0]} />
        <group ref={(g) => void (rig.armL = g)} position={[-0.86, 0.4, 0.05]}>
          <mesh geometry={armGeo} material={MAT.rock} castShadow />
        </group>
        <group ref={(g) => void (rig.armR = g)} position={[0.86, 0.4, 0.05]}>
          <mesh geometry={armGeo} material={MAT.rock} castShadow />
        </group>
      </group>
    </group>
  );
}
