import type { Group, MeshStandardMaterial } from "three";
import { BoxGeometry, ConeGeometry, IcosahedronGeometry, OctahedronGeometry } from "three";
import { bake, MAT } from "./materials";

/** Grave-wisp: a teardrop of cold flame with a hollow-eyed face and three
 * motes of stolen light circling it. */

export interface WispRig {
  body: Group | null;
  motes: Group | null;
}

const flameGeo = bake([
  { geo: new IcosahedronGeometry(0.34, 0), scale: [1, 0.85, 1] },
  { geo: new ConeGeometry(0.25, 0.7, 6), pos: [0, 0.45, 0], rot: [0.12, 0, 0] },
  { geo: new ConeGeometry(0.1, 0.35, 4), pos: [0.16, 0.34, -0.04], rot: [0, 0, -0.5] },
  { geo: new ConeGeometry(0.1, 0.3, 4), pos: [-0.17, 0.3, 0.02], rot: [0, 0, 0.55] },
]);
const coreGeo = new IcosahedronGeometry(0.17, 0);
const faceGeo = bake([
  { geo: new BoxGeometry(0.08, 0.15, 0.06), pos: [-0.1, 0.05, 0], rot: [0, 0, 0.25] },
  { geo: new BoxGeometry(0.08, 0.15, 0.06), pos: [0.1, 0.05, 0], rot: [0, 0, -0.25] },
  { geo: new BoxGeometry(0.12, 0.05, 0.06), pos: [0, -0.13, 0] },
]);
const moteGeo = new OctahedronGeometry(0.075, 0);

export function WispModel({ rig, glow }: { rig: WispRig; glow: MeshStandardMaterial }) {
  return (
    <group>
      <group ref={(g) => void (rig.body = g)}>
        <mesh geometry={flameGeo} material={glow} castShadow />
        <mesh geometry={coreGeo} material={MAT.whiteHot} position={[0, 0.02, 0]} />
        <mesh geometry={faceGeo} material={MAT.void} position={[0, 0.02, 0.3]} />
      </group>
      <group ref={(g) => void (rig.motes = g)}>
        {[0, 1, 2].map((i) => (
          <mesh
            key={i}
            geometry={moteGeo}
            material={glow}
            position={[Math.cos((i / 3) * Math.PI * 2) * 0.62, (i - 1) * 0.14, Math.sin((i / 3) * Math.PI * 2) * 0.62]}
          />
        ))}
      </group>
    </group>
  );
}
