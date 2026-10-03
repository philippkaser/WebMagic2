import { Stars } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo } from "react";
import { Color, CylinderGeometry, Fog, MeshStandardMaterial } from "three";
import { startAmbient, stopAmbient } from "../audio/sound";
import { SpawnedEnemies } from "../enemies/SpawnedEnemies";
import { AmbientParticles } from "../fx/AmbientParticles";
import { resetRegistries } from "../game/registry";
import { PlayerController } from "../player/PlayerController";
import { getModelTextures } from "../render/models/modelPaint";
import { getVillageTextures } from "../render/textures/villagePainters";
import { useGame } from "../state/gameStore";
import { DevSlab, DevSpawns } from "../world/devProps";
import { Breakable, Portal, Torch } from "../world/props";
import { Merchant, StorageChest } from "../world/villageProps";
import { Cottages } from "./village/Cottages";
import { Grounds } from "./village/Grounds";
import { CHEST, COTTAGES, DEV_SLAB, GATE_TORCHES, MERCHANT, SPAWN, WORLD_GROUPS } from "./village/layout";
import { HORIZON, MOON_DIR, Sky } from "./village/Sky";

/** The wizards' village: a moonlit hamlet in a ring of pines under a big
 * moon — half-timbered cottages with lit windows and smoking chimneys, a
 * cobbled lane, lamp posts, a well, and standing stones ringing the Weighing
 * Gate at its heart, the way down. (The artpass village; its decor lives in
 * ./village/.) Home economics stand by the lane: your chest, and Maro's
 * stall. */
export function Village() {
  const scene = useThree((s) => s.scene);
  const shadows = useGame((s) => s.shadows);
  // Ground reaches past the playfield so the treeline stands on something.
  const ground = useMemo(() => {
    const t = getVillageTextures("grass", 60, 60);
    return new MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.95 });
  }, []);
  useEffect(() => () => ground.dispose(), [ground]);
  const moonLight = useMemo(() => MOON_DIR.clone().multiplyScalar(30).toArray(), []);

  useEffect(() => {
    scene.fog = new Fog(HORIZON, 20, 80);
    scene.background = new Color(HORIZON);
    startAmbient("village");
    return () => {
      scene.fog = null;
      stopAmbient();
      resetRegistries();
    };
  }, [scene]);

  const openWeighing = () => {
    document.exitPointerLock();
    useGame.getState().openWeighing();
  };

  return (
    <group>
      <ambientLight intensity={0.26} color="#6a78b8" />
      <directionalLight
        position={moonLight}
        intensity={0.65}
        color="#a8b8f0"
        castShadow={shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-28}
        shadow-camera-right={28}
        shadow-camera-top={28}
        shadow-camera-bottom={-28}
      />
      <Sky />
      <Stars radius={100} depth={20} count={2000} factor={4} saturation={0} fade speed={0.6} />
      <AmbientParticles biome="village" omen={null} ceiling={8} />

      {/* Ground + invisible perimeter */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[26, 0.5, 26]} position={[0, -0.5, 0]} collisionGroups={WORLD_GROUPS} />
        <CuboidCollider args={[26, 3, 0.5]} position={[0, 3, -25]} collisionGroups={WORLD_GROUPS} />
        <CuboidCollider args={[26, 3, 0.5]} position={[0, 3, 25]} collisionGroups={WORLD_GROUPS} />
        <CuboidCollider args={[0.5, 3, 26]} position={[-25, 3, 0]} collisionGroups={WORLD_GROUPS} />
        <CuboidCollider args={[0.5, 3, 26]} position={[25, 3, 0]} collisionGroups={WORLD_GROUPS} />
      </RigidBody>
      <mesh rotation={[-Math.PI / 2, 0, 0]} material={ground} receiveShadow>
        <planeGeometry args={[140, 140]} />
      </mesh>

      <Cottages cottages={COTTAGES} />
      <Grounds cottages={COTTAGES} />

      {/* Home economics: your chest by the lane, Maro's stall opposite. */}
      <StorageChest position={CHEST.pos} rotation={CHEST.rot} />
      <Merchant position={MERCHANT.pos} rotation={MERCHANT.rot} />

      {/* A few crates to kick around — the sandbox starts at home. */}
      <Breakable kind="crate" position={[4, 1, 6]} floor={1} entityId="v0" />
      <Breakable kind="crate" position={[4.4, 2, 6.2]} floor={1} entityId="v1" />
      <Breakable kind="barrel" position={[-5, 1, 7]} floor={1} entityId="v2" />
      <Breakable kind="pot" position={[-4.2, 1, 6.2]} floor={1} entityId="v3" />

      {/* Torch posts flanking the gate */}
      {GATE_TORCHES.map((p, i) => (
        <group key={i} position={p}>
          <TorchPost />
          <Torch position={[0, 1.9, 0]} />
        </group>
      ))}

      <Portal position={[0, 0, 0]} color="#46ffd0" prompt="E — Step into the Weighing Gate" onUse={openWeighing} />

      {/* Dev test bench: a slab behind the spawn that opens the DevRoom panel,
          plus the enemies it spawns. Only in dev builds (`bun run dev`) —
          `import.meta.env.DEV` is a literal false in the production build, so
          neither the slab nor the spawner ships to a deployed server. */}
      {import.meta.env.DEV && (
        <>
          <DevSlab position={DEV_SLAB} />
          <DevSpawns />
          {/* So dev-spawned slimes can actually split in the arena. */}
          <SpawnedEnemies />
        </>
      )}

      <PlayerController spawn={SPAWN} />
    </group>
  );
}

let postGeo: CylinderGeometry | null = null;
let postMat: MeshStandardMaterial | null = null;

/** A bark-grained post the gate torches stand on. */
function TorchPost() {
  postGeo ??= new CylinderGeometry(0.07, 0.09, 1.8, 6);
  postMat ??= new MeshStandardMaterial({ color: "#5a4030", map: getModelTextures("bark").map, roughness: 0.9 });
  return <mesh geometry={postGeo} material={postMat} position={[0, 0.9, 0]} castShadow />;
}
