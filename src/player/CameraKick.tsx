import { addAfterEffect, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Quaternion, Vector3, type PerspectiveCamera } from "three";
import { gameEvents } from "../core/events";
import { presentDt } from "../core/presentTime";
import { useTravel } from "../transition/store";
import { createKick, kickCamera, laidPitch, stepKick } from "./kick";

/** The eye's recoil (player/kick): a heavy spell kicks the view up and a
 * touch aside and punches it in; your kills breathe it in a little.
 *
 * Laid over the camera AFTER the cast has read its aim (CastingSystem, at
 * priority 0) and before the picture is drawn (the post chain, at 1) — so
 * recoil never bends a shot — and taken off again as soon as every canvas
 * has drawn the frame (an after-effect; the in-world UI canvas looks
 * through this same eye). Not at the start of the next frame: mouse moves
 * and timers land BETWEEN frames, and pointer-lock's look would read the
 * kicked eye back as its own (at the top of the look, over the top and
 * rolled onto its back), an echo's timer would aim along it. Pitch turns
 * about the camera's own side axis, yaw about the world's up, so neither
 * leaks a roll into the mouse-look. The field of view is left alone while a
 * portal journey owns it. It springs on the picture's clock, so it holds
 * through a hitstop. */

const DEG = Math.PI / 180;
const X = new Vector3(1, 0, 0);
const UP = new Vector3(0, 1, 0);
const qPitch = new Quaternion();
const qYaw = new Quaternion();
const facing = new Vector3();

/** What this frame laid on the camera (there is one eye). */
const laidOn = { pitch: 0, yaw: 0, fov: false, baseFov: 0 };

/** Something just SET the camera's facing outright (a dev script's lookAt):
 * there's no kick left on it to take off. (Between frames there never is —
 * this only matters for one that lands mid-frame.) */
export function cameraFacingSet(): void {
  laidOn.pitch = 0;
  laidOn.yaw = 0;
}

/** Take what's laid on the camera off it. */
function lift(camera: PerspectiveCamera, l: typeof laidOn): void {
  if (l.pitch !== 0) camera.quaternion.multiply(qPitch.setFromAxisAngle(X, -l.pitch * DEG));
  if (l.yaw !== 0) camera.quaternion.premultiply(qYaw.setFromAxisAngle(UP, -l.yaw * DEG));
  if (l.fov) {
    camera.fov = l.baseFov;
    camera.updateProjectionMatrix();
  }
  l.pitch = 0;
  l.yaw = 0;
  l.fov = false;
}

export function CameraKick() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const k = useMemo(createKick, []);
  const laid = useRef(laidOn);

  useEffect(() => gameEvents.on("castKick", (e) => kickCamera(k, e.pitch, e.yaw, e.fov)), [k]);

  // Take this frame's kick off once it's been drawn.
  useEffect(() => addAfterEffect(() => lift(camera, laid.current)), [camera]);

  // Lay this frame's on.
  useFrame((_, dt) => {
    stepKick(k, presentDt(Math.min(dt, 0.1)));
    const l = laid.current;
    // A frame that threw before its after-effect left its kick on.
    lift(camera, l);
    facing.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const pitch = laidPitch(k.pitch, Math.asin(Math.max(-1, Math.min(1, facing.y))));
    if (pitch !== 0) camera.quaternion.multiply(qPitch.setFromAxisAngle(X, pitch * DEG));
    if (k.yaw !== 0) camera.quaternion.premultiply(qYaw.setFromAxisAngle(UP, k.yaw * DEG));
    l.pitch = pitch;
    l.yaw = k.yaw;
    if (k.fov !== 0 && useTravel.getState().stage === "idle") {
      l.fov = true;
      l.baseFov = camera.fov;
      camera.fov = camera.fov * (1 - k.fov);
      camera.updateProjectionMatrix();
    }
  }, 0.95);

  return null;
}
