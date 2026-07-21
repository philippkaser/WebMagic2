import { useMemo } from "react";
import { Color } from "three";

/** THE wizard body — a gaunt, hunched thing in a tattered robe. Sprite-count
 * low-poly with flat shading so the chunky renderer reads every facet: ragged
 * hem spikes, a hood drooping over a lightless face, two ember eyes, one
 * skeletal claw around a crooked staff. One component renders both the remote
 * wizards on shared floors and the live preview in the inventory screen, so
 * "what a wizard looks like" has exactly one definition. */

/** Ragged hem: a ring of downward spikes around the robe's base. */
const HEM_SPIKES = [0, 1, 2, 3, 4, 5, 6].map((i) => {
  const a = (i / 7) * Math.PI * 2 + 0.3;
  return { a, x: Math.cos(a) * 0.34, z: Math.sin(a) * 0.34, len: 0.22 + ((i * 37) % 5) * 0.03 };
});

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
  // Hood and rags run a shade darker than the robe so the silhouette layers.
  const darkRobe = useMemo(
    () => `#${new Color(robeColor).multiplyScalar(0.55).getHexString()}`,
    [robeColor],
  );
  return (
    <group>
      {/* Robe — slightly crooked, flat-shaded so the folds facet. */}
      <mesh position={[0, -0.1, 0]} rotation={[0.06, 0.4, 0.04]} castShadow={castShadow}>
        <coneGeometry args={[0.46, 1.5, 7]} />
        <meshStandardMaterial color={robeColor} roughness={0.92} flatShading />
      </mesh>
      {/* Ragged hem spikes. */}
      {HEM_SPIKES.map(({ a, x, z, len }, i) => (
        <mesh
          key={i}
          position={[x, -0.78 - len * 0.3, z]}
          rotation={[Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35]}
        >
          <coneGeometry args={[0.09, len, 4]} />
          <meshStandardMaterial color={darkRobe} roughness={0.95} flatShading />
        </mesh>
      ))}
      {/* Hunched back — the descent bends every spine eventually. */}
      <mesh position={[0, 0.52, -0.16]} scale={[1, 0.75, 0.9]} castShadow={castShadow}>
        <sphereGeometry args={[0.3, 7, 5]} />
        <meshStandardMaterial color={robeColor} roughness={0.92} flatShading />
      </mesh>
      {/* Shoulder mantle the cowl grows out of. */}
      <mesh position={[0, 0.55, 0]} castShadow={castShadow}>
        <coneGeometry args={[0.4, 0.52, 7]} />
        <meshStandardMaterial color={darkRobe} roughness={0.95} flatShading />
      </mesh>
      {/* The cowl: a deep hood, not a hat. The face inside is a hole. */}
      <mesh position={[0, 0.86, -0.03]} scale={[1, 1.08, 1.02]} castShadow={castShadow}>
        <sphereGeometry args={[0.27, 8, 6]} />
        <meshStandardMaterial color={darkRobe} roughness={0.95} flatShading />
      </mesh>
      <mesh position={[0, 0.83, 0.1]}>
        <sphereGeometry args={[0.19, 8, 6]} />
        <meshStandardMaterial color="#0a0708" roughness={1} />
      </mesh>
      {/* The cowl's rim, ringing the dark. */}
      <mesh position={[0, 0.84, 0.17]} rotation={[0.22, 0, 0]} castShadow={castShadow}>
        <torusGeometry args={[0.21, 0.05, 5, 8]} />
        <meshStandardMaterial color={darkRobe} roughness={0.95} flatShading />
      </mesh>
      {/* Two embers where eyes should be. */}
      {([0.075, -0.075] as const).map((x) => (
        <mesh key={x} position={[x, 0.85, 0.24]}>
          <boxGeometry args={[0.05, 0.045, 0.03]} />
          <meshStandardMaterial
            color="#000"
            emissive="#d8e6a8"
            emissiveIntensity={3}
            toneMapped={false}
          />
        </mesh>
      ))}
      {/* The hood's slack, folded down the back. */}
      <mesh position={[0, 1.0, -0.22]} rotation={[-1.15, 0, 0]} castShadow={castShadow}>
        <coneGeometry args={[0.12, 0.42, 5]} />
        <meshStandardMaterial color={darkRobe} roughness={0.95} flatShading />
      </mesh>
      {/* Amulet: a small gem hovering at the sunken chest */}
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
      {/* Boots peeking out under the ragged hem */}
      {bootsColor && (
        <>
          <mesh position={[-0.16, -0.82, 0.12]} castShadow={castShadow}>
            <boxGeometry args={[0.16, 0.14, 0.3]} />
            <meshStandardMaterial color={bootsColor} roughness={0.8} flatShading />
          </mesh>
          <mesh position={[0.16, -0.82, 0.12]} castShadow={castShadow}>
            <boxGeometry args={[0.16, 0.14, 0.3]} />
            <meshStandardMaterial color={bootsColor} roughness={0.8} flatShading />
          </mesh>
        </>
      )}
      {/* Staff — crooked, gripped by a fleshless claw. */}
      <group position={[0.42, 0.1, 0.1]} rotation={[0, 0, -0.12]}>
        <mesh position={[0, -0.35, 0]} castShadow={castShadow}>
          <cylinderGeometry args={[0.032, 0.045, 0.85, 5]} />
          <meshStandardMaterial color="#3a2a1c" roughness={0.9} flatShading />
        </mesh>
        <mesh position={[0.045, 0.42, 0.02]} rotation={[0.05, 0, 0.14]} castShadow={castShadow}>
          <cylinderGeometry args={[0.024, 0.032, 0.75, 5]} />
          <meshStandardMaterial color="#3a2a1c" roughness={0.9} flatShading />
        </mesh>
        {/* Bone claw cradling the crystal. */}
        {[-0.6, 0.7, 2.6].map((a, i) => (
          <mesh
            key={i}
            position={[0.11 + Math.cos(a) * 0.07, 0.78, 0.02 + Math.sin(a) * 0.07]}
            rotation={[Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55 + 0.14]}
          >
            <coneGeometry args={[0.022, 0.18, 4]} />
            <meshStandardMaterial color="#b8a888" roughness={0.7} flatShading />
          </mesh>
        ))}
        <mesh position={[0.11, 0.85, 0.02]}>
          <octahedronGeometry args={[0.09]} />
          <meshStandardMaterial
            color="#0a0a12"
            emissive={staffColor}
            emissiveIntensity={2}
            toneMapped={false}
          />
        </mesh>
        {/* The claw's owner: a bony hand clamped to the shaft. */}
        <mesh position={[-0.06, 0.05, 0.03]} rotation={[0, 0, 0.5]}>
          <boxGeometry args={[0.1, 0.06, 0.07]} />
          <meshStandardMaterial color="#c8b494" roughness={0.8} flatShading />
        </mesh>
      </group>
    </group>
  );
}
