import type { Group, MeshStandardMaterial } from "three";
import { BoxGeometry, ConeGeometry, IcosahedronGeometry, Shape, ShapeGeometry, TetrahedronGeometry } from "three";
import { bake, MAT } from "./materials";

/** Ember imp: a pot-bellied forge-sprite with a furnace for a gut, swept-back
 * horns and ragged bat wings. It juggles its fireball overhead before it
 * throws. Origin = belly center, ~0.3 above the floor. */

export interface ImpRig {
  body: Group | null;
  wingL: Group | null;
  wingR: Group | null;
  fireball: Group | null;
  mouth: Group | null;
}

const bodyGeo = bake([
  { geo: new IcosahedronGeometry(0.28, 0), scale: [1, 0.95, 0.9] },
  { geo: new BoxGeometry(0.08, 0.16, 0.08), pos: [0.1, -0.3, 0.02] },
  { geo: new BoxGeometry(0.08, 0.16, 0.08), pos: [-0.1, -0.3, 0.02] },
  { geo: new BoxGeometry(0.06, 0.2, 0.06), pos: [0.27, -0.02, 0.08], rot: [0.5, 0, 0.5] },
  { geo: new BoxGeometry(0.06, 0.2, 0.06), pos: [-0.27, -0.02, 0.08], rot: [0.5, 0, -0.5] },
  { geo: new ConeGeometry(0.035, 0.42, 4), pos: [0, -0.12, -0.36], rot: [-2.0, 0, 0] },
  { geo: new TetrahedronGeometry(0.08, 0), pos: [0, 0.02, -0.56], rot: [0.6, 0.3, 0] },
]);
const hornGeo = bake([
  { geo: new ConeGeometry(0.06, 0.34, 4), pos: [0.15, 0.3, -0.04], rot: [-0.6, 0, -0.45] },
  { geo: new ConeGeometry(0.06, 0.34, 4), pos: [-0.15, 0.3, -0.04], rot: [-0.6, 0, 0.45] },
]);
const eyesGeo = bake([
  { geo: new BoxGeometry(0.08, 0.05, 0.03), pos: [-0.08, 0.1, 0.235], rot: [0, 0, 0.3] },
  { geo: new BoxGeometry(0.08, 0.05, 0.03), pos: [0.08, 0.1, 0.235], rot: [0, 0, -0.3] },
]);
/** The furnace glow showing through cracks in its belly. */
const bellyGeo = bake([
  { geo: new BoxGeometry(0.03, 0.14, 0.03), pos: [0.05, -0.1, 0.25], rot: [0, 0, 0.4] },
  { geo: new BoxGeometry(0.03, 0.1, 0.03), pos: [-0.06, -0.14, 0.24], rot: [0, 0, -0.5] },
  { geo: new BoxGeometry(0.1, 0.03, 0.03), pos: [0, -0.19, 0.22] },
]);
const mouthGeo = new BoxGeometry(0.16, 0.05, 0.03);

function wingShape(): Shape {
  const s = new Shape();
  s.moveTo(0, 0);
  s.lineTo(0.5, 0.28);
  s.lineTo(0.42, 0.06);
  s.lineTo(0.34, 0.1);
  s.lineTo(0.28, -0.08);
  s.lineTo(0.18, -0.02);
  s.lineTo(0.1, -0.14);
  s.lineTo(0, 0);
  return s;
}
const wingGeo = new ShapeGeometry(wingShape());
const fireballGeo = new IcosahedronGeometry(0.16, 0);

export function ImpModel({
  rig,
  eyes,
  ember,
}: {
  rig: ImpRig;
  eyes: MeshStandardMaterial;
  ember: MeshStandardMaterial;
}) {
  return (
    <group ref={(g) => void (rig.body = g)}>
      <mesh geometry={bodyGeo} material={MAT.impSkin} castShadow />
      <mesh geometry={hornGeo} material={MAT.horn} />
      <mesh geometry={eyesGeo} material={eyes} />
      <mesh geometry={bellyGeo} material={ember} />
      <group ref={(g) => void (rig.mouth = g)} position={[0, -0.01, 0.24]}>
        <mesh geometry={mouthGeo} material={ember} />
      </group>
      <group ref={(g) => void (rig.wingR = g)} position={[0.12, 0.12, -0.18]}>
        <mesh geometry={wingGeo} material={MAT.wing} />
      </group>
      <group ref={(g) => void (rig.wingL = g)} position={[-0.12, 0.12, -0.18]} scale={[-1, 1, 1]}>
        <mesh geometry={wingGeo} material={MAT.wing} />
      </group>
      <group ref={(g) => void (rig.fireball = g)} position={[0, 0.55, 0.05]}>
        <mesh geometry={fireballGeo} material={ember} />
      </group>
    </group>
  );
}
