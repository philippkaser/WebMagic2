import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import type { PerspectiveCamera } from "three";

/** The one seam between the two canvases.
 *
 * The world canvas renders at a third of the resolution (the pixel look);
 * the UI canvas on top of it renders at full resolution so text stays
 * legible. For the UI to sit IN the world — prompts over the chest they
 * belong to, messages hanging in the air ahead — both must look through the
 * same eye: the UI canvas copies this camera every frame. R3F runs all roots
 * in one rAF loop in creation order, so the world (created first) has already
 * moved its camera when the UI copies it — no frame of lag. */
export const worldView: { camera: PerspectiveCamera | null } = { camera: null };

/** Mount inside the WORLD canvas. */
export function WorldCameraBridge() {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    worldView.camera = camera as PerspectiveCamera;
    return () => {
      if (worldView.camera === camera) worldView.camera = null;
    };
  }, [camera]);
  return null;
}
