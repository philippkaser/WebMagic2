import {
  BoxGeometry,
  CustomBlending,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
} from "three";
import { fxUniforms } from "./fxUniforms";
import { DITHER_GLSL, FOG_GLSL, LIGHTING_GLSL, NOISE_GLSL, PIXEL_GLSL } from "./glsl";
import { INSTANCE_VEC, SHAPE } from "./particleSim";

/** The one material every particle is drawn with — in the game's pixel-magic
 * look: crisp, hard-edged chunks of colour on the render target's pixel grid
 * that glow through bloom, never soft blobs.
 *
 * Each instance is a unit CUBE (24 vertices). What the vertex shader does
 * with it depends on the particle:
 *
 * - A chunk big enough on screen (≥ uCubePx) is a real little cube, rotated
 *   by its tumble angle about a per-particle axis, faces shaded in three
 *   stepped tones, back faces collapsed. Debris tumbles and catches the
 *   light like the old instanced-box particles did.
 * - Everything else is a SPRITE drawn with only the cube's front (+z) face,
 *   the other five collapsed to nothing: a quad snapped to the pixel grid
 *   (glsl.ts#PIXEL_GLSL) whose size is a whole number of pixels, so the
 *   fragment shader draws with exact integer pixel offsets — squares with a
 *   1-px rim, stepped octagon glows, chains of pixels for sparks, Bresenham-
 *   ish rings, plus-shaped star flares.
 *
 * Fades never blend. Tiny sprites pop out whole at a per-particle moment,
 * glows and flares burn down in whole pixels, rings dim in steps and drop
 * dashes, smoke erodes and dissolves in a chunky ordered dither — so every
 * fragment is either fully opaque or pure added light. Premultiplied
 * blending (src ONE, dst ONE_MINUS_SRC_ALPHA) lets one draw call hold both:
 * the shader outputs alpha 1 for solid pixels and alpha 0 for light (glow
 * rims, flares, rings), per FRAGMENT. Solid pixels write depth, so they sort
 * among themselves per pixel with no CPU sorting.
 *
 * Instance attributes (see particleSim.InstanceArrays):
 *   aPosSize  xyz, w = half-extent (m)
 *   aColor    linear rgb (HDR) + alpha (drives the dither)
 *   aAxis     xyz = velocity (streaks) / plane normal (rings), w = stretch
 *             seconds for streaks, else a per-particle seed
 *   aMisc     x shape, y additive, z rotation (rings: band thickness;
 *             streaks: seed), w lit */

/** Shape id the vertex shader hands the fragment shader for a real cube face
 * and for a ring lying in a world plane (neither is a SHAPE of its own). */
const CUBE_FACE = 6;
const PLANE_RING = 7;

