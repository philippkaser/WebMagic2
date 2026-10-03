import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Quaternion, Vector3 } from "three";
import { playerVelocity } from "../../../game/player-state";

/** How the HUD's carrier — you — is moving, in view space, sampled once per
 * frame: the push a liquid in a flask you carry would feel.
 *
 *  - Turning: the flask swings with your gaze; its liquid lags behind.
 *  - Running, stopping, strafing: the liquid piles up against the far wall.
 *  - Landing a jump: a jolt that sets the surface rippling.
 *
 * Returns a ref whose fields are rewritten every frame (no allocation). The
 * pushes are accelerations in slope units per s² for gauge.ts#stepSlosh. */
export interface CarrierMotion {
  /** Push on the surface slope along view x / z. */
  fx: number;
  fz: number;
  /** A vertical jolt this frame (0 = none), 0..1. */
  jolt: number;
}

const tmpQ = new Quaternion();
const rel = new Quaternion();
const invQ = new Quaternion();
const acc = new Vector3();

export function useCarrierMotion() {
  const motion = useRef<CarrierMotion>({ fx: 0, fz: 0, jolt: 0 });
  const state = useRef({ init: false, prevV: new Vector3(), ax: 0, az: 0, wx: 0, wy: 0, prevQ: new Quaternion() });

  useFrame(({ camera }, rawDt) => {
    const s = state.current;
    const m = motion.current;
    const dt = Math.max(1 / 240, Math.min(rawDt, 0.1));
    if (!s.init) {
      s.init = true;
      s.prevQ.copy(camera.quaternion);
      s.prevV.copy(playerVelocity);
      return;
    }
    // Angular velocity in the camera's own frame: prev⁻¹ · current.
    rel.copy(tmpQ.copy(s.prevQ).invert()).multiply(camera.quaternion);
    if (rel.w < 0) rel.set(-rel.x, -rel.y, -rel.z, -rel.w);
    const wx = (rel.x * 2) / dt;
    const wy = (rel.y * 2) / dt;
    s.prevQ.copy(camera.quaternion);
    // Linear acceleration, world → view.
    acc.copy(playerVelocity).sub(s.prevV).divideScalar(dt);
    s.prevV.copy(playerVelocity);
    invQ.copy(camera.quaternion).invert();
    acc.applyQuaternion(invQ);
    // Physics steps make raw accelerations spiky: low-pass them.
    const k = 1 - Math.exp(-dt * 12);
    s.ax += (Math.max(-60, Math.min(60, acc.x)) - s.ax) * k;
    s.az += (Math.max(-60, Math.min(60, acc.z)) - s.az) * k;
    s.wx += (Math.max(-8, Math.min(8, wx)) - s.wx) * k;
    s.wy += (Math.max(-8, Math.min(8, wy)) - s.wy) * k;
    // Turning right (wy < 0) swings the flask right; the liquid lags left,
    // so the surface rises on the left: a negative slope along x.
    m.fx = s.wy * 5 - s.ax * 0.5;
    m.fz = -s.wx * 2.5 - s.az * 0.5;
    m.jolt = acc.y > 25 ? Math.min(1, acc.y / 80) : 0;
  }, -40);

  return motion;
}
