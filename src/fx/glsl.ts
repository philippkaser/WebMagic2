import { FX_LIGHT_COUNT } from "./fxUniforms";

/** GLSL shared by the fx shaders. Everything is procedural — no textures —
 * per the zero-binary-assets rule. */

/** Point-light accumulation for lit particles, evaluated per VERTEX (a
 * particle is a few pixels at dpr 0.35 — per-fragment would buy nothing).
 * The falloff mirrors three's punctual-light window (1 − (d/range)⁴)² / d²,
 * scaled by 1/π like a Lambert surface so a lit puff matches the lit wall
 * behind it. The staff light rides at the camera. */
export const LIGHTING_GLSL = /* glsl */ `
uniform vec4 uLightPos[${FX_LIGHT_COUNT}];
uniform vec3 uLightCol[${FX_LIGHT_COUNT}];
uniform vec3 uAmbientLight;
uniform vec4 uStaffLight;

float fxWindow(float d, float range) {
  float x = d / max(range, 0.001);
  float w = clamp(1.0 - x * x * x * x, 0.0, 1.0);
  return w * w / max(d * d, 0.35);
}

vec3 fxLighting(vec3 p) {
  vec3 acc = uAmbientLight;
  float dc = distance(p, cameraPosition);
  acc += uStaffLight.rgb * fxWindow(dc, uStaffLight.w) * 0.35;
  for (int i = 0; i < ${FX_LIGHT_COUNT}; i++) {
    vec3 c = uLightCol[i];
    if (c.r + c.g + c.b <= 0.0) continue;
    vec4 lp = uLightPos[i];
    acc += c * fxWindow(distance(p, lp.xyz), lp.w);
  }
  return acc * 0.3183;
}
`;

/** Cheap value noise + 3-octave fbm (smoke puffs, flames). */
export const NOISE_GLSL = /* glsl */ `
float fxHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float fxNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fxHash(i), fxHash(i + vec2(1.0, 0.0)), f.x),
             mix(fxHash(i + vec2(0.0, 1.0)), fxHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fxFbm(vec2 p) {
  float v = 0.5 * fxNoise(p);
  v += 0.25 * fxNoise(p * 2.03 + 17.1);
  v += 0.125 * fxNoise(p * 4.01 + 5.3);
  return v / 0.875;
}
`;

/** Fog factor from three's fog uniforms (declared by <fog_pars_fragment>).
 * Additive light fades OUT with fog (it's light scattered away), while
 * alpha-blended matter fades TOWARD the fog colour — see fxApplyFog. */
export const FOG_GLSL = /* glsl */ `
float fxFogFactor() {
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      return 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      return smoothstep(fogNear, fogFar, vFogDepth);
    #endif
  #else
    return 0.0;
  #endif
}
/** Premultiplied output with fog applied: additive = 1 → pure light (alpha
 * 0, so the blend adds it); additive = 0 → ordinary "over" compositing. */
vec4 fxApplyFog(vec3 col, float a, float additive) {
  float f = fxFogFactor();
  #ifdef USE_FOG
    col = mix(col, fogColor, f * (1.0 - additive));
  #endif
  col *= 1.0 - f * additive;
  return vec4(col * a, a * (1.0 - additive));
}
`;
