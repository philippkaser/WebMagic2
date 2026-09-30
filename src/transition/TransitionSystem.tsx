import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Euler, Matrix4, Mesh, PerspectiveCamera, PlaneGeometry, Quaternion, Vector2, Vector3 } from "three";
import {
  playDeathFade,
  playFeatherLift,
  playPortalArrive,
  playPortalEnter,
  playRespawnRise,
  startTunnelRush,
} from "../audio/sound";
import { PLAYER } from "../core/config";
import { flashLight } from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { playerPosition } from "../game/player-state";
import { nearestPortalAnchor } from "./portals";
import { getTravelFreeze, useTravel } from "./store";
import {
  TRAVEL_STYLES,
  newCameraFx,
  newOverlayFx,
  sampleCamera,
  sampleOverlay,
  smoothstep,
  stageProgress,
  type TravelKind,
  type TravelStage,
  type TravelStyle,
} from "./timeline";
import { markTravelFrame } from "./travel";
import { createVortexMaterial } from "./vortexMaterial";

/** The tunnel's lens relative to the camera's (see uTanHalf). */
const TUNNEL_LENS = 0.8;
/** Portal ring radius (m) — the ENTER iris starts at its on-screen size. */
const RING_RADIUS = 1.05;
const UP = new Vector3(0, 1, 0);
/** Feet below the capsule centre (the capsule's half-height + radius). */
const FEET = PLAYER.halfHeight + PLAYER.radius - 0.05;

/** Plays the journeys (transition/travel.ts) on screen and in the ears.
 *
 * Camera: runs at useFrame priority −1.5 — after the PlayerController (−2)
 * has placed the camera for the frame, before the staff viewmodel (−1) copies
 * it — and layers the travel's FOV, roll, pull and lift on top without
 * touching the controller. Roll is re-applied from scratch every frame (last
 * frame's is undone first) so it can never leak into the mouse-look; the base
 * FOV is captured when a journey starts and restored exactly when it ends.
 *
 * Overlay: one fullscreen vortex quad (vortexMaterial.ts) in the world scene,
 * so the post chain's bloom feeds on the tunnel's light like any emissive.
 *
 * Side effects on stage changes: the whoosh, the tunnel's rush loop, the
 * arrival thump, particle bursts and light flashes. */
