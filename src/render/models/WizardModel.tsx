import { useMemo } from "react";
import { getTextures } from "../textures";

/** A hooded wizard: layered cloth robe, a hood pulled low over a dark
 * nothing of a face, two pale eyes glowing out of it, staff in hand. The
 * body group (first child) is what the owner bobs while walking. */
export function WizardModel({ robeColor, staffColor }: { robeColor: string; staffColor: string }) {
  const cloth = useMemo(() => getTextures("cloth"), []);
  return (
    <>
      {/* Hooded figure: layered cloth robe, a hood pulled low over a dark
          nothing of a face, two pale eyes glowing out of it. */}
      <group>
        {/* Robe — two staggered tattered layers so the hem reads as cloth */}
        <mesh position={[0, -0.1, 0]} castShadow>
          <coneGeometry args={[0.46, 1.5, 7]} />
          <meshStandardMaterial map={cloth.map} normalMap={cloth.normalMap} color={robeColor} roughness={0.92} />
        </mesh>
        <mesh position={[0, 0.08, 0]} rotation={[0, 0.45, 0]} castShadow>
          <coneGeometry args={[0.38, 1.15, 7]} />
          <meshStandardMaterial map={cloth.map} normalMap={cloth.normalMap} color={robeColor} roughness={0.92} />
        </mesh>
        {/* Rope belt */}
        <mesh position={[0, 0.16, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.31, 0.025, 6, 10]} />
          <meshStandardMaterial color="#8a7448" roughness={0.9} />
        </mesh>
        {/* Shoulders */}
        <mesh position={[0, 0.62, 0]} scale={[1, 0.6, 1]} castShadow>
          <sphereGeometry args={[0.3, 8, 6]} />
          <meshStandardMaterial map={cloth.map} normalMap={cloth.normalMap} color={robeColor} roughness={0.92} />
        </mesh>
        {/* The void under the hood */}
        <mesh position={[0, 0.86, 0.02]}>
          <sphereGeometry args={[0.17, 8, 6]} />
          <meshStandardMaterial color="#060409" roughness={1} />
        </mesh>
        {/* Glowing eyes */}
        <mesh position={[-0.06, 0.88, 0.15]}>
          <boxGeometry args={[0.035, 0.035, 0.02]} />
          <meshStandardMaterial color="#000" emissive="#bfe8ff" emissiveIntensity={3.2} toneMapped={false} />
        </mesh>
        <mesh position={[0.06, 0.88, 0.15]}>
          <boxGeometry args={[0.035, 0.035, 0.02]} />
          <meshStandardMaterial color="#000" emissive="#bfe8ff" emissiveIntensity={3.2} toneMapped={false} />
        </mesh>
        {/* Hood: a cowl leaning forward over the face */}
        <mesh position={[0, 1.02, -0.03]} rotation={[0.42, 0, 0]} castShadow>
          <coneGeometry args={[0.27, 0.62, 7, 1, true]} />
          <meshStandardMaterial
            map={cloth.map}
            normalMap={cloth.normalMap}
            color={robeColor}
            roughness={0.95}
            side={2}
          />
        </mesh>
        {/* Hood rim shadowing the face */}
        <mesh position={[0, 0.94, 0.1]} rotation={[1.12, 0, 0]}>
          <torusGeometry args={[0.19, 0.05, 6, 8]} />
          <meshStandardMaterial map={cloth.map} normalMap={cloth.normalMap} color={robeColor} roughness={0.95} />
        </mesh>
      </group>
      {/* Staff, held in a cloth sleeve */}
      <group position={[0.42, 0.1, 0.1]} rotation={[0, 0, -0.12]}>
        <mesh>
          <cylinderGeometry args={[0.03, 0.04, 1.5, 6]} />
          <meshStandardMaterial color="#4a3526" roughness={0.85} />
        </mesh>
        <mesh position={[-0.1, 0.28, -0.02]} rotation={[0, 0, 1.25]} castShadow>
          <coneGeometry args={[0.09, 0.42, 6]} />
          <meshStandardMaterial map={cloth.map} normalMap={cloth.normalMap} color={robeColor} roughness={0.92} />
        </mesh>
        <mesh position={[0, 0.85, 0]}>
          <octahedronGeometry args={[0.09]} />
          <meshStandardMaterial
            color="#0a0a12"
            emissive={staffColor}
            emissiveIntensity={2}
            toneMapped={false}
          />
        </mesh>
      </group>
    </>
  );
}
