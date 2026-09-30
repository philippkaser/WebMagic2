/** GLSL shared by the portal disc (render/models/PortalModel) and the travel
 * overlay (TransitionSystem): the two are deliberately drawn in the same
 * vortex language, so the ENTER iris reads as the portal itself growing over
 * the view rather than a second, unrelated effect.
 *
 * Cheap value noise only (a few hashes per octave, no textures — the
 * zero-binary-asset rule) and a PERIODIC variant for polar coordinates: noise
 * sampled on (angle × N, …) with period N tiles seamlessly around the circle,
 * so there is no seam where atan() wraps. */
export const VORTEX_NOISE_GLSL = /* glsl */ `
float vxHash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float vxHash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vxNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = vxHash21(i);
  float b = vxHash21(i + vec2(1.0, 0.0));
  float c = vxHash21(i + vec2(0.0, 1.0));
  float d = vxHash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
/** Value noise periodic in x with integer period per. */
float vxNoiseP(vec2 p, float per) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, per);
  float x1 = mod(i.x + 1.0, per);
  float a = vxHash21(vec2(x0, i.y));
  float b = vxHash21(vec2(x1, i.y));
  float c = vxHash21(vec2(x0, i.y + 1.0));
  float d = vxHash21(vec2(x1, i.y + 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
/** Three octaves, normalised to ~0…1. */
float vxFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * vxNoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s / 0.875;
}
/** Periodic fbm: the period doubles with the frequency, so every octave tiles. */
float vxFbmP(vec2 p, float per) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * vxNoiseP(p, per);
    p = vec2(p.x * 2.0, p.y * 2.03 + 17.1);
    per *= 2.0;
    a *= 0.5;
  }
  return s / 0.875;
}
`;
