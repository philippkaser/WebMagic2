/** GLSL shared by the post effects. The world renders at dpr 0.35 and is
 * upscaled without filtering, so one render-target pixel (gl_FragCoord) is a
 * ~3-px block on screen: the post chain works on that grid — its dither, its
 * grain and its outlines are pixel art, not screen-resolution fuzz. */
export const POST_GLSL = /* glsl */ `
float postLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

/** 4×4 ordered-dither threshold in (0, 1) — the same matrix the god rays
 * and the dithered particles use, so every stepped thing shares one grid. */
float postBayer(vec2 p) {
  vec2 m = mod(floor(p), 4.0);
  int i = int(m.x) + int(m.y) * 4;
  float b[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (b[i] + 0.5) / 16.0;
}

/** Integer hash (pcg3d) → [0, 1): no sin(), so it holds up at large
 * coordinates and on every GPU, and shows no pattern in the grain. */
float postHash(vec3 p) {
  uvec3 v = uvec3(ivec3(floor(p))) * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return float(v.x) * (1.0 / 4294967296.0);
}

/** Exact sRGB transfer both ways (the output encode is exact, so anything
 * quantized in sRGB must round-trip through the same curve). */
vec3 postToSRGB(vec3 c) {
  c = max(c, 0.0);
  return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
}
vec3 postFromSRGB(vec3 c) {
  c = max(c, 0.0);
  return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, vec3(lessThanEqual(c, vec3(0.04045))));
}
`;
