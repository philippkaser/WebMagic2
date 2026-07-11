/** THE wizard body — robe, head, hat, staff with glowing crystal, and
 * optionally boots and a floating amulet gem. One component renders both the
 * remote wizards on shared floors and the live preview in the inventory
 * screen, so "what a wizard looks like" has exactly one definition. */
export function WizardModel({
  robeColor,
  staffColor,
  bootsColor,
  amuletColor,
  castShadow = false,
}: {
  robeColor: string;
  staffColor: string;
  /** Omit to render the classic bootless silhouette (remote wizards). */
  bootsColor?: string | null;
  amuletColor?: string | null;
  castShadow?: boolean;
}) {
  return (
    <group>
      {/* Robe */}
      <mesh position={[0, -0.1, 0]} castShadow={castShadow}>
        <coneGeometry args={[0.45, 1.5, 8]} />
        <meshStandardMaterial color={robeColor} roughness={0.85} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 0.8, 0]} castShadow={castShadow}>
        <sphereGeometry args={[0.22, 10, 8]} />
        <meshStandardMaterial color="#d8b894" roughness={0.8} />
      </mesh>
      {/* Hat */}
      <mesh position={[0, 1.12, 0]} castShadow={castShadow}>
        <coneGeometry args={[0.32, 0.62, 8]} />
        <meshStandardMaterial color={robeColor} roughness={0.9} />
      </mesh>
      {/* Amulet: a small gem hovering at the chest */}
      {amuletColor && (
        <mesh position={[0, 0.42, 0.33]}>
          <octahedronGeometry args={[0.06]} />
          <meshStandardMaterial
            color="#0a0a12"
            emissive={amuletColor}
            emissiveIntensity={2.2}
            toneMapped={false}
          />
        </mesh>
      )}
      {/* Boots peeking out under the robe hem */}
      {bootsColor && (
        <>
          <mesh position={[-0.16, -0.82, 0.12]} castShadow={castShadow}>
            <boxGeometry args={[0.16, 0.14, 0.3]} />
            <meshStandardMaterial color={bootsColor} roughness={0.8} />
          </mesh>
          <mesh position={[0.16, -0.82, 0.12]} castShadow={castShadow}>
            <boxGeometry args={[0.16, 0.14, 0.3]} />
            <meshStandardMaterial color={bootsColor} roughness={0.8} />
          </mesh>
        </>
      )}
      {/* Staff */}
      <group position={[0.42, 0.1, 0.1]} rotation={[0, 0, -0.12]}>
        <mesh castShadow={castShadow}>
          <cylinderGeometry args={[0.03, 0.04, 1.5, 6]} />
          <meshStandardMaterial color="#4a3526" roughness={0.85} />
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
    </group>
  );
}
