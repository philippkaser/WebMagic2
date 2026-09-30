import { useMemo, type Ref } from "react";
import type { Group, MeshStandardMaterial } from "three";
import { getTextures } from "../textures";

/** Iron-banded wooden chest. `remains` adds a scatter of bones — a chest
 * inherited from someone who died on an older version of this floor. The
 * lid is a separate group (hinged at the back) so the owner can animate it. */
export function ChestModel({
  lidRef,
  seamRef,
  glow,
  remains,
}: {
  lidRef?: Ref<Group>;
  seamRef?: Ref<MeshStandardMaterial>;
  glow: string;
  remains: boolean;
}) {
  const wood = useMemo(() => getTextures("planks"), []);
  return (
    <group>
      {/* Body */}
      <mesh position={[0, 0.25, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.5, 0.6]} />
        <meshStandardMaterial map={wood.map} normalMap={wood.normalMap} roughness={0.85} />
      </mesh>
      {/* Iron bands */}
      {[-0.3, 0.3].map((x) => (
        <mesh key={x} position={[x, 0.26, 0]}>
          <boxGeometry args={[0.07, 0.52, 0.62]} />
          <meshStandardMaterial color="#2b2a30" metalness={0.8} roughness={0.4} />
        </mesh>
      ))}
      {/* Glowing seam where the lid doesn't quite close */}
      <mesh position={[0, 0.51, 0]}>
        <boxGeometry args={[0.86, 0.03, 0.56]} />
        <meshStandardMaterial ref={seamRef} color="#000" emissive={glow} emissiveIntensity={2.4} toneMapped={false} />
      </mesh>
      {/* Lid, hinged at the back edge */}
      <group ref={lidRef} position={[0, 0.52, -0.3]}>
        <mesh position={[0, 0.1, 0.3]} castShadow>
          <boxGeometry args={[0.92, 0.2, 0.62]} />
          <meshStandardMaterial map={wood.map} normalMap={wood.normalMap} roughness={0.85} />
        </mesh>
        <mesh position={[0, 0.1, 0.61]}>
          <boxGeometry args={[0.14, 0.14, 0.04]} />
          <meshStandardMaterial color="#8a7448" metalness={0.9} roughness={0.3} />
        </mesh>
      </group>
      {remains && (
        <group>
          {/* Skull */}
          <mesh position={[0.62, 0.13, 0.25]} scale={[1, 0.9, 1.1]}>
            <sphereGeometry args={[0.13, 7, 6]} />
            <meshStandardMaterial color="#d8cdb4" roughness={0.9} />
          </mesh>
          {/* Bones */}
          {[
            [-0.6, 0.04, 0.3, 0.6],
            [-0.5, 0.04, -0.25, -0.9],
            [0.5, 0.04, -0.35, 1.9],
          ].map(([x, y, z, r], i) => (
            <mesh key={i} position={[x, y, z]} rotation={[0, r, Math.PI / 2]}>
              <cylinderGeometry args={[0.025, 0.025, 0.42, 5]} />
              <meshStandardMaterial color="#cbbf9f" roughness={0.9} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}
