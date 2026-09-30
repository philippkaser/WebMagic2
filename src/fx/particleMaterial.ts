import {
  BufferAttribute,
  CustomBlending,
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
import { FOG_GLSL, LIGHTING_GLSL, NOISE_GLSL } from "./glsl";
import { INSTANCE_VEC, SHAPE } from "./particleSim";

/** The one material every sprite particle is drawn with.
 *
 * Blending is premultiplied alpha (src ONE, dst ONE_MINUS_SRC_ALPHA): the
 * shader outputs (rgb·a, a·(1 − additive)). With additive = 1 the alpha term
 * vanishes and the particle simply adds light; with additive = 0 it composites
 * like ordinary alpha. So glowing sparks and dark smoke — which would
 * normally need two materials and two draw calls — share one.
 *
 * Instance attributes (see particleSim.InstanceArrays):
 *   aPosSize  xyz, w = half-extent (m)
 *   aColor    linear rgb (HDR) + alpha
 *   aAxis     xyz = velocity (streaks) / plane normal (rings), w = stretch
 *             seconds for streaks, else a per-particle seed
 *   aMisc     x shape, y additive, z rotation (rings: band thickness), w lit */

const VERT = /* glsl */ `
attribute vec4 aPosSize;
attribute vec4 aColor;
attribute vec4 aAxis;
attribute vec4 aMisc;

uniform float uViewportH;
uniform float uMinPx;

varying vec2 vUv;
varying vec4 vColor;
/** x shape, y additive, z aspect (streak) / thickness (ring), w seed. */
varying vec4 vInfo;

#include <fog_pars_vertex>
${LIGHTING_GLSL}

void main() {
  vec3 center = aPosSize.xyz;
  float size = aPosSize.w;
  float shape = aMisc.x;
  float alpha = aColor.a;
  vec3 rgb = aColor.rgb;
  if (aMisc.w > 0.0) rgb *= mix(vec3(1.0), fxLighting(center), aMisc.w);

  vec4 mvCenter = modelViewMatrix * vec4(center, 1.0);
  float depth = max(-mvCenter.z, 0.05);
  float pxPerUnit = projectionMatrix[1][1] * uViewportH * 0.5 / depth;
  // Minimum on-screen size (curves.ts#minPixelSize): never sub-pixel, so
  // distant sparks read as steady single pixels instead of shimmering.
  // A streak keeps its length, so only its width is padded: its area (and
  // so its alpha compensation) scales linearly, not squared.
  bool isStreakShape = shape > ${SHAPE.streak - 0.5} && shape < ${SHAPE.streak + 0.5};
  float px = size * pxPerUnit;
  if (px < uMinPx) {
    float k = px / uMinPx;
    alpha *= isStreakShape ? k : k * k;
    size = uMinPx / pxPerUnit;
  }

  vec2 corner = position.xy;
  vec4 mvPosition = mvCenter;
  float aspect = 1.0;
  bool isStreak = isStreakShape;
  bool isRing = shape > ${SHAPE.ring - 0.5} && shape < ${SHAPE.ring + 0.5};
  bool oriented = isRing && dot(aAxis.xyz, aAxis.xyz) > 0.0001;
  float seed = isStreak ? 0.0 : aAxis.w;

  // Point-blank guard. Effects happen in your face — a blast-jump puts the
  // fireball at your feet, a slime dies on your boots — and a stack of
  // additive quads filling the view whites out the whole screen. So sprites
  // fade in the last half-metre before the eye, and a filled sprite bigger
  // than ~40% of the screen gives back the light its extra area would add.
  // (World-oriented rings are thin bands lying in the world — exempt.)
  if (!oriented) {
    alpha *= smoothstep(0.1, 0.55, depth);
    float bigPx = uViewportH * 0.2;
    if (px > bigPx && !isRing) alpha *= bigPx / px;
  }

  if (oriented) {
    // A world-oriented ring (ground shockwaves, muzzle circles).
    vec3 n = normalize(aAxis.xyz);
    vec3 t = normalize(cross(n, abs(n.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 b = cross(n, t);
    mvPosition = modelViewMatrix * vec4(center + (t * corner.x + b * corner.y) * size, 1.0);
  } else if (isStreak && aAxis.w > 0.0) {
    // Velocity stretch in the view plane: the head sits on the particle and
    // the tail trails behind by velocity × stretch seconds.
    vec3 vv = (viewMatrix * vec4(aAxis.xyz, 0.0)).xyz;
    float speed = length(vv.xy);
    vec2 dir = speed > 0.0001 ? vv.xy / speed : vec2(0.0, 1.0);
    vec2 perp = vec2(-dir.y, dir.x);
    float len = speed * aAxis.w;
    float halfLen = size + len * 0.5;
    aspect = halfLen / size;
    mvPosition.xy += dir * (corner.y * halfLen - len * 0.5) + perp * corner.x * size;
  } else {
    // Soft sprites (glows, flares, smoke, camera-facing rings) are pulled
    // toward the camera by part of their size and shrunk to compensate: the
    // same picture, but a fireball against a wall or floor is no longer
    // sliced by it. (Cheap stand-in for depth-faded soft particles.)
    bool soft = shape < ${SHAPE.smoke + 0.5} || shape > ${SHAPE.chunk + 0.5} || isRing;
    if (soft) {
      float pull = min(size * 0.85, depth - 0.12);
      if (pull > 0.0) {
        mvPosition.xyz *= (depth - pull) / depth;
        size *= (depth - pull) / depth;
      }
    }
    float r = isRing ? 0.0 : aMisc.z;
    float c = cos(r);
    float s = sin(r);
    mvPosition.xy += vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * size;
  }

  vUv = corner;
  vColor = vec4(rgb, alpha);
  vInfo = vec4(shape, aMisc.y, isRing ? aMisc.z : aspect, seed);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vInfo;

#include <fog_pars_fragment>
${NOISE_GLSL}
${FOG_GLSL}

void main() {
  float shape = vInfo.x;
  vec3 col = vColor.rgb;
  float a;
  if (shape < ${SHAPE.glow + 0.5}) {
    // Soft glow with a hot core: the core pushes past the bloom threshold,
    // the skirt tints the air around it.
    float r2 = dot(vUv, vUv);
    float f = max(1.0 - r2, 0.0);
    a = f * f;
    col *= 1.0 + 1.6 * smoothstep(0.22, 0.0, r2);
  } else if (shape < ${SHAPE.streak + 0.5}) {
    // Capsule along the streak, brightest at the head (+y).
    float L = vInfo.z;
    vec2 q = vec2(vUv.x, vUv.y * L);
    float dy = max(abs(q.y) - (L - 1.0), 0.0);
    float d = length(vec2(q.x, dy));
    a = pow(max(1.0 - d, 0.0), 1.5);
    a *= mix(0.25, 1.0, vUv.y * 0.5 + 0.5);
    col *= 1.0 + 1.2 * smoothstep(0.5, 0.0, abs(vUv.x));
  } else if (shape < ${SHAPE.smoke + 0.5}) {
    // Noisy puff: fbm eats the silhouette so no two puffs match.
    float r = length(vUv);
    float n = fxFbm(vUv * 1.7 + vInfo.w * 37.0);
    a = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.7);
    col *= 0.75 + 0.5 * n;
  } else if (shape < ${SHAPE.ring + 0.5}) {
    float r = length(vUv);
    float th = max(vInfo.z, 0.02);
    float band = smoothstep(th, 0.0, abs(r - (1.0 - th)));
    float haze = 0.18 * smoothstep(1.0, 0.2, r) * r;
    a = (band + haze) * step(r, 1.0);
    col *= 1.0 + band;
  } else if (shape < ${SHAPE.chunk + 0.5}) {
    // Hard square with a darker rim: reads as a solid chunk at 3 px.
    a = 1.0;
    float m = max(abs(vUv.x), abs(vUv.y));
    col *= m > 0.62 ? 0.72 : 1.0;
  } else {
    // Four-point star: a flare's rays plus a round core.
    float r = length(vUv);
    float rays = max(0.0, 1.0 - abs(vUv.x) * 9.0) * (1.0 - abs(vUv.y))
               + max(0.0, 1.0 - abs(vUv.y) * 9.0) * (1.0 - abs(vUv.x));
    float core = pow(max(0.0, 1.0 - r), 3.0);
    a = clamp(core + rays * 0.9, 0.0, 1.0);
    col *= 1.0 + 2.0 * core;
  }
  a *= vColor.a;
  if (a < 0.002) discard;
  gl_FragColor = fxApplyFog(col, a, vInfo.y);
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
      uViewportH: fxUniforms.uViewportH,
      uMinPx: fxUniforms.uMinPx,
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
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

/** A unit quad (corners ±1) instanced over the four particle attributes,
 * each backed by the simulation's arrays and marked dynamic (they stream
 * every frame; static-usage uploads stall some drivers). */
export function createParticleGeometry(arrays: {
  posSize: Float32Array;
  color: Float32Array;
  axis: Float32Array;
  misc: Float32Array;
}): ParticleGeometry {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
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
