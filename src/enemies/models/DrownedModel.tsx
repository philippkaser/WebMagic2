import type { Group, MeshStandardMaterial } from "three";
import { BoxGeometry, IcosahedronGeometry, TorusGeometry } from "three";
import { bake, MAT } from "./materials";

/** The Drowned: a bloated, hunched sailor-thing crusted in barnacles,
 * dragging the anchor that sank it. An anglerfish lure sprouts from its back
 * and dangles a sea-green light before its face — the last thing many
 * wizards in the crypts ever followed. Origin = the body's center, 0.9 above
 * the floor. */

export interface DrownedRig {
  torso: Group | null;
  armL: Group | null;
  armR: Group | null;
  legL: Group | null;
  legR: Group | null;
  lure: Group | null;
}

type V3 = [number, number, number];

const legGeo = bake([
  { geo: new BoxGeometry(0.22, 0.5, 0.24), pos: [0, -0.25, 0] },
  { geo: new BoxGeometry(0.26, 0.1, 0.34), pos: [0, -0.5, 0.05] },
]);
const torsoGeo = bake([
  { geo: new BoxGeometry(0.62, 0.34, 0.44), pos: [0, 0, 0] },
  { geo: new BoxGeometry(0.84, 0.62, 0.58), pos: [0, 0.38, 0.08], rot: [0.35, 0, 0] },
  { geo: new BoxGeometry(1.0, 0.28, 0.5), pos: [0, 0.66, 0.2], rot: [0.3, 0, 0] },
]);
const barnacleGeo = bake(
  (
    [
      [0.38, 0.8, 0.14],
      [0.3, 0.84, 0.3],
      [-0.36, 0.78, 0.1],
      [0.12, 0.66, -0.12],
      [-0.2, 0.5, -0.14],
      [0.25, 0.3, -0.2],
      [-0.42, 0.72, 0.28],
    ] as V3[]
  ).map((pos, i) => ({ geo: new IcosahedronGeometry(0.07 + (i % 3) * 0.025, 0), pos })),
);
const ragGeo = bake([
  { geo: new BoxGeometry(0.2, 0.42, 0.03), pos: [0.18, -0.25, 0.24], rot: [0.1, 0, 0.05] },
  { geo: new BoxGeometry(0.16, 0.5, 0.03), pos: [-0.14, -0.3, 0.23], rot: [0.05, 0, -0.08] },
  { geo: new BoxGeometry(0.24, 0.36, 0.03), pos: [0.05, -0.2, -0.23], rot: [-0.1, 0, 0] },
  { geo: new BoxGeometry(0.03, 0.44, 0.2), pos: [0.32, -0.22, 0], rot: [0, 0, 0.08] },
  { geo: new BoxGeometry(0.03, 0.4, 0.2), pos: [-0.32, -0.2, 0], rot: [0, 0, -0.08] },
]);
const headGeo = bake([
  { geo: new BoxGeometry(0.32, 0.3, 0.32), pos: [0, 0, 0] },
  { geo: new BoxGeometry(0.26, 0.1, 0.24), pos: [0, -0.2, 0.05], rot: [0.35, 0, 0] },
]);
const eyesGeo = bake([
  { geo: new BoxGeometry(0.08, 0.06, 0.03), pos: [-0.08, 0.04, 0.165] },
  { geo: new BoxGeometry(0.08, 0.06, 0.03), pos: [0.08, 0.04, 0.165] },
]);
const armGeo = bake([
  { geo: new BoxGeometry(0.2, 0.52, 0.2), pos: [0, -0.26, 0] },
  { geo: new BoxGeometry(0.22, 0.48, 0.22), pos: [0, -0.72, 0.06], rot: [0.15, 0, 0] },
  { geo: new BoxGeometry(0.28, 0.22, 0.3), pos: [0, -1.02, 0.1] },
]);
const anchorGeo = bake([
  { geo: new BoxGeometry(0.09, 0.72, 0.09), pos: [0, -1.3, 0.12] },
  { geo: new BoxGeometry(0.46, 0.07, 0.07), pos: [0, -1.06, 0.12] },
  { geo: new TorusGeometry(0.28, 0.05, 3, 8, Math.PI), pos: [0, -1.5, 0.12], rot: [0, 0, Math.PI] },
  { geo: new BoxGeometry(0.1, 0.12, 0.1), pos: [0.28, -1.48, 0.12], rot: [0, 0, 0.6] },
  { geo: new BoxGeometry(0.1, 0.12, 0.1), pos: [-0.28, -1.48, 0.12], rot: [0, 0, -0.6] },
]);
const stalkGeo = bake([
  { geo: new BoxGeometry(0.05, 0.4, 0.05), pos: [0, 0.2, 0], rot: [0.3, 0, 0] },
  { geo: new BoxGeometry(0.04, 0.4, 0.04), pos: [0, 0.48, 0.2], rot: [1.1, 0, 0] },
  { geo: new BoxGeometry(0.035, 0.3, 0.035), pos: [0, 0.5, 0.5], rot: [2.2, 0, 0] },
]);
const bulbGeo = new IcosahedronGeometry(0.1, 0);

export function DrownedModel({
  rig,
  eyes,
  lure,
}: {
  rig: DrownedRig;
  eyes: MeshStandardMaterial;
  lure: MeshStandardMaterial;
}) {
  return (
    <group>
      <group ref={(g) => void (rig.legL = g)} position={[-0.2, -0.38, 0]}>
        <mesh geometry={legGeo} material={MAT.rotDark} castShadow />
      </group>
      <group ref={(g) => void (rig.legR = g)} position={[0.2, -0.38, 0]}>
        <mesh geometry={legGeo} material={MAT.rotDark} castShadow />
      </group>
      <group ref={(g) => void (rig.torso = g)} position={[0, -0.2, 0]}>
        <mesh geometry={torsoGeo} material={MAT.rot} castShadow />
        <mesh geometry={barnacleGeo} material={MAT.barnacle} />
        <mesh geometry={ragGeo} material={MAT.clothWet} />
        <group position={[0, 0.5, 0.48]}>
          <mesh geometry={headGeo} material={MAT.rot} castShadow />
          <mesh geometry={eyesGeo} material={eyes} />
        </group>
        <group position={[0, 0.72, -0.05]}>
          <mesh geometry={stalkGeo} material={MAT.rotDark} />
          <group ref={(g) => void (rig.lure = g)} position={[0, 0.34, 0.66]}>
            <mesh geometry={bulbGeo} material={lure} />
          </group>
        </group>
        <group ref={(g) => void (rig.armL = g)} position={[-0.56, 0.62, 0.22]}>
          <mesh geometry={armGeo} material={MAT.rot} castShadow />
        </group>
        <group ref={(g) => void (rig.armR = g)} position={[0.56, 0.62, 0.22]}>
          <mesh geometry={armGeo} material={MAT.rot} castShadow />
          <mesh geometry={anchorGeo} material={MAT.rust} castShadow />
        </group>
      </group>
    </group>
  );
}
