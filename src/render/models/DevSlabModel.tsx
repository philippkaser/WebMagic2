import type { Ref } from "react";
import { Group, MeshStandardMaterial } from "three";

/** The dev-room monolith: a dark slab on a plinth with a glowing rune face
 * and an orbiting mote, so it reads as "interactive/magical" at a glance.
 * Origin = ground at its centre. world/devProps.tsx (DevSlab) owns the light
 * and the prompt, pulses the face through `faceRef` and spins the mote's
 * pivot group (resting at y = 2) through `moteRef`. Dev builds only, so no
 * shared-geometry bookkeeping. */
export function DevSlabModel({
  color,
  faceRef,
  moteRef,
}: {
  color: string;
  faceRef?: Ref<MeshStandardMaterial>;
  moteRef?: Ref<Group>;
}) {
  return (
    <group>
      {/* Base */}
      <mesh position={[0, 0.15, 0]} receiveShadow>
        <boxGeometry args={[1.8, 0.3, 1.8]} />
        <meshStandardMaterial color="#2a3a30" roughness={0.85} />
      </mesh>
      {/* Slab */}
      <mesh position={[0, 1.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.4, 2.4, 0.4]} />
        <meshStandardMaterial color="#1c2620" roughness={0.7} metalness={0.2} />
      </mesh>
      {/* Glowing rune face */}
      <mesh position={[0, 1.55, 0.22]}>
        <planeGeometry args={[0.9, 1.6]} />
        <meshStandardMaterial
          ref={faceRef}
          color="#04120a"
          emissive={color}
          emissiveIntensity={1.8}
          toneMapped={false}
        />
      </mesh>
      {/* Orbiting mote */}
      <group ref={moteRef} position={[0, 2, 0]}>
        <mesh position={[0.9, 0, 0]}>
          <octahedronGeometry args={[0.14]} />
          <meshStandardMaterial
            color="#0c0c14"
            emissive={color}
            emissiveIntensity={3}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  );
}
