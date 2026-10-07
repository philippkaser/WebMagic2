/** GLSL shared by the post effects. */
export const POST_GLSL = /* glsl */ `
float postLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

/** Interleaved gradient noise (Jimenez) in [0, 1): a per-pixel offset with
 * no visible pattern, for rotating sample spirals. */
float postNoise(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
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

/** Bicubic (B-spline) sampling in four bilinear taps (Sigg & Hadwiger):
 * a low-resolution layer of light or blur upsampled with no blocks and no
 * bilinear diamonds — soft light over the crisp pixels. */
vec4 postBicubic(sampler2D tex, vec2 uv, vec2 size) {
  vec2 st = uv * size - 0.5;
  vec2 i = floor(st);
  vec2 f = st - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 / 6.0) * (-f3 + 3.0 * f2 - 3.0 * f + 1.0);
  vec2 w1 = (1.0 / 6.0) * (3.0 * f3 - 6.0 * f2 + 4.0);
  vec2 w2 = (1.0 / 6.0) * (-3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0);
  vec2 w3 = (1.0 / 6.0) * f3;
  vec2 s0 = w0 + w1;
  vec2 s1 = w2 + w3;
  vec2 c0 = (i - 0.5 + w1 / s0) / size;
  vec2 c1 = (i + 1.5 + w3 / s1) / size;
  return (texture2D(tex, vec2(c0.x, c0.y)) * s0.x + texture2D(tex, vec2(c1.x, c0.y)) * s1.x) * s0.y
       + (texture2D(tex, vec2(c0.x, c1.y)) * s0.x + texture2D(tex, vec2(c1.x, c1.y)) * s1.x) * s1.y;
}
`;
