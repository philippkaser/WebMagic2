import { FX_LIGHT_COUNT } from "./fxUniforms";

/** GLSL shared by the fx shaders. Everything is procedural — no textures —
 * per the zero-binary-assets rule. */

/** The pixel grid. The world renders at dpr 0.35, so one render-target pixel
 * is a ~3-px block on screen: an fx sprite that straddles pixels smears into
 * a soft blob, one that sits ON the grid reads as deliberate pixel art. So
 * sprite quads are snapped: the centre goes to a pixel centre (odd widths)
 * or a pixel corner (even widths), the half-width is a whole number of
 * pixels, and the fragment shader then draws with exact integer offsets.
 * `uViewport` is the render target's size in pixels (FxSystems keeps it). */
export const PIXEL_GLSL = /* glsl */ `
uniform vec2 uViewport;

/** Clip position of one corner (±1) of a grid-aligned quad around the
 * projected centre clipC, ext pixels from centre to edge (a multiple
 * of 0.5). Varyings written as corner * ext then interpolate to exact
 * pixel-centre offsets from the centre. */
vec4 fxPixelCorner(vec4 clipC, float ext, vec2 corner) {
  vec2 pix = (clipC.xy / clipC.w * 0.5 + 0.5) * uViewport;
  bool odd = mod(ext * 2.0 + 0.5, 2.0) > 1.0;
  vec2 c = odd ? floor(pix) + 0.5 : floor(pix + 0.5);
  vec2 p = c + corner * ext;
  return vec4((p / uViewport * 2.0 - 1.0) * clipC.w, clipC.z, clipC.w);
}

/** Render-target pixels per metre at a given view depth (vertical, so it
 * holds for any aspect). */
float fxPxPerUnit(float depth) {
  return projectionMatrix[1][1] * uViewport.y * 0.5 / max(depth, 0.05);
}
`;

/** Ordered dithering: fades are done by DROPPING pixels in a 4×4 Bayer
 * pattern instead of blending alpha, so everything stays hard-edged and
 * opaque (the classic pixel-art dissolve) — and, as a bonus, dithered pixels
 * can write depth, so solid particles sort among themselves per pixel. */
export const DITHER_GLSL = /* glsl */ `
float fxBayer2(vec2 a) { return mod(3.0 * a.y + 2.0 * a.x, 4.0); }
/** 4×4 ordered-dither threshold in (0, 1) for a pixel coordinate. */
float fxBayer4(vec2 p) {
  vec2 q = floor(p);
  return (4.0 * fxBayer2(mod(q, 2.0)) + fxBayer2(mod(floor(q * 0.5), 2.0)) + 0.5) / 16.0;
}
float fxHash1(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
`;

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
