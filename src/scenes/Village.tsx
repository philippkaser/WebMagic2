import { Stars } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { CuboidCollider, interactionGroups, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo } from "react";
import { Color, Fog } from "three";
import { startAmbient, stopAmbient } from "../audio/sound";
import { GROUPS } from "../core/config";
import { resetRegistries } from "../game/registry";
import { PlayerController } from "../player/PlayerController";
import { getTextures } from "../render/textures";
import { useGame } from "../state/gameStore";
import { Breakable, Portal, Torch } from "../world/props";
import type { Vec3 } from "../world/types";

const WORLD_GROUPS = interactionGroups(GROUPS.WORLD, [
  GROUPS.PLAYER,
  GROUPS.ENEMY,
  GROUPS.FRIENDLY_PROJECTILE,
  GROUPS.ENEMY_PROJECTILE,
  GROUPS.PROP,
]);

const HUTS: { pos: Vec3; rot: number; size: number }[] = [
  { pos: [-11, 0, -6], rot: 0.5, size: 4 },
  { pos: [11, 0, -7], rot: -0.6, size: 4.6 },
  { pos: [-13, 0, 5], rot: 1.4, size: 3.6 },
  { pos: [13, 0, 6], rot: -1.9, size: 4.2 },
  { pos: [-3, 0, -14], rot: 0.1, size: 5 },
];

const SPAWN: Vec3 = [0, 1.2, 10];

/** The wizards' village: a quiet night-time hub above the dungeon. The portal
 * at its center is the way down. */
export function Village() {
  const scene = useThree((s) => s.scene);
  const groundTex = useMemo(() => getTextures("dirt", 22, 22), []);
  const wallTex = useMemo(() => getTextures("stone"), []);

  useEffect(() => {
    scene.fog = new Fog("#0a0d18", 18, 70);
    scene.background = new Color("#0a0d18");
    startAmbient("village");
    return () => {
      scene.fog = null;
      stopAmbient();
      resetRegistries();
    };
  }, [scene]);

  const openSelect = () => {
    document.exitPointerLock();
    useGame.getState().openPortalSelect();
  };

  return (
    <group>
      <ambientLight intensity={0.22} color="#7a86b8" />
      <directionalLight
        position={[14, 22, 8]}
        intensity={0.5}
        color="#9fb0e8"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-28}
        shadow-camera-right={28}
        shadow-camera-top={28}
        shadow-camera-bottom={-28}
      />
      <Stars radius={90} depth={40} count={2400} factor={4} saturation={0} fade speed={0.6} />

      {/* Ground + invisible perimeter */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[26, 0.5, 26]} position={[0, -0.5, 0]} collisionGroups={WORLD_GROUPS} />
        <CuboidCollider args={[26, 3, 0.5]} position={[0, 3, -25]} collisionGroups={WORLD_GROUPS} />
        <CuboidCollider args={[26, 3, 0.5]} position={[0, 3, 25]} collisionGroups={WORLD_GROUPS} />
        <CuboidCollider args={[0.5, 3, 26]} position={[-25, 3, 0]} collisionGroups={WORLD_GROUPS} />
        <CuboidCollider args={[0.5, 3, 26]} position={[25, 3, 0]} collisionGroups={WORLD_GROUPS} />
      </RigidBody>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[52, 52]} />
        <meshStandardMaterial map={groundTex.map} normalMap={groundTex.normalMap} roughness={0.95} />
      </mesh>

      {HUTS.map((hut, i) => (
        <Hut key={i} {...hut} wallTex={wallTex} />
      ))}

      {/* A few crates to kick around — the sandbox starts at home. */}
      <Breakable kind="crate" position={[4, 1, 6]} floor={1} />
      <Breakable kind="crate" position={[4.4, 2, 6.2]} floor={1} />
      <Breakable kind="barrel" position={[-5, 1, 7]} floor={1} />
      <Breakable kind="pot" position={[-4.2, 1, 6.2]} floor={1} />

      {/* Torch posts flanking the portal */}
      {([[-2.6, 0, 2.8], [2.6, 0, 2.8]] as Vec3[]).map((p, i) => (
        <group key={i} position={p}>
          <mesh position={[0, 0.9, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.09, 1.8, 6]} />
            <meshStandardMaterial color="#3d2c1c" roughness={0.9} />
          </mesh>
          <Torch position={[0, 1.9, 0]} />
        </group>
      ))}

      <Portal
        position={[0, 0, 0]}
        color="#46ffd0"
        prompt="E — Enter the dungeon"
        onUse={openSelect}
      />

      <PlayerController spawn={SPAWN} />
    </group>
  );
}

function Hut({
  pos,
  rot,
  size,
  wallTex,
}: {
  pos: Vec3;
  rot: number;
  size: number;
  wallTex: ReturnType<typeof getTextures>;
}) {
  const height = size * 0.7;
  return (
    <group position={pos} rotation={[0, rot, 0]}>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[size / 2, height / 2, size / 2]}
          position={[0, height / 2, 0]}
          collisionGroups={WORLD_GROUPS}
        />
      </RigidBody>
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[size, height, size]} />
        <meshStandardMaterial map={wallTex.map} normalMap={wallTex.normalMap} roughness={0.9} />
      </mesh>
      <mesh position={[0, height + size * 0.28, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[size * 0.82, size * 0.56, 4]} />
        <meshStandardMaterial color="#2c2030" roughness={0.9} />
      </mesh>
      {/* Warm window */}
      <mesh position={[0, height * 0.55, size / 2 + 0.01]}>
        <planeGeometry args={[0.5, 0.6]} />
        <meshStandardMaterial color="#100800" emissive="#ffb355" emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
    </group>
  );
}
