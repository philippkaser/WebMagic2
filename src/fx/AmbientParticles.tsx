import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  BufferAttribute,
  Color,
  CustomBlending,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
} from "three";
import { Rng } from "../core/rng";
import type { OmenId } from "../world/types";
import { ambientLayers, type AmbientLayer, type AmbientPlace } from "./ambientConfig";
import { fxUniforms } from "./fxUniforms";
import { FOG_GLSL, LIGHTING_GLSL } from "./glsl";

/** Ambient particles: the air of a place — dust in the torchlight, spores and
 * drips in the Drowned Halls, embers and ash in the Forge, glints in the
 * Crystal Deep, falling ash in the Hollow, fireflies over the village.
 *
 * Costs nothing on the CPU: each layer is a fixed set of random seeds, and the
 * vertex shader computes every particle's position from (seed, time) —
 * flow, wander, twinkle — then wraps it into a box that follows the camera.
 * Particles therefore stay put in the WORLD as you walk (they don't swim with
 * the view), yet the volume always surrounds you. Near the box's faces they
 * fade, so the wrap is never seen. One draw call per layer (≤ 2 per place).
 *
 * The lead mounts it on dungeon floors: `<AmbientParticles biome omen />`;
 * the village mounts the "village" variant itself. */

const SHAPE_ID = { glow: 0, streak: 1, chunk: 2, flare: 3 } as const;
const MODE_ID = { drift: 0, drip: 1, firefly: 2 } as const;

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uCam;
uniform float uExtent;
uniform vec2 uYRange;
uniform vec3 uDrift;
uniform vec2 uWander;      // amplitude, angular speed
uniform vec2 uTwinkle;     // depth, speed
uniform vec2 uSize;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec4 uLook;        // intensity, lit, additive, alpha
uniform vec2 uKind;        // shape, mode
uniform float uViewportH;
uniform float uMinPx;

varying vec2 vUv;
varying vec4 vColor;
varying vec3 vInfo;        // shape, ripple (0/1), aspect

#include <fog_pars_vertex>
${LIGHTING_GLSL}