const VERT = /* glsl */ `
attribute vec4 aPosSize;
attribute vec4 aColor;
attribute vec4 aAxis;
attribute vec4 aMisc;

uniform float uCubePx;

/** Pixel offset from the sprite's snapped centre (cube faces: face uv ±1). */
varying vec2 vQ;
varying vec4 vColor;
/** x shape, y additive, z core size in whole pixels, w seed. */
varying vec4 vInfo;
/** Shape parameters (see each branch below). */
varying vec4 vInfo2;

#include <fog_pars_vertex>
${LIGHTING_GLSL}
${PIXEL_GLSL}

vec3 fxRotate(vec3 v, vec3 k, float a) {
  float c = cos(a);
  float s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

void main() {
  vec3 center = aPosSize.xyz;
  float size = aPosSize.w;
  float shape = aMisc.x;
  float alpha = aColor.a;
  vec3 rgb = aColor.rgb;
  bool isStreak = abs(shape - ${SHAPE.streak}.0) < 0.5;
  bool isRing = abs(shape - ${SHAPE.ring}.0) < 0.5;
  bool isChunk = abs(shape - ${SHAPE.chunk}.0) < 0.5;
  bool oriented = isRing && dot(aAxis.xyz, aAxis.xyz) > 0.0001;
  float seed = isStreak ? aMisc.z : aAxis.w;

  vec4 mvCenter = modelViewMatrix * vec4(center, 1.0);
  float depth = max(-mvCenter.z, 0.05);
  float px = size * fxPxPerUnit(depth);   // half-extent in pixels

  bool cube = isChunk && px * 2.0 >= uCubePx;
  if (!cube && normal.z < 0.5) {
    // Sprites use only the front face; the rest collapse off-screen.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  // Point-blank guard. Effects happen in your face — a blast-jump puts the
  // fireball at your feet, a slime dies on your boots — and a sprite filling
  // the view blanks the whole screen. So sprites dissolve in the last
  // half-metre before the eye, and one bigger than ~40% of the screen gives
  // back the coverage its extra area would add. (World-oriented rings are
  // thin bands lying in the world — exempt.)
  if (!oriented) {
    alpha *= smoothstep(0.1, 0.55, depth);
    float bigPx = uViewport.y * 0.2;
    if (px > bigPx && !isRing) alpha *= bigPx / px;
  }
  if (aMisc.w > 0.0) rgb *= mix(vec3(1.0), fxLighting(center), aMisc.w);

  // Core size in whole pixels, never below one. A particle smaller than a
  // pixel keeps its one pixel but is dithered out by its coverage — a
  // steady subset of distant sparks shows, instead of all of them
  // shimmering as they cross pixel centres.
  float N = max(1.0, floor(2.0 * px + 0.5));
  if (2.0 * px < 1.0) alpha *= max(2.0 * px, 0.08);

  vec4 mvPosition = mvCenter;
  vec2 corner = position.xy;
  float outShape = shape;
  vInfo2 = vec4(0.0);

  if (cube) {
    // A real tumbling cube: axis from the seed, angle from the simulation's
    // spin. Back faces are culled HERE (the material is double-sided for
    // the floor rings) by testing the face centre against the eye.
    vec3 k = normalize(vec3(fract(seed * 7.13), fract(seed * 3.71), fract(seed * 5.37)) - 0.5 + 0.001);
    vec3 n = fxRotate(normal, k, aMisc.z);
    vec3 nV = normalize(mat3(modelViewMatrix) * n);
    vec3 faceV = (modelViewMatrix * vec4(center + n * size, 1.0)).xyz;
    if (dot(nV, faceV) >= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    mvPosition = modelViewMatrix * vec4(center + fxRotate(position, k, aMisc.z) * size, 1.0);
    // Three stepped face tones from a fixed key light (up, left, toward
    // the eye): the read of a voxel, not of smooth shading.
    float key = dot(nV, normalize(vec3(-0.45, 0.8, 0.4)));
    rgb *= key > 0.45 ? 1.0 : (key > -0.1 ? 0.74 : 0.5);
    vec3 an = abs(normal);
    vQ = an.x > 0.5 ? position.yz : (an.y > 0.5 ? position.xz : position.xy);
    vInfo2.x = N;
    outShape = ${CUBE_FACE}.0;
    gl_Position = projectionMatrix * mvPosition;
  } else if (oriented) {
    // A ring lying in a world plane (ground shockwaves, spell circles). Its
    // plane is quantized into cells about two pixels wide (measured at its
    // centre) in the fragment shader, so it reads like a pixel-art rune
    // circle painted on the floor — never like a smooth decal.
    vec3 n = normalize(aAxis.xyz);
    vec3 t = normalize(cross(n, abs(n.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 b = cross(n, t);
    mvPosition = modelViewMatrix * vec4(center + (t * corner.x + b * corner.y) * size, 1.0);
    vQ = corner;
    vInfo2 = vec4(clamp(floor(px * 0.5), 6.0, 64.0), max(aMisc.z, 0.02), 0.0, 0.0);
    outShape = ${PLANE_RING}.0;
    gl_Position = projectionMatrix * mvPosition;
  } else {
    // Big soft-edged sprites (glows, smoke, flares, billboard rings) are
    // pulled toward the camera by part of their size — the same pixels, but
    // a fireball against a wall is no longer sliced by it.
    bool pulled = shape < ${SHAPE.smoke + 0.5} && !isStreak || shape > ${SHAPE.chunk + 0.5} || isRing;
    if (pulled) {
      float pull = min(size * 0.85, depth - 0.12);
      if (pull > 0.0) mvPosition.xyz *= (depth - pull) / depth;
    }
    vec4 clipC = projectionMatrix * mvPosition;
    float ext;
    if (isStreak) {
      // A spark: a chain of pixels from the head back along its screen
      // velocity. Project the tail (velocity × stretch seconds behind) and
      // measure it in pixels, capped so a streak stays a short chain.
      vec4 clipT = projectionMatrix * (modelViewMatrix * vec4(center - aAxis.xyz * aAxis.w, 1.0));
      vec2 hp = (clipC.xy / clipC.w * 0.5 + 0.5) * uViewport;
      vec2 d = vec2(0.0);
      if (clipT.w > 0.05 && aAxis.w > 0.0) d = (clipT.xy / clipT.w * 0.5 + 0.5) * uViewport - hp;
      float L = min(length(d), 12.0);
      vec2 dir = L > 0.01 ? normalize(d) : vec2(0.0, -1.0);
      float W = min(N, 3.0);
      ext = ceil(L) + 1.0 + W * 0.5;
      vInfo2 = vec4(L, W, dir);
    } else if (isRing) {
      float R = max(2.0, floor(px + 0.5));
      vInfo2 = vec4(R, max(1.0, floor(aMisc.z * 2.0 * R + 0.5)), 0.0, 0.0);
      ext = R + 0.5;
    } else if (shape > ${SHAPE.chunk + 0.5}) {
      // Flare: a plus-shaped star, arm reach R whole pixels.
      float R = max(1.0, floor(px + 0.5));
      vInfo2.x = R;
      ext = R + 0.5;
    } else if (shape < ${SHAPE.glow + 0.5}) {
      ext = N * 0.5 + 1.0;   // core + a 1-px glow rim
    } else {
      ext = N * 0.5;         // smoke block, small chunk
    }
    gl_Position = fxPixelCorner(clipC, ext, corner);
    vQ = corner * ext;
  }

  vColor = vec4(rgb, alpha);
  vInfo = vec4(outShape, aMisc.y, N, seed);
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
varying vec2 vQ;
varying vec4 vColor;
varying vec4 vInfo;
varying vec4 vInfo2;

#include <fog_pars_fragment>
${NOISE_GLSL}
${FOG_GLSL}
${DITHER_GLSL}

/** Three flat brightness levels for a fading light (1/3, 2/3, 1). */
float fxLevels(float a) { return ceil(clamp(a, 0.0, 1.0) * 3.0) / 3.0; }

void main() {
  float shape = vInfo.x;
  float N = vInfo.z;
  float seed = vInfo.w;
  vec3 col = vColor.rgb;
  float a = vColor.a;
  // Per fragment: 1 = adds light (alpha 0 out), 0 = a solid pixel.
  float add = vInfo.y;
  vec2 q = vQ;
  float cheb = max(abs(q.x), abs(q.y));
  // How the fade is spent. Pixel art doesn't blend: small sprites pop out
  // whole at a per-particle moment; glows and flares burn DOWN (shrink in
  // whole pixels); rings dim in steps and break into dashes; smoke erodes
  // and dissolves in chunky ordered-dither cells.
  float pop = fract(seed * 91.7 + 0.13) * 0.94 + 0.03;
  float thr = N < 2.5 ? pop : 0.0;

  if (shape < ${SHAPE.glow + 0.5}) {
    // Glow: stepped rings of colour, not a gradient. Small ones are a solid
    // N×N core with a 1-px corner-cut halo of added light (the classic
    // pixel ember); big ones a hot solid centre, a solid mid band, and an
    // outer band + rim of added light — all shrinking as it fades.
    float R = N * 0.5;
    float d = length(q);
    if (N < 3.5) {
      if (cheb < R) col *= 1.25;
      else if (d < R + 0.9) { col *= 0.38; add = 1.0; }
      else discard;
    } else {
      R *= 0.35 + 0.65 * a;
      if (d < R * 0.42 + 0.5) col *= 1.35;
      else if (d < R * 0.72 + 0.3) col *= 0.8;
      else if (d < R + 0.3) { col *= 0.42; add = 1.0; }
      else if (d < R + 1.0 && a > 0.5) { col *= 0.16; add = 1.0; }
      else discard;
      thr = a < 0.25 ? pop : 0.0;
    }
  } else if (shape < ${SHAPE.streak + 0.5}) {
    // Spark: a W-px-wide chain from the head back along dir; the head burns
    // white-hot, the body holds, the tail breaks up into loose pixels.
    float L = vInfo2.x;
    float W = vInfo2.y;
    vec2 dir = vInfo2.zw;
    float t = dot(q, dir);
    float s = abs(q.x * dir.y - q.y * dir.x);
    if (s > W * 0.5 + 0.12 || t < -W * 0.5 || t > L + 0.5) discard;
    float f = L > 0.5 ? clamp(t / L, 0.0, 1.0) : 0.0;
    if (t < W * 0.5 + 0.5) col *= 1.5;
    else if (f > 0.55) {
      col *= 0.6;
      if (fxBayer4(gl_FragCoord.xy) > (1.0 - f) * 2.2) discard;
    }
    thr = pop;
  } else if (shape < ${SHAPE.smoke + 0.5}) {
    // Smoke / dust: a matte block with a ragged silhouette of blocky cells
    // in three flat tones; as it thins its edge erodes and the body
    // dissolves in an ordered dither of 1–2 px cells.
    float R = N * 0.5;
    float cell = max(1.0, floor(N / 6.0));
    float h = fxHash(floor(q / cell) + seed * 61.0);
    float d = length(q) / max(R, 0.5);
    if (d > (0.7 + 0.42 * h) * (0.55 + 0.45 * a)) discard;
    col *= 0.8 + 0.2 * floor(h * 3.0);
    float dcell = N >= 14.0 ? 2.0 : 1.0;
    if (N >= 2.5) thr = fxBayer4(floor(q / dcell) + floor(seed * 16.0) * vec2(1.0, 3.0)) * 0.9 - 0.12;
  } else if (shape < ${SHAPE.ring + 0.5}) {
    // Camera-facing ring: a pixel circle (the pixels whose centres lie
    // within the band), dashed like a rune ring when it's big.
    float R = vInfo2.x;
    float band = vInfo2.y;
    float r = length(q);
    if (abs(r - (R - band * 0.5)) > band * 0.5 + 0.05) discard;
    float segs = max(6.0, floor(R * 0.8));
    float seg = floor((atan(q.y, q.x) / 6.2831853 + 0.5) * segs);
    if (R > 7.0 && mod(seg, 3.0) > 1.5) col *= 0.45;
    // Fading: dim in steps and drop whole dashes.
    if (fract(sin(seg * 12.9898 + seed * 78.233) * 43758.5453) > a * 1.4) discard;
    col *= fxLevels(a);
  } else if (shape < ${SHAPE.chunk + 0.5}) {
    // Small chunk: a hard square; from 3 px up it gets a darker 1-px rim so
    // it reads as a solid lump, not a flat dot.
    if (N > 2.5 && cheb > N * 0.5 - 1.0) col *= 0.62;
    thr = pop;
  } else if (shape < ${SHAPE.flare + 0.5}) {
    // Flare: a hard plus of pixels — square hot core, arms stepping down in
    // three bands, short diagonal glints. Big flares get 3-px arms whose
    // outer lines burn dimmer. Fading pulls the arms in.
    float R = max(1.0, floor(vInfo2.x * (0.3 + 0.7 * a) + 0.5));
    vec2 aq = abs(q);
    float along = cheb;
    float across = min(aq.x, aq.y);
    float armW = R >= 7.0 ? 1.0 : 0.0;
    float b;
    if (along <= floor(R * 0.18)) b = 1.8;
    else if (across <= armW && along <= R) {
      float f = along / R;
      b = f < 0.35 ? 1.4 : (f < 0.7 ? 0.8 : 0.4);
      if (across > 0.5) b *= 0.5;
    } else if (abs(aq.x - aq.y) < 0.5 && along <= R * 0.4 + 0.5) b = 0.6;
    else discard;
    col *= b * fxLevels(a);
    thr = 0.0;
  } else if (shape < ${CUBE_FACE + 0.5}) {
    // Cube face: a darker 1-px outline so each voxel stays legible.
    if (cheb > 1.0 - 2.0 / max(vInfo2.x, 1.0)) col *= 0.7;
    thr = pop;
  } else {
    // Ring lying in the world: its plane quantized into cells, so the band
    // is a stair-stepped pixel circle with dashes like a painted rune ring.
    float cells = vInfo2.x;
    float th = vInfo2.y;
    vec2 g = (floor(q * cells) + 0.5) / cells;
    float r = length(g);
    if (abs(r - (1.0 - th)) > th) discard;
    float seg = floor((atan(g.y, g.x) / 6.2831853 + 0.5) * floor(cells * 1.2));
    if (mod(seg, 4.0) > 2.5) col *= 0.4;
    if (fract(sin(seg * 12.9898 + seed * 78.233) * 43758.5453) > a * 1.4) discard;
    col *= fxLevels(a);
  }

  if (a < thr) discard;
  gl_FragColor = fxApplyFog(col, 1.0, add);
  #include <colorspace_fragment>
}
`;

