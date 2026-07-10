import { Environment, PointerLockControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { Suspense, useMemo } from "react";
import { CombatSystem } from "../combat/CombatSystem";
import { Projectiles } from "../combat/projectiles";
import { GRAVITY } from "../core/config";
import { DynamicLights } from "../fx/DynamicLights";
import { FxSystems } from "../fx/Particles";
import { InteractionSystem } from "../game/interactions";
import { LootOrbs } from "../items/LootOrbs";
import { RemoteWizards } from "../net/RemoteWizards";
import { StaffView } from "../player/StaffView";
import { Effects } from "../render/Effects";
import { useGame } from "../state/gameStore";
import { generateFloor } from "../world/dungeonGen";
import { DungeonFloor } from "./DungeonFloor";
import { Village } from "./Village";

export function GameScene() {
  const phase = useGame((s) => s.phase);
  const floor = useGame((s) => s.floor);
  const floorSeed = useGame((s) => s.floorSeed);
  const instanceId = useGame((s) => s.instanceId);

  const inDungeon = phase === "dungeon" || (phase === "loading" && floor > 0);
  const layout = useMemo(
    () => (inDungeon && floorSeed ? generateFloor(floorSeed, floor) : null),
    [inDungeon, floorSeed, floor],
  );
  const controlsEnabled = phase === "village" || phase === "dungeon";

  return (
    <Canvas
      shadows
      dpr={1}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      camera={{ fov: 78, near: 0.08, far: 140 }}
    >
      <Suspense fallback={null}>
        {/* timeStep="vary": a hitch frame advances physics once with the real
            delta instead of stepping multiple times to catch up. */}
        <Physics gravity={[0, GRAVITY, 0]} timeStep="vary">
          {inDungeon && layout ? (
            <DungeonFloor key={`${instanceId}:${floor}`} layout={layout} />
          ) : (
            <Village />
          )}
          <Projectiles />
          <LootOrbs />
        </Physics>
        <RemoteWizards />
        <FxSystems />
        <DynamicLights />
        <StaffView />
        <CombatSystem />
        <InteractionSystem />
        {/* Tiny procedural environment map: gives the wet slabs and metal
            trims something interesting to reflect without external assets. */}
        <Environment resolution={64} frames={1}>
          <mesh position={[0, 12, -14]} scale={[26, 7, 1]}>
            <planeGeometry />
            <meshBasicMaterial color="#2a1a3e" />
          </mesh>
          <mesh position={[10, 4, 12]} rotation={[0, Math.PI, 0]} scale={[16, 4, 1]}>
            <planeGeometry />
            <meshBasicMaterial color="#4a2c14" />
          </mesh>
          <mesh position={[-12, 6, 8]} rotation={[0, Math.PI / 2, 0]} scale={[10, 3, 1]}>
            <planeGeometry />
            <meshBasicMaterial color="#12324a" />
          </mesh>
        </Environment>
        <Effects />
      </Suspense>
      {controlsEnabled && <PointerLockControls makeDefault />}
    </Canvas>
  );
}
