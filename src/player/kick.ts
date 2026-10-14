/** The eye's recoil: a heavy spell kicks the view up (and a touch aside) and
 * punches the field of view in, then springs back — a rail is a cannon, a
 * bolt a flick. Damped springs, one per axis, kicked by velocity so the
 * peak lands within a few hundredths of a second and settles in a quarter.
 *
 * Pure; player/CameraKick lays the result over the camera without ever
 * bending the aim (casting reads the camera before it's applied). */

/** Spring: natural frequency (Hz) and damping ratio — snappy, one soft
 * overshoot. */
const FREQ = 5;
const ZETA = 0.7;
const OMEGA = 2 * Math.PI * FREQ;
const OMEGA_D = OMEGA * Math.sqrt(1 - ZETA * ZETA);
/** Peak displacement of the spring per unit of velocity kicked into it
 * (the impulse response's first maximum), so a kick of A peaks at A. */
const T_PEAK = Math.atan(OMEGA_D / (ZETA * OMEGA)) / OMEGA_D;
const PEAK_PER_VELOCITY = (Math.exp(-ZETA * OMEGA * T_PEAK) * Math.sin(OMEGA_D * T_PEAK)) / OMEGA_D;

/** The most the eye may be kicked at once, however kicks stack. */
export const KICK_LIMIT = { pitch: 3, yaw: 1.5, fov: 0.08 } as const;

export interface CameraKick {
  /** Degrees up. */
  pitch: number;
  pitchV: number;
  /** Degrees aside (+ left). */
  yaw: number;
  yawV: number;
  /** Share of the field of view punched in. */
  fov: number;
  fovV: number;
}

export function createKick(): CameraKick {
  return { pitch: 0, pitchV: 0, yaw: 0, yawV: 0, fov: 0, fovV: 0 };
}

/** Kick the eye: up by `pitch`°, aside by `yaw`° (signed), the view in by
 * `fov`. Each lands as its own peak on top of whatever is still ringing. */
export function kickCamera(k: CameraKick, pitch: number, yaw: number, fov: number): void {
  k.pitchV += pitch / PEAK_PER_VELOCITY;
  k.yawV += yaw / PEAK_PER_VELOCITY;
  k.fovV += fov / PEAK_PER_VELOCITY;
}

/** spring()'s result (no tuple per frame). */
let sx = 0;
let sv = 0;

/** Advance one spring `dt` seconds — the exact solution of the damped
 * oscillator, so it rings the same at any frame rate. */
function spring(x: number, v: number, dt: number): void {
  const a = ZETA * OMEGA;
  const decay = Math.exp(-a * dt);
  const c = Math.cos(OMEGA_D * dt);
  const s = Math.sin(OMEGA_D * dt);
  sx = decay * (x * c + ((v + a * x) / OMEGA_D) * s);
  sv = decay * (v * c - ((a * v + OMEGA * OMEGA * x) / OMEGA_D) * s);
}

/** Let the springs ring for `dt` seconds. */
export function stepKick(k: CameraKick, dt: number): void {
  if (dt <= 0) return;
  if (k.pitch === 0 && k.pitchV === 0 && k.yaw === 0 && k.yawV === 0 && k.fov === 0 && k.fovV === 0) return;
  spring(k.pitch, k.pitchV, dt);
  k.pitch = sx;
  k.pitchV = sv;
  spring(k.yaw, k.yawV, dt);
  k.yaw = sx;
  k.yawV = sv;
  spring(k.fov, k.fovV, dt);
  k.fov = sx;
  k.fovV = sv;
  k.pitch = Math.max(-KICK_LIMIT.pitch, Math.min(KICK_LIMIT.pitch, k.pitch));
  k.yaw = Math.max(-KICK_LIMIT.yaw, Math.min(KICK_LIMIT.yaw, k.yaw));
  k.fov = Math.max(-KICK_LIMIT.fov, Math.min(KICK_LIMIT.fov, k.fov));
  // Settled: snap to rest so the camera is left exactly as it was.
  const quiet = (x: number, v: number) => Math.abs(x) < 1e-4 && Math.abs(v) < 1e-3;
  if (quiet(k.pitch, k.pitchV) && quiet(k.yaw, k.yawV) && quiet(k.fov, k.fovV)) {
    k.pitch = k.pitchV = k.yaw = k.yawV = k.fov = k.fovV = 0;
  }
}