export function createParticleMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      ...UniformsUtils.clone(UniformsLib.fog),
      uLightPos: fxUniforms.uLightPos,
      uLightCol: fxUniforms.uLightCol,
      uAmbientLight: fxUniforms.uAmbientLight,
      uStaffLight: fxUniforms.uStaffLight,
      uViewport: fxUniforms.uViewport,
      /** On-screen size (px) from which a chunk is drawn as a real cube. */
      uCubePx: { value: 4.5 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    // Nearly every fragment is solid or discarded (see above), so depth
    // writes are safe and make solid particles occlude each other correctly.
    depthWrite: true,
    depthTest: true,
    // Rings lying on the floor are seen from both sides; cube back faces
    // are culled in the vertex shader instead.
    side: DoubleSide,
    fog: true,
    toneMapped: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });
}

export interface ParticleGeometry {
  geometry: InstancedBufferGeometry;
  posSize: InstancedBufferAttribute;
  color: InstancedBufferAttribute;
  axis: InstancedBufferAttribute;
  misc: InstancedBufferAttribute;
}

/** A unit cube (corners ±1, per-face normals; BoxGeometry orders its faces
 * +x −x +y −y +z −z) instanced over the four particle attributes, each
 * backed by the simulation's arrays and marked dynamic (they stream every
 * frame; static-usage uploads stall some drivers). */
export function createParticleGeometry(arrays: {
  posSize: Float32Array;
  color: Float32Array;
  axis: Float32Array;
  misc: Float32Array;
}): ParticleGeometry {
  const box = new BoxGeometry(2, 2, 2);
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", box.getAttribute("position"));
  geometry.setAttribute("normal", box.getAttribute("normal"));
  geometry.setIndex(box.getIndex());
  box.dispose();
  const make = (arr: Float32Array) => {
    const attr = new InstancedBufferAttribute(arr, INSTANCE_VEC);
    attr.setUsage(DynamicDrawUsage);
    return attr;
  };
  const posSize = make(arrays.posSize);
  const color = make(arrays.color);
  const axis = make(arrays.axis);
  const misc = make(arrays.misc);
  geometry.setAttribute("aPosSize", posSize);
  geometry.setAttribute("aColor", color);
  geometry.setAttribute("aAxis", axis);
  geometry.setAttribute("aMisc", misc);
  geometry.instanceCount = 0;
  return { geometry, posSize, color, axis, misc };
}
