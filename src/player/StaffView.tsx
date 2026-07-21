import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Group, MeshStandardMaterial } from "three";
import { gameEvents } from "../core/events";
import { getItemDef } from "../items/catalog";
import { playerVelocity } from "../game/player-state";
import { useGame } from "../state/gameStore";

/** First-person staff viewmodel: follows the camera with sway, bob and recoil,
 * and carries the player's personal light (warm torchlight + staff tint) —
 * the only shadow-casting light in the dungeon. */
export function StaffView() {
  const { camera } = useThree();
  const group = useRef<Group>(null);
  const tipMat = useRef<MeshStandardMaterial>(null);
  const kick = useRef(0);
  const swayX = useRef(0);
  const bobT = useRef(0);

  const staffDefId = useGame((s) => s.equipment.staff.defId);
  const shadows = useGame((s) => s.shadows);
  const staff = getItemDef(staffDefId);

  useEffect(() => gameEvents.on("staffKick", (v) => {
    kick.current = Math.min(1, kick.current + v);
  }), []);

  // Runs after the PlayerController (-2) has positioned the camera.
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    kick.current *= Math.exp(-dt * 11);

    const hSpeed = Math.hypot(playerVelocity.x, playerVelocity.z);
    bobT.current += dt * (2.2 + hSpeed * 0.9);
    const targetSway = Math.min(hSpeed / 9, 1);
    swayX.current += (targetSway - swayX.current) * Math.min(1, dt * 6);

    g.position.copy(camera.position);
    g.quaternion.copy(camera.quaternion);
    g.translateX(0.34 + Math.sin(bobT.current) * 0.008 * swayX.current);
    g.translateY(-0.34 + Math.abs(Math.sin(bobT.current)) * 0.012 * swayX.current - kick.current * 0.02);
    g.translateZ(-0.7 + kick.current * 0.1);
    g.rotateX(kick.current * 0.18);
    g.rotateZ(-0.07);

    if (tipMat.current) {
      tipMat.current.emissiveIntensity = 1.8 + kick.current * 6 + Math.sin(bobT.current * 3) * 0.25;
    }
  }, -1);

  return (
    <group ref={group}>
      {/* Personal light — anchored just above the staff. */}
      <pointLight
        position={[-0.1, 0.5, 0.1]}
        color="#ffb877"
        intensity={26}
        distance={17}
        decay={1.7}
        castShadow={shadows}
        shadow-mapSize={[512, 512]}
        shadow-bias={-0.02}
      />
      <pointLight position={[0, 0.05, -0.3]} color={staff.color} intensity={1.6} distance={4} decay={2} />
      <group scale={0.5}>
        {/* Gnarled shaft — the old shaft's exact line, but faceted and knotted. */}
        <mesh position={[0, -0.12, 0.14]} rotation={[0.5, 0, 0]} castShadow>
          <cylinderGeometry args={[0.022, 0.032, 0.92, 5]} />
          <meshStandardMaterial color="#3a2a1c" roughness={0.9} flatShading />
        </mesh>
        {/* Knots where branches were cut away. */}
        <mesh position={[0.014, -0.1, 0.15]}>
          <sphereGeometry args={[0.032, 5, 4]} />
          <meshStandardMaterial color="#2c2014" roughness={0.95} flatShading />
        </mesh>
        <mesh position={[-0.012, -0.32, 0.05]}>
          <sphereGeometry args={[0.028, 5, 4]} />
          <meshStandardMaterial color="#2c2014" roughness={0.95} flatShading />
        </mesh>
        {/* Sinew wrap where a grip ring used to shine. */}
        <mesh position={[0, 0.12, 0.02]} rotation={[0.5, 0, 0]}>
          <torusGeometry args={[0.042, 0.016, 5, 8]} />
          <meshStandardMaterial color="#5a2028" roughness={0.9} flatShading />
        </mesh>
        {/* Bone talons cradling the crystal. */}
        {[-0.5, 1.1, 2.7, 4.3].map((a, i) => (
          <mesh
            key={i}
            position={[Math.cos(a) * 0.055, 0.28, -0.09 + Math.sin(a) * 0.055]}
            rotation={[Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45]}
          >
            <coneGeometry args={[0.016, 0.14, 4]} />
            <meshStandardMaterial color="#b8a888" roughness={0.7} flatShading />
          </mesh>
        ))}
        {/* Crystal tip */}
        <mesh position={[0, 0.33, -0.09]}>
          <octahedronGeometry args={[0.06]} />
          <meshStandardMaterial
            ref={tipMat}
            color="#0a0a12"
            emissive={staff.color}
            emissiveIntensity={1.8}
            toneMapped={false}
            metalness={0.3}
            roughness={0.2}
          />
        </mesh>
      </group>
    </group>
  );
}