void main() {
  float t = uTime;
  float ph = aSeed.w * 6.2831853;
  float bandH = max(uYRange.y - uYRange.x, 0.01);
  vec3 p = vec3(aSeed.x * uExtent, uYRange.x + aSeed.y * bandH, aSeed.z * uExtent);
  float alpha = uLook.w;
  vec3 vel = uDrift;
  float ripple = 0.0;
  float mode = uKind.y;

  if (mode < 0.5) {
    // Drift: a shared flow (each particle a little faster or slower) plus a
    // private Lissajous wander.
    float speed = 0.6 + 0.8 * fract(aSeed.w * 7.31);
    p += uDrift * (t * speed);
    float w = uWander.y * (0.7 + 0.6 * fract(aSeed.x * 3.7));
    p += uWander.x * vec3(sin(t * w + ph), 0.5 * sin(t * w * 0.71 + ph * 2.0), cos(t * w * 0.83 + ph * 1.3));
    p.y = uYRange.x + mod(p.y - uYRange.x, bandH);
    float yRel = (p.y - uYRange.x) / bandH;
    alpha *= smoothstep(0.0, 0.07, yRel) * (1.0 - smoothstep(0.9, 1.0, yRel));
  } else if (mode < 1.5) {
    // Drip: falls from the ceiling under gravity, then a ripple on the floor,
    // then waits for the next one.
    float period = 3.5 + aSeed.w * 7.0;
    float tt = mod(t + aSeed.y * period, period);
    float fall = sqrt(2.0 * bandH / 9.8);
    p.y = uYRange.y - 4.9 * tt * tt;
    vel = vec3(0.0, -9.8 * tt, 0.0);
    if (tt > fall) {
      float s = (tt - fall) / 0.45;
      p.y = uYRange.x + 0.02;
      ripple = 1.0;
      alpha *= s < 1.0 ? (1.0 - s) * 0.8 : 0.0;
    } else {
      alpha *= smoothstep(0.0, 0.15, tt);
    }
  } else {
    // Firefly: a lazy wander and a slow blink.
    float w = uWander.y * (0.6 + 0.8 * fract(aSeed.x * 5.3));
    p += uWander.x * vec3(sin(t * w + ph), 0.35 * sin(t * w * 1.37 + ph * 3.0), cos(t * w * 0.77 + ph * 1.7));
    p.y = clamp(p.y, uYRange.x, uYRange.y);
    float b = 0.5 + 0.5 * sin(t * uTwinkle.y * (0.6 + 0.8 * fract(aSeed.z * 9.1)) + ph * 5.0);
    alpha *= 0.04 + 0.96 * b * b * b * b;
  }

  // Wrap horizontally into the camera-centred box; fade near its faces.
  vec2 origin = uCam.xz - uExtent * 0.5;
  p.xz = origin + mod(p.xz - origin, uExtent);
  vec2 rel = abs(p.xz - uCam.xz) / (uExtent * 0.5);
  alpha *= 1.0 - smoothstep(0.65, 1.0, max(rel.x, rel.y));

  if (mode < 1.5 && uTwinkle.x > 0.0) {
    float tw = 0.5 + 0.5 * sin(t * uTwinkle.y * (0.6 + 0.8 * aSeed.x) + ph * 3.0);
    // A sharp twinkle for glints (depth near 1): mostly dark, brief flashes.
    alpha *= 1.0 - uTwinkle.x * (1.0 - tw * tw * tw);
  }

  vec3 col = mix(uColorA, uColorB, fract(aSeed.w * 13.7));
  vec3 light = uLook.y > 0.0 ? fxLighting(p) : vec3(0.0);
  col = col * (uLook.x + uLook.y * light);

  float size = mix(uSize.x, uSize.y, fract(aSeed.x * 31.1 + aSeed.z));
  vec4 mvCenter = modelViewMatrix * vec4(p, 1.0);
  float depth = max(-mvCenter.z, 0.05);
  float pxPerUnit = projectionMatrix[1][1] * uViewportH * 0.5 / depth;
  float px = size * pxPerUnit;
  if (px < uMinPx) {
    float k = px / uMinPx;
    alpha *= k * k;
    size = uMinPx / pxPerUnit;
  }

  vec2 corner = position.xy;
  vec4 mvPosition = mvCenter;
  float aspect = 1.0;
  float shape = uKind.x;
  if (ripple > 0.5) {
    // A flat ring on the floor, growing as it fades.
    float r = size * 10.0 + 0.25 * (1.0 - alpha);
    mvPosition = modelViewMatrix * vec4(p + vec3(corner.x, 0.0, corner.y) * r, 1.0);
  } else if (shape > 0.5 && shape < 1.5) {
    vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz;
    float sp = length(vv.xy);
    vec2 dir = sp > 0.0001 ? vv.xy / sp : vec2(0.0, 1.0);
    vec2 perp = vec2(-dir.y, dir.x);
    float len = min(sp * 0.035, 0.6);
    float halfLen = size + len * 0.5;
    aspect = halfLen / size;
    mvPosition.xy += dir * (corner.y * halfLen - len * 0.5) + perp * corner.x * size;
  } else {
    mvPosition.xy += corner * size;
  }

  vUv = corner;
  vColor = vec4(col, clamp(alpha, 0.0, 1.0));
  vInfo = vec3(shape, ripple, aspect);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform vec4 uLook;
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vInfo;
#include <fog_pars_fragment>
${FOG_GLSL}
void main() {
  float shape = vInfo.x;
  vec3 col = vColor.rgb;
  float a;
  if (vInfo.y > 0.5) {
    float r = length(vUv);
    a = smoothstep(0.14, 0.0, abs(r - 0.82)) * step(r, 1.0);
  } else if (shape < 0.5) {
    float r2 = dot(vUv, vUv);
    float f = max(1.0 - r2, 0.0);
    a = f * f;
    col *= 1.0 + smoothstep(0.25, 0.0, r2);
  } else if (shape < 1.5) {
    float L = vInfo.z;
    vec2 q = vec2(vUv.x, vUv.y * L);
    float d = length(vec2(q.x, max(abs(q.y) - (L - 1.0), 0.0)));
    a = pow(max(1.0 - d, 0.0), 1.5) * mix(0.3, 1.0, vUv.y * 0.5 + 0.5);
  } else if (shape < 2.5) {
    a = 1.0;
  } else {
    float r = length(vUv);
    float rays = max(0.0, 1.0 - abs(vUv.x) * 7.0) * (1.0 - abs(vUv.y))
               + max(0.0, 1.0 - abs(vUv.y) * 7.0) * (1.0 - abs(vUv.x));
    float core = pow(max(0.0, 1.0 - r), 3.0);
    a = clamp(core + rays, 0.0, 1.0);
    col *= 1.0 + 2.0 * core;
  }
  a *= vColor.a;
  if (a < 0.003) discard;
  gl_FragColor = fxApplyFog(col, a, uLook.z);
  #include <colorspace_fragment>
}
`;

interface LayerGpu {
  geometry: InstancedBufferGeometry;
  material: ShaderMaterial;
}

function buildLayer(layer: AmbientLayer, seed: number): LayerGpu {
  const g = new InstancedBufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  // Seeded, so a place's air looks the same every visit.
  const rng = new Rng(seed);
  const seeds = new Float32Array(layer.count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rng.next();
  g.setAttribute("aSeed", new InstancedBufferAttribute(seeds, 4));
  g.instanceCount = layer.count;
  const a = new Color(layer.colors[0]);
  const b = new Color(layer.colors[1]);
  const material = new ShaderMaterial({
    uniforms: {
      ...UniformsUtils.clone(UniformsLib.fog),
      uTime: fxUniforms.uTime,
      uViewportH: fxUniforms.uViewportH,
      uMinPx: fxUniforms.uMinPx,
      uLightPos: fxUniforms.uLightPos,
      uLightCol: fxUniforms.uLightCol,
      uAmbientLight: fxUniforms.uAmbientLight,
      uStaffLight: fxUniforms.uStaffLight,
      uCam: { value: new Vector3() },
      uExtent: { value: layer.extent },
      uYRange: { value: new Vector2(layer.yRange[0], layer.yRange[1]) },
      uDrift: { value: new Vector3(...layer.drift) },
      uWander: { value: new Vector2(layer.wander, layer.wanderFreq) },
      uTwinkle: { value: new Vector2(layer.twinkle, layer.twinkleFreq) },
      uSize: { value: new Vector2(layer.size[0], layer.size[1]) },
      uColorA: { value: new Vector3(a.r, a.g, a.b) },
      uColorB: { value: new Vector3(b.r, b.g, b.b) },
      uLook: { value: new Vector4(layer.intensity, layer.lit, layer.additive, layer.alpha) },
      uKind: { value: new Vector2(SHAPE_ID[layer.shape], MODE_ID[layer.mode]) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
    toneMapped: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });
  return { geometry: g, material };
}

export function AmbientParticles({
  biome,
  omen,
  ceiling = 7,
}: {
  biome: AmbientPlace;
  omen: OmenId | null;
  /** Ceiling height (m): the volume spans floor to ceiling. */
  ceiling?: number;
}) {
  const camera = useThree((s) => s.camera);
  const gpu = useMemo(() => {
    const ls = ambientLayers(biome, omen, ceiling);
    return ls.map((l, i) => buildLayer(l, 0x5eed + i * 977 + biome.length * 31));
  }, [biome, omen, ceiling]);

  useEffect(
    () => () => {
      for (const l of gpu) {
        l.geometry.dispose();
        l.material.dispose();
      }
    },
    [gpu],
  );

  useFrame(() => {
    for (let i = 0; i < gpu.length; i++) {
      (gpu[i].material.uniforms.uCam.value as Vector3).copy(camera.position);
    }
  });

  return (
    <>
      {gpu.map((l, i) => (
        <mesh key={i} geometry={l.geometry} material={l.material} frustumCulled={false} renderOrder={1} />
      ))}
    </>
  );
}
