import { useThree } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo } from "react";
import { Color, CylinderGeometry, Fog, MeshStandardMaterial } from "three";
import { startAmbient, stopAmbient } from "../audio/sound";
import { clearGodRays, setGodRays } from "../render/godRays";
import { SpawnedEnemies } from "../enemies/SpawnedEnemies";
import { AmbientParticles } from "../fx/AmbientParticles";
import { resetRegistries } from "../game/registry";
import { PlayerController } from "../player/PlayerController";
import { getModelTextures } from "../render/models/modelPaint";
import { useGame } from "../state/gameStore";
import { DevSlab, DevSpawns } from "../world/devProps";
import { Breakable, Portal, Torch } from "../world/props";
import { Merchant, StorageChest } from "../world/villageProps";
import { Camp } from "./village/Camp";
import { FloorPillar } from "./village/FloorPillar";
import { Grounds } from "./village/Grounds";
import { BOUNDS, CHEST, DEV_SLAB, GATE_TORCHES, MERCHANT, SPAWN, WORLD_GROUPS } from "./village/layout";
import { MoonShafts } from "./village/MoonShafts";
import { Wilds } from "./village/Wilds";
import { HORIZON, MOON_DIR, Sky } from "./village/Sky";

/** Riftwatch, the wizards' home above the deep: an expedition's camp
 * pitched round the rift they found in a mountain valley — the Weighing
 * Gate, the way down, in a ring of old standing stones on the paving the
 * diggers uncovered; tents and a command pavilion, a watchtower, the fire,
 * a palisade; the forest climbing north toward the mountains and a great
 * moon rising between their peaks (./village/). Home economics stand by
 * the lane: your chest, and Maro's stall. Beside the gate, the depth stone
 * shows the floor the rift would take you to. */
export function Village() {
  const scene = useThree((s) => s.scene);
  const shadows = useGame((s) => s.shadows);
  const moonLight = useMemo(() => MOON_DIR.clone().multiplyScalar(30).toArray(), []);

  useEffect(() => {
    // Thin enough that the forest slope reads against the mountains.
    scene.fog = new Fog(HORIZON, 28, 135);
    scene.background = new Color(HORIZON);
    startAmbient("village");
    // The moon's light streaming over the valley, past the peaks and pines.
    setGodRays(MOON_DIR, "#9fb2ff", 1.0);
    return () => {
      clearGodRays();
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
      <ambientLight intensity={0.2} color="#6a78b8" />
      {/* Moonlit sky above, dark ground below: tops of things catch the sky. */}
      <hemisphereLight args={["#5868b0", "#0a0c10", 0.45]} />
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
      <AmbientParticles biome="village" omen={null} ceiling={8} />

      {/* Ground + invisible perimeter */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[BOUNDS + 1, 0.5, BOUNDS + 1]} position={[0, -0.5, 0]} collisionGroups={WORLD_GROUPS} />
        <CuboidCollider args={[BOUNDS + 1, 3, 0.5]} position={[0, 3, -BOUNDS]} collisionGroups={WORLD_GROUPS} />
        <CuboidCollider args={[BOUNDS + 1, 3, 0.5]} position={[0, 3, BOUNDS]} collisionGroups={WORLD_GROUPS} />
        <CuboidCollider args={[0.5, 3, BOUNDS + 1]} position={[-BOUNDS, 3, 0]} collisionGroups={WORLD_GROUPS} />
        <CuboidCollider args={[0.5, 3, BOUNDS + 1]} position={[BOUNDS, 3, 0]} collisionGroups={WORLD_GROUPS} />
      </RigidBody>
      <Wilds />
      <Grounds />
      <Camp />
      <FloorPillar />
      <MoonShafts />

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
