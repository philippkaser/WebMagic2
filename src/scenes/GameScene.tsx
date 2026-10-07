import { Environment, PointerLockControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { Suspense, useEffect, useMemo, useState } from "react";
import { AudioWorld } from "../audio/AudioWorld";
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
import { pixelGrid, setWorldGrid, type PixelGrid } from "../render/pixelGrid";
import { TransitionSystem } from "../transition/TransitionSystem";
import { useGame } from "../state/gameStore";
import { WorldCameraBridge } from "../ui3d/bridge";
import { FloorMaps } from "../ui3d/layers/map/FloorMap";
import { generateFloor } from "../world/gen";
import { omenRules } from "../world/omens";
import { setFloorRules } from "../game/floorRules";
import { setCurrentLayout } from "../world/currentFloor";
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
    setCurrentLayout(next);
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__layout = next;
    return next;
  }, [inDungeon, floorSeed, floor]);
  // Mouse-look stays live through a portal journey (phase "loading"): the
  // lock survives the tunnel, and a controls instance remounted mid-lock
  // would never see a pointerlockchange and ignore the mouse.
  const controlsEnabled = phase === "village" || phase === "dungeon" || phase === "loading";
  // The Weightless Hour (and any future omen) bends the world's gravity.
  const gravityMult = (layout && omenRules(layout.omen).gravityMult) ?? 1;

  // The game IS pixelated, so rendering the world at native resolution
  // would be pure waste: it renders at ~340 lines into an offscreen target
  // (render/Effects), and the canvas — at full device resolution — gets the
  // final composite: each world pixel a block of exactly `scale` screen
  // pixels (render/pixelGrid.ts), the light and blur smooth over them. The
  // box may overhang the window by under one world pixel, cropped evenly.
  const grid = usePixelGrid();
  setWorldGrid(grid);
  return (
    <div
      style={{
        position: "fixed",
        left: grid.cssLeft,
        top: grid.cssTop,
        width: grid.cssWidth,
        height: grid.cssHeight,
      }}
    >
      <Canvas
        id="wm-world"
        shadows
        dpr={grid.ratio}
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
          {/* The ears: raytraced room acoustics, placed sounds, the world's
              own voices (audio/). */}
          <AudioWorld layout={inDungeon ? layout : null} />
          <Graves />
          <FloorMaps />
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
          {/* Portal journeys: camera pull/FOV/roll and the vortex tunnel that
              covers every scene switch (transition/). */}
          <TransitionSystem />
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
          <Effects grid={grid} />
        </Suspense>
        {/* The selector is load-bearing: without it drei binds its click-to-
            lock handler to the whole DOCUMENT, so clicking a menu button would
            instantly re-lock the pointer. Scoped to the WORLD canvas (not the
            in-world UI canvas stacked above it, which only takes clicks while
            a menu is up), menu clicks can never lock. */}
        {controlsEnabled && <PointerLockControls makeDefault selector="#wm-world canvas" />}
      </Canvas>
    </div>
  );
}

/** The world's pixel grid for the current window, kept up to date as the
 * window resizes or moves to a screen with another pixel density. */
function usePixelGrid(): PixelGrid {
  const measure = () => pixelGrid(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  const [grid, setGrid] = useState(measure);
  useEffect(() => {
    let media: MediaQueryList | null = null;
    const update = () => {
      setGrid((prev) => {
        const next = measure();
        return next.width === prev.width && next.height === prev.height && next.scale === prev.scale && next.cssLeft === prev.cssLeft && next.cssTop === prev.cssTop ? prev : next;
      });
      // A density change (dragged to another monitor, browser zoom) fires
      // only on a query for the CURRENT density: re-arm it each time.
      media?.removeEventListener("change", update);
      media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      media.addEventListener("change", update);
    };
    update();
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      media?.removeEventListener("change", update);
    };
  }, []);
  return grid;
}
