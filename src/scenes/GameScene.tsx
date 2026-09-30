import { Environment, PointerLockControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { Suspense, useMemo } from "react";
import { BlackHoles } from "../weapons/singularity";
import { CastingSystem } from "../weapons/CastingSystem";
import { Projectiles } from "../weapons/projectiles";
import { GRAVITY } from "../core/config";
import { Graves } from "../encounters/Graves";
import { PactSystem } from "../encounters/PactSystem";
import { PresenceSystem } from "../encounters/PresenceSystem";
import { DynamicLights } from "../fx/DynamicLights";
import { FxSystems } from "../fx/Particles";
import { ConsumableSystem } from "../game/ConsumableSystem";
import { InteractionSystem } from "../game/interactions";
import { LootOrbs } from "../items/LootOrbs";
import { NetSystems } from "../net/NetSystems";
import { PeerBodies } from "../net/PeerBodies";
import { RemoteWizards } from "../net/RemoteWizards";
import { StaffView } from "../player/StaffView";
import { Effects } from "../render/Effects";
import { useGame } from "../state/gameStore";
import { WorldCameraBridge } from "../ui3d/bridge";
import { generateFloor } from "../world/gen";
import { omenRules } from "../world/omens";
import { setFloorRules } from "../game/floorRules";
import { DungeonFloor } from "./DungeonFloor";
import { Village } from "./Village";

export function GameScene() {
  const phase = useGame((s) => s.phase);
  const floor = useGame((s) => s.floor);
  const floorSeed = useGame((s) => s.floorSeed);
  const instanceId = useGame((s) => s.instanceId);

  const inDungeon = phase === "dungeon" || (phase === "loading" && floor > 0);
  const layout = useMemo(() => {
    const next = inDungeon && floorSeed ? generateFloor(floorSeed, floor) : null;
    // Floor rules (the omen's bends) must be live BEFORE the floor's enemies
    // render — they read enemyHealthMult as they initialize — so they're
    // installed here, with the layout, rather than in a mount effect (which
    // runs after the children). Idempotent, so a re-render is harmless.
    setFloorRules(next ? omenRules(next.omen) : {});
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__layout = next;
    return next;
  }, [inDungeon, floorSeed, floor]);
  const controlsEnabled = phase === "village" || phase === "dungeon";
  // The Weightless Hour (and any future omen) bends the world's gravity.
  const gravityMult = (layout && omenRules(layout.omen).gravityMult) ?? 1;

  // dpr 0.35: the game IS pixelated, so rendering at native resolution was
  // pure waste — this one number cut measured frame time ~5x. The browser
  // upscales the canvas with image-rendering: pixelated, which doubles as
  // the pixel-art look (no pixelation post-pass needed).
  return (
    <Canvas
      id="wm-world"
      shadows
      dpr={0.35}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      camera={{ fov: 78, near: 0.08, far: 140 }}
    >
      <Suspense fallback={null}>
        {/* Fixed timestep: one 1/60 step per frame. NEVER use timeStep="vary"
            here — a long frame (floor load, shader compile) integrates gravity
            over the whole gap in one step and props tunnel through the floor. */}
        <Physics gravity={[0, GRAVITY * gravityMult, 0]}>
          {inDungeon && layout ? (
            <DungeonFloor key={`${instanceId}:${floor}`} layout={layout} />
          ) : (
            <Village />
          )}
          <Projectiles />
          <BlackHoles />
          <LootOrbs />
          <PeerBodies />
        </Physics>
        <RemoteWizards />
        <Graves />
        <PactSystem />
        <PresenceSystem />
        <NetSystems />
        <FxSystems />
        <DynamicLights />
        <StaffView />
        <CastingSystem />
        <InteractionSystem />
        <ConsumableSystem />
        <WorldCameraBridge />
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
      {/* The selector is load-bearing: without it drei binds its click-to-
          lock handler to the whole DOCUMENT, so clicking a menu button would
          instantly re-lock the pointer. Scoped to the WORLD canvas (not the
          in-world UI canvas stacked above it, which only takes clicks while
          a menu is up), menu clicks can never lock. */}
      {controlsEnabled && <PointerLockControls makeDefault selector="#wm-world canvas" />}
    </Canvas>
  );
}
