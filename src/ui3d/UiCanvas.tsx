import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useRef } from "react";
import { Group, type PerspectiveCamera } from "three";
import { useGame } from "../state/gameStore";
import { worldView } from "./bridge";
import { UiRoot } from "./UiRoot";
import { UiSparks } from "./UiSparks";

/** The in-world UI's canvas: transparent, full resolution, stacked over the
 * world canvas and looking through the same eye (bridge.tsx).
 *
 * Why a second canvas: the world renders at a third of the resolution for
 * its pixel look; 5×7 pixel text rendered there would be mush. Up here the
 * font's pixels stay crisp while everything still lives in the world's
 * space — lit, in perspective, occupying real positions.
 *
 * Pointer events: during play the canvas is click-through (the world canvas
 * below takes the click that locks the pointer); whenever a menu or screen
 * is up it catches the pointer so its tablets and buttons can be clicked. */
export function UiCanvas() {
  const phase = useGame((s) => s.phase);
  const overlay = useGame((s) => s.overlay);
  const playing = phase === "village" || phase === "dungeon";
  const interactive = !playing || overlay !== "none";
  return (
    <Canvas
      id="wm-ui"
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      camera={{ fov: 78, near: 0.01, far: 200 }}
      style={{ position: "fixed", inset: 0, zIndex: 5, pointerEvents: interactive ? "auto" : "none" }}
    >
      <CameraSync />
      <UiLights />
      <UiSparks />
      <Suspense fallback={null}>
        <UiRoot />
      </Suspense>
    </Canvas>
  );
}

/** Copy the world camera every frame, before anything in the UI reads it. */
function CameraSync() {
  const size = useThree((s) => s.size);
  useFrame(({ camera }) => {
    const src = worldView.camera;
    if (!src) return;
    const cam = camera as PerspectiveCamera;
    cam.position.copy(src.position);
    cam.quaternion.copy(src.quaternion);
    const aspect = size.width / Math.max(1, size.height);
    if (cam.fov !== src.fov || cam.aspect !== aspect) {
      cam.fov = src.fov;
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }, -100);
  return null;
}

/** The UI's own light, carried with the eye: a warm torch up and to the
 * left (the same side the staff's light falls from), a cool fill, and a
 * faint rim from behind so tablet edges read against dark halls. */
function UiLights() {
  const group = useRef<Group>(null);
  useFrame(({ camera }) => {
    const g = group.current;
    if (!g) return;
    g.position.copy(camera.position);
    g.quaternion.copy(camera.quaternion);
  }, -90);
  return (
    <>
      <ambientLight intensity={1.1} color="#9d96b8" />
      <group ref={group}>
        <pointLight position={[-0.7, 0.6, 0.2]} intensity={4} distance={8} decay={1.3} color="#ffd9a8" />
        <pointLight position={[0.9, -0.4, -0.3]} intensity={1.2} distance={5} decay={1.6} color="#7fb8ff" />
        <pointLight position={[0, 0.8, -4.5]} intensity={2} distance={5} decay={1.2} color="#b89cff" />
      </group>
    </>
  );
}
