import type { Ref } from "react";
import { CylinderGeometry, MeshStandardMaterial, SphereGeometry } from "three";
import { shared } from "./shared";

/** A wall torch: a leaning wooden haft and a glowing ember head, the ember
 * sitting just above the origin. Light, flicker and sparks are
 * behaviour and live in world/props.tsx (Torch), which drives the ember's
 * brightness through `emberRef` so the flame and its light flicker together. */

/** Resting brightness of the ember head (the flicker swings around it). */
export const TORCH_EMBER_INTENSITY = 4.5;

const haftGeo = shared(() => new CylinderGeometry(0.03, 0.045, 0.5, 6));
const haftMat = shared(() => new MeshStandardMaterial({ color: "#3d2c1c", roughness: 0.9 }));
const emberGeo = shared(() => new SphereGeometry(0.09, 8, 6));

export function TorchModel({
  emberColor = "#ff8b3d",
  emberRef,
}: {
  emberColor?: string;
  /** The ember's material, per torch, for flicker. */
  emberRef?: Ref<MeshStandardMaterial>;
}) {
  return (
    <group>
      <mesh geometry={haftGeo()} material={haftMat()} position={[0, -0.22, 0]} rotation={[0.22, 0, 0]} />
      <mesh geometry={emberGeo()} position={[0, 0.08, 0.05]}>
        <meshStandardMaterial
          ref={emberRef}
          color="#200"
          emissive={emberColor}
          emissiveIntensity={TORCH_EMBER_INTENSITY}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
