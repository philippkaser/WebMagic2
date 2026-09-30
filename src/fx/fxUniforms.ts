import { Color, Vector3, Vector4 } from "three";

/** Uniforms shared by every fx shader (particles, flames, ambient volumes).
 *
 * They are shared *objects*: each fx material spreads these exact uniform
 * objects into its own uniforms, so one write per frame (DynamicLights for the
 * light pool, FxSystems for time and viewport) reaches every material with no
 * per-material bookkeeping.
 *
 * Lighting: smoke, dust and debris are lit by the same pooled point lights as
 * the walls — DynamicLights copies each pool slot's position, range and
 * colour×intensity here after it assigns sources. That's what makes a dust
 * mote flare as it drifts past a torch, and a barrel's smoke glow orange
 * from its own blast flash, for the price of a small uniform array. */

/** Must equal DynamicLights' pool size (it imports this). */
export const FX_LIGHT_COUNT = 14;

/** The player's personal staff light (StaffView): warm, strong, near the
 * camera. Mirrored here as a constant so fx shaders don't depend on the
 * viewmodel — the particle shaders place it at the camera. */
const STAFF_LIGHT = { color: "#ffb877", intensity: 26, range: 17 };

const staffColor = new Color(STAFF_LIGHT.color);

export const fxUniforms = {
  /** xyz position, w cutoff distance, per pool slot. */
  uLightPos: { value: new Float32Array(FX_LIGHT_COUNT * 4) },
  /** Linear colour × intensity per pool slot (0 = slot unused). */
  uLightCol: { value: new Float32Array(FX_LIGHT_COUNT * 3) },
  /** Floor of lighting for lit particles, so smoke never goes pure black. */
  uAmbientLight: { value: new Vector3(0.05, 0.05, 0.065) },
  /** rgb = colour × intensity, w = range. */
  uStaffLight: {
    value: new Vector4(
      staffColor.r * STAFF_LIGHT.intensity,
      staffColor.g * STAFF_LIGHT.intensity,
      staffColor.b * STAFF_LIGHT.intensity,
      STAFF_LIGHT.range,
    ),
  },
  /** Seconds, wrapped to keep float precision (shader animation only). */
  uTime: { value: 0 },
  /** Drawing-buffer height in pixels — for the minimum-pixel-size rule. */
  uViewportH: { value: 210 },
  /** Smallest on-screen particle, in (low-res) pixels. */
  uMinPx: { value: 1.6 },
};

/** Current light-pool slot data, exported for tests/debug overlays. */
export function setFxLightSlot(
  i: number,
  pos: Vector3 | null,
  range: number,
  r: number,
  g: number,
  b: number,
): void {
  const p = fxUniforms.uLightPos.value;
  const c = fxUniforms.uLightCol.value;
  if (!pos) {
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = 0;
    return;
  }
  p[i * 4] = pos.x;
  p[i * 4 + 1] = pos.y;
  p[i * 4 + 2] = pos.z;
  p[i * 4 + 3] = range;
  c[i * 3] = r;
  c[i * 3 + 1] = g;
  c[i * 3 + 2] = b;
}
