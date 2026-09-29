import type { Ref } from "react";
import { CylinderGeometry, Group, OctahedronGeometry } from "three";
import { shared, surfaceMaterial } from "./shared";

/** The floor-treasure pedestal: a carved stone column with a capstone and a
 * glowing gem hovering above it. Origin = ground at the column's centre.
 *
 * Behaviour (world/props.tsx TreasurePedestal) owns the roll, the take
 * request and the light; it bobs and spins the gem through `orbRef` (a group
 * resting at PEDESTAL_ORB_Y) and hides it with `taken`. */

export const PEDESTAL_ORB_Y = 1.45;

const columnGeo = shared(() => new CylinderGeometry(0.3, 0.42, 1.1, 8));
const capGeo = shared(() => new CylinderGeometry(0.38, 0.32, 0.08, 8));
const stoneMat = shared(() => surfaceMaterial("stone", { roughness: 0.8 }));
const gemGeo = shared(() => new OctahedronGeometry(0.26));

export function PedestalModel({
  color,
  taken = false,
  orbRef,
}: {
  /** The treasure's item color. */
  color: string;
  taken?: boolean;
  orbRef?: Ref<Group>;
}) {
  return (
    <group>
      <mesh geometry={columnGeo()} material={stoneMat()} position={[0, 0.55, 0]} castShadow receiveShadow />
      <mesh geometry={capGeo()} material={stoneMat()} position={[0, 1.14, 0]} castShadow receiveShadow />
      {!taken && (
        <group ref={orbRef} position={[0, PEDESTAL_ORB_Y, 0]}>
          <mesh geometry={gemGeo()} castShadow>
            <meshStandardMaterial
              color="#0c0c14"
              emissive={color}
              emissiveIntensity={2.8}
              toneMapped={false}
            />
          </mesh>
        </group>
      )}
    </group>
  );
}