export function TransitionSystem() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const material = useMemo(createVortexMaterial, []);
  const geometry = useMemo(() => new PlaneGeometry(1, 1), []);
  const mesh = useRef<Mesh>(null);
  const cam = useRef({
    owning: false,
    baseFov: 78,
    roll: 0,
    lastStage: "idle" as TravelStage,
    lastKind: "descend" as TravelKind,
    styledKind: null as TravelKind | null,
    /** Where the vortex centre was when ENTER ended (screen units). */
    enterCenter: new Vector2(),
    /** The position offset applied last frame, and where it left the camera
     * — if the controller skipped a frame (no body yet during a scene swap),
     * the offset is taken back out instead of accumulating. */
    offset: new Vector3(),
    after: new Vector3(),
    applied: false,
    stopRush: null as null | (() => void),
  });
  const scratch = useMemo(
    () => ({
      fx: newCameraFx(),
      ov: newOverlayFx(),
      focus: new Vector3(),
      v: new Vector3(),
      m: new Matrix4(),
      q: new Quaternion(),
      e: new Euler(0, 0, 0, "YXZ"),
    }),
    [],
  );

  useEffect(() => {
    const c = cam.current;
    // Dev-only: lets scripts check the FOV comes back exactly.
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__cameraFov = () => camera.fov;
    return () => {
      c.stopRush?.();
      c.stopRush = null;
      if (c.roll !== 0) camera.rotateZ(-c.roll);
      c.roll = 0;
      if (c.owning) {
        camera.fov = c.baseFov;
        camera.updateProjectionMatrix();
        c.owning = false;
      }
      material.dispose();
      geometry.dispose();
    };
  }, [camera, material, geometry]);

  useFrame((state, dt) => {
    markTravelFrame();
    const c = cam.current;
    const { fx, ov } = scratch;
    const live = useTravel.getState();
    const frozen = getTravelFreeze();
    const stage = frozen ? frozen.stage : live.stage;
    const kind = frozen ? frozen.kind : live.kind;
    const style = TRAVEL_STYLES[kind];
    const p = frozen ? frozen.progress : stageProgress(live.stageStart, live.stageMs, performance.now());
    if (!frozen && stage !== "idle" && live.progress !== p) useTravel.setState({ progress: p });

    if (!frozen && (stage !== c.lastStage || kind !== c.lastKind)) {
      onStage(stage, kind, style, c, live.focus);
      c.lastStage = stage;
      c.lastKind = kind;
    }

    // Undo last frame's roll (and a stale offset) before anything reads the
    // camera.
    if (c.roll !== 0) {
      camera.rotateZ(-c.roll);
      c.roll = 0;
    }
    if (c.applied && camera.position.equals(c.after)) camera.position.sub(c.offset);
    c.applied = false;
    if (stage === "idle") {
      if (c.owning) {
        camera.fov = c.baseFov;
        camera.updateProjectionMatrix();
        c.owning = false;
      }
      if (mesh.current) mesh.current.visible = false;
      return;
    }
    if (!c.owning) {
      c.baseFov = camera.fov;
      c.owning = true;
    }

    // ── Camera ────────────────────────────────────────────────────────────
    sampleCamera(stage, p, style, fx);
    let hasFocus = false;
    if (frozen) {
      const a = style.look === "portal" && kind !== "feather"
        ? nearestPortalAnchor(playerPosition.x, playerPosition.z, 6)
        : null;
      if (a) {
        scratch.focus.set(a.x, a.y, a.z);
        hasFocus = true;
      }
    } else if (live.focus) {
      scratch.focus.set(live.focus[0], live.focus[1], live.focus[2]);
      hasFocus = true;
    }
    if (hasFocus && (stage === "entering" || stage === "tunnel")) {
      // The portal grabs your gaze: turn toward its heart (for good — this
      // is a real turn, not an effect layer), then get dragged in. Only
      // during ENTER: once the tunnel covers the view the scene may switch,
      // and the old portal's coordinates mean nothing in the new place.
      if (stage === "entering" && fx.aim > 0) {
        scratch.m.lookAt(camera.position, scratch.focus, UP);
        scratch.q.setFromRotationMatrix(scratch.m);
        camera.quaternion.slerp(scratch.q, 1 - Math.exp(-Math.min(dt, 0.1) * 7 * fx.aim));
        // Keep the horizon level: the only roll is the one undone next frame.
        scratch.e.setFromQuaternion(camera.quaternion, "YXZ");
        scratch.e.z = 0;
        camera.quaternion.setFromEuler(scratch.e);
      }
      scratch.v.subVectors(scratch.focus, camera.position);
      const dist = scratch.v.length();
      c.offset.set(0, 0, 0);
      if (dist > 0.01) c.offset.addScaledVector(scratch.v, Math.min(fx.pull, Math.max(0, dist - 0.35)) / dist);
    } else {
      camera.getWorldDirection(c.offset);
      c.offset.multiplyScalar(fx.pull * 0.4);
    }
    c.offset.y += fx.lift;
    camera.position.add(c.offset);
    c.after.copy(camera.position);
    c.applied = true;
    const fov = c.baseFov * fx.fovMult;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    if (fx.roll !== 0) {
      camera.rotateZ(fx.roll);
      c.roll = fx.roll;
    }

    // ── Overlay ───────────────────────────────────────────────────────────
    sampleOverlay(stage, p, style, ov);
    const m = mesh.current;
    if (!m) return;
    m.visible = ov.cover > 0;
    if (!m.visible) return;
    const u = material.uniforms;
    if (c.styledKind !== kind) {
      c.styledKind = kind;
      u.uColor.value.set(style.color);
      u.uHot.value.set(style.hot);
      u.uDeep.value.set(style.deep);
      u.uSpinDir.value = style.roll < 0 ? -1 : 1;
      u.uSpin.value = style.spin;
      u.uSpeed.value = style.speed;
      u.uStreaks.value = style.streaks;
      u.uRings.value = style.rings;
      u.uFeathers.value = style.feathers;
      u.uLook.value = style.look === "dissolve" ? 1 : 0;
    }
    const t = frozen?.time ?? state.clock.elapsedTime;
    const aspect = size.width / Math.max(1, size.height);
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
    u.uTime.value = t;
    u.uAspect.value = aspect;
    // A touch narrower than the camera: the tube reads deeper, and still
    // stretches along with the view's FOV kick.
    u.uTanHalf.value = tanHalf * TUNNEL_LENS;
    u.uRoll.value = fx.roll;

    // Where the vortex sits on screen (aspect-corrected half-height units):
    // on the portal during ENTER, drifting to the centre in the tunnel, with
    // a slow wander that makes the tube feel like it bends.
    const wander = stage === "tunnel" ? 1 : stage === "arriving" ? 1 - p : 0;
    const wx = Math.sin(t * 0.9) * 0.07 * wander;
    const wy = Math.cos(t * 0.67) * 0.05 * wander;
    let r0 = 0;
    if (stage === "entering") {
      c.enterCenter.set(0, 0);
      if (hasFocus) {
        scratch.v.copy(scratch.focus).project(camera);
        if (scratch.v.z < 1 && Math.abs(scratch.v.x) < 1.6 && Math.abs(scratch.v.y) < 1.6) {
          c.enterCenter.set(scratch.v.x * aspect, scratch.v.y);
          const dist = camera.position.distanceTo(scratch.focus);
          r0 = RING_RADIUS / Math.max(0.3, dist) / tanHalf;
        }
      }
      u.uCenter.value.copy(c.enterCenter);
    } else if (stage === "tunnel") {
      const k = 1 - smoothstep(0, 0.7, p);
      u.uCenter.value.set(c.enterCenter.x * k + wx, c.enterCenter.y * k + wy);
    } else {
      u.uCenter.value.set(wx, wy);
    }
    const cx = u.uCenter.value.x;
    const cy = u.uCenter.value.y;
    const farCorner = Math.hypot(aspect + Math.abs(cx), 1 + Math.abs(cy));
    u.uIrisR.value = r0 + (farCorner * 1.15 - r0) * ov.iris;
    u.uRevealR.value = ov.reveal * Math.hypot(aspect, 1) * 1.2;
    u.uRing.value = ov.ring;
    u.uSwirl.value = ov.swirl;
    u.uDissolve.value = ov.dissolve;
    u.uDark.value = ov.dark;
    u.uFlash.value = ov.flash;
    u.uFade.value = ov.fade;
  }, -1.5);

  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={10000}
      visible={false}
    />
  );
}

