import type { Group, MeshStandardMaterial } from "three";
import { BoxGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, TetrahedronGeometry } from "three";
import { bake, MAT } from "./materials";

/** Shade: an empty hooded robe, tattered to ribbons at the hem, with two
 * cinders for eyes and a pair of disembodied hands that do the casting.
 * Origin = chest height; the hem trails ~0.9 below it. */

export interface ShadeRig {
  robe: Group | null;
  handL: Group | null;
  handR: Group | null;
}

/** Robe with a ragged, uneven hem (deterministic jitter, module-level). */
function raggedRobe(): CylinderGeometry {
  const geo = new CylinderGeometry(0.28, 0.62, 1.3, 9, 3, true);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < -0.6) {
      // Tatters: alternate long and short strips.
      const k = Math.sin(i * 12.9898) * 43758.5453;
      const r = k - Math.floor(k);
      pos.setY(i, y - r * 0.45);
      pos.setX(i, pos.getX(i) * (0.9 + r * 0.25));
      pos.setZ(i, pos.getZ(i) * (0.9 + r * 0.25));
    }
  }
  geo.computeVertexNormals();
  return geo;
}

const robeGeo = bake([
  { geo: raggedRobe(), pos: [0, -0.35, 0] },
  { geo: new ConeGeometry(0.44, 0.7, 7), pos: [0, 0.48, -0.03] },
  { geo: new ConeGeometry(0.62, 0.34, 7, 1, true), pos: [0, 0.18, 0] },
]);
const faceGeo = new IcosahedronGeometry(0.2, 0);
const eyesGeo = bake([
  { geo: new BoxGeometry(0.07, 0.04, 0.03), pos: [-0.07, 0, 0], rot: [0, 0, -0.3] },
  { geo: new BoxGeometry(0.07, 0.04, 0.03), pos: [0.07, 0, 0], rot: [0, 0, 0.3] },
]);
const handGeo = bake([
  { geo: new TetrahedronGeometry(0.12, 0), scale: [1, 1.5, 1] },
  { geo: new ConeGeometry(0.025, 0.2, 3), pos: [0.05, 0.16, 0.02], rot: [0.2, 0, -0.3] },
  { geo: new ConeGeometry(0.025, 0.22, 3), pos: [-0.02, 0.18, 0.04], rot: [0.3, 0, 0.1] },
]);

export function ShadeModel({
  rig,
  cloth,
  glow,
}: {
  rig: ShadeRig;
  cloth: MeshStandardMaterial;
  glow: MeshStandardMaterial;
}) {
  return (
    <group>
      <group ref={(g) => void (rig.robe = g)}>
        <mesh geometry={robeGeo} material={cloth} />
        <mesh geometry={faceGeo} material={MAT.void} position={[0, 0.33, 0.1]} scale={[1, 1.2, 0.9]} />
        <mesh geometry={eyesGeo} material={glow} position={[0, 0.36, 0.27]} />
      </group>
      <group ref={(g) => void (rig.handL = g)} position={[-0.6, 0, 0.2]}>
        <mesh geometry={handGeo} material={glow} />
      </group>
      <group ref={(g) => void (rig.handR = g)} position={[0.6, 0, 0.2]}>
        <mesh geometry={handGeo} material={glow} />
      </group>
    </group>
  );
}
