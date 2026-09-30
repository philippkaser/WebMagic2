import type { Group, MeshStandardMaterial } from "three";
import { BoxGeometry, ConeGeometry, IcosahedronGeometry } from "three";
import { ChestModel } from "../../render/models/ChestModel";
import { bake, MAT } from "./materials";

/** Mimic: wears the very chest model the dungeon uses for a fallen wizard's
 * remains — bones and all — so it reads as loot until the lid splits into a
 * mouth (the chest's glowing seam turns into its throat). Teeth, tongue and
 * eye live inside, hidden while the lid is shut.
 * Origin = the chest's base. */

export interface MimicRig {
  lid: Group | null;
  /** Upper fangs ride the lid's hinge (ChestModel owns the lid itself). */
  fangs: Group | null;
  tongue: Group | null;
}

const RIM_Y = 0.5;
/** Lower teeth around the rim of the box, pointing up. */
const lowerTeethGeo = bake([
  ...[-0.36, -0.22, -0.08, 0.08, 0.22, 0.36].map((x) => ({
    geo: new ConeGeometry(0.045, 0.14, 4),
    pos: [x, RIM_Y + 0.02, 0.25] as [number, number, number],
  })),
  ...[-0.15, 0.05].flatMap((z) => [
    { geo: new ConeGeometry(0.04, 0.12, 4), pos: [0.38, RIM_Y + 0.01, z] as [number, number, number] },
    { geo: new ConeGeometry(0.04, 0.12, 4), pos: [-0.38, RIM_Y + 0.01, z] as [number, number, number] },
  ]),
]);
/** Upper teeth in lid space (hinge at the back edge), pointing down. */
const upperTeethGeo = bake(
  [-0.3, -0.15, 0, 0.15, 0.3].map((x) => ({
    geo: new ConeGeometry(0.05, 0.18, 4),
    pos: [x, -0.04, 0.54] as [number, number, number],
    rot: [Math.PI, 0, 0] as [number, number, number],
  })),
);
const tongueGeo = bake([
  { geo: new BoxGeometry(0.26, 0.06, 0.34), pos: [0, 0, 0.17] },
  { geo: new BoxGeometry(0.2, 0.05, 0.22), pos: [0, -0.04, 0.42], rot: [0.5, 0, 0] },
]);
const eyeGeo = new IcosahedronGeometry(0.1, 0);

export function MimicModel({
  rig,
  seam,
  eye,
}: {
  rig: MimicRig;
  seam: React.Ref<MeshStandardMaterial>;
  eye: MeshStandardMaterial;
}) {
  return (
    <group>
      <ChestModel lidRef={(g: Group | null) => void (rig.lid = g)} seamRef={seam} glow="#ffcf5a" remains />
      <mesh geometry={lowerTeethGeo} material={MAT.teeth} />
      <group ref={(g) => void (rig.fangs = g)} position={[0, 0.52, -0.3]}>
        <mesh geometry={upperTeethGeo} material={MAT.teeth} />
      </group>
      <group ref={(g) => void (rig.tongue = g)} position={[0, RIM_Y - 0.02, -0.1]}>
        <mesh geometry={tongueGeo} material={MAT.flesh} />
      </group>
      <mesh geometry={eyeGeo} material={eye} position={[0, RIM_Y + 0.02, -0.15]} scale={[1.3, 0.9, 1]} />
    </group>
  );
}
