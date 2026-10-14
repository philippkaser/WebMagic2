import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Quaternion, Vector3, type PerspectiveCamera } from "three";
import { gameEvents } from "../core/events";
import { presentDt } from "../core/presentTime";
import { useTravel } from "../transition/store";
import { createKick, kickCamera, stepKick } from "./kick";

/** The eye's recoil (player/kick): a heavy spell kicks the view up and a
 * touch aside and punches it in; your kills breathe it in a little.
 *
 * Laid over the camera AFTER the cast has read its aim (CastingSystem, at
 * priority 0) and before the picture is drawn (the post chain, at 1) — so
 * recoil never bends a shot — and taken off again at the start of the next
 * frame (−2.5), before the controller (−2) or anything else reads the
 * camera: the TransitionSystem's undo-last-frame pattern. Pitch turns about
 * the camera's own side axis, yaw about the world's up, so neither leaks a
 * roll into the mouse-look. The field of view is left alone while a portal
 * journey owns it. It springs on the picture's clock, so it holds through
 * a hitstop. */

const DEG = Math.PI / 180;
const X = new Vector3(1, 0, 0);
const UP = new Vector3(0, 1, 0);
const qPitch = new Quaternion();
const qYaw = new Quaternion();

export function CameraKick() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const k = useMemo(createKick, []);
  const laid = useRef({ pitch: 0, yaw: 0, fov: false, baseFov: 0 });

  useEffect(() => gameEvents.on("castKick", (e) => kickCamera(k, e.pitch, e.yaw, e.fov)), [k]);

  // Take last frame's kick off.
  useFrame(() => {
    const l = laid.current;
    if (l.pitch !== 0) camera.quaternion.multiply(qPitch.setFromAxisAngle(X, -l.pitch * DEG));
    if (l.yaw !== 0) camera.quaternion.premultiply(qYaw.setFromAxisAngle(UP, -l.yaw * DEG));
    if (l.fov) {
      camera.fov = l.baseFov;
      camera.updateProjectionMatrix();
    }
    l.pitch = 0;
    l.yaw = 0;
    l.fov = false;
  }, -2.5);

  // Lay this frame's on.
  useFrame((_, dt) => {
    stepKick(k, presentDt(Math.min(dt, 0.1)));
    const l = laid.current;
    if (k.pitch !== 0) camera.quaternion.multiply(qPitch.setFromAxisAngle(X, k.pitch * DEG));
    if (k.yaw !== 0) camera.quaternion.premultiply(qYaw.setFromAxisAngle(UP, k.yaw * DEG));
    l.pitch = k.pitch;
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