/** Sounds, bursts and flashes on each stage change. */
function onStage(
  stage: TravelStage,
  kind: TravelKind,
  style: TravelStyle,
  c: { stopRush: null | (() => void) },
  focus: [number, number, number] | null,
): void {
  const bright = kind === "home" || kind === "feather" ? 1 : kind === "respawn" ? 0.7 : 0.2;
  const feet: [number, number, number] = [playerPosition.x, playerPosition.y - FEET, playerPosition.z];
  switch (stage) {
    case "entering":
      c.stopRush?.();
      c.stopRush = null;
      if (style.look === "dissolve") {
        playDeathFade();
        spawnBurst({
          position: [playerPosition.x, playerPosition.y, playerPosition.z],
          count: 26,
          color: [style.color, "#5a0a06", "#1a0204"],
          speed: 1.6,
          upward: 1.4,
          ttl: 1.4,
          size: 0.07,
          gravity: 1.5,
          drag: 1.2,
        });
      } else if (style.look === "fromDark") {
        playRespawnRise();
      } else if (kind === "feather") {
        playFeatherLift();
        // Feathers loosen around you and drift up with you.
        spawnBurst({
          position: [playerPosition.x, playerPosition.y + 0.2, playerPosition.z],
          count: 34,
          color: [style.color, style.hot, "#d9b877"],
          speed: 2.2,
          upward: 1.2,
          ttl: 1.6,
          size: 0.08,
          gravity: 1.2,
          drag: 2.2,
        });
        flashLight([playerPosition.x, playerPosition.y + 1, playerPosition.z], style.color, 14, 9);
      } else {
        playPortalEnter(bright);
        if (focus) {
          // The ring erupts as it swallows you.
          spawnBurst({
            position: focus,
            count: 36,
            color: [style.color, style.hot],
            speed: 5,
            upward: 0.4,
            ttl: 0.8,
            size: 0.08,
            gravity: 0,
            drag: 2.4,
          });
          flashLight(focus, style.color, 30, 14);
        }
      }
      return;
    case "tunnel":
      c.stopRush?.();
      c.stopRush =
        style.look === "dissolve"
          ? startTunnelRush(36, 0.15)
          : startTunnelRush(kind === "home" || kind === "feather" ? 65 : 49, style.speed);
      return;
    case "arriving":
      c.stopRush?.();
      c.stopRush = null;
      if (style.look === "dissolve") return; // the death screen takes it from here
      playPortalArrive(bright);
      spawnBurst({
        position: feet,
        count: 48,
        color: [style.color, style.hot],
        speed: 6,
        upward: 1.2,
        ttl: 0.9,
        size: 0.09,
        gravity: -5,
        drag: 2,
      });
      flashLight([feet[0], feet[1] + 0.6, feet[2]], style.color, 34, 13);
      return;
    case "idle":
      c.stopRush?.();
      c.stopRush = null;
      return;
  }
}
