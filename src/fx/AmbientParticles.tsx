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
import { DITHER_GLSL, FOG_GLSL, LIGHTING_GLSL, PIXEL_GLSL } from "./glsl";

/** Ambient particles: the air of a place — dust in the torchlight, spores and
 * drips in the Drowned Halls, embers and ash in the Forge, glints in the
 * Crystal Deep, falling ash in the Hollow, fireflies over the village.
 *
 * Drawn as single crisp pixels (1–2 render-target pixels, snapped to the
 * grid — see glsl.ts#PIXEL_GLSL): specks, 1-px drip chains, glints that
 * throw a tiny plus when they catch, embers and fireflies with a 1-px halo.
 * Twinkles switch between stepped levels and fades are per-speck dither
 * pops, never soft alpha — the pixel-magic air of the artpass motes.
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

/** Largest an ambient particle may draw, in render-target pixels (the
 * artpass motes are 1–2 px points): a mote drifting past your nose stays a
 * crisp speck instead of swelling into a blob. */
const MAX_PX = 2;

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

varying vec2 vQ;
varying vec4 vColor;       // rgb, coverage (dithered against vInfo.w)
varying vec4 vInfo;        // shape (4 = ripple), N, rim / arm reach, threshold
varying vec4 vInfo2;       // drip: length px, dir

#include <fog_pars_vertex>
${LIGHTING_GLSL}
${PIXEL_GLSL}

/** Quantize a 0..1 brightness into three flat levels — twinkles SWITCH. */
float stepped3(float x) { return floor(clamp(x, 0.0, 0.999) * 3.0) / 2.0; }

void main() {
  float t = uTime;
  float ph = aSeed.w * 6.2831853;
  float bandH = max(uYRange.y - uYRange.x, 0.01);
  vec3 p = vec3(aSeed.x * uExtent, uYRange.x + aSeed.y * bandH, aSeed.z * uExtent);
  // "cover" fades things in and out spatially (box faces, band ends) — it is
  // dithered per particle, so a speck pops in or out whole; "bright" is
  // twinkle/blink and is stepped.
  float cover = uLook.w;
  float bright = 1.0;
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
    cover *= smoothstep(0.0, 0.07, yRel) * (1.0 - smoothstep(0.9, 1.0, yRel));
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
      cover *= s < 1.0 ? 1.0 - s : 0.0;
    } else {
      cover *= step(0.12, tt);
    }
  } else {
    // Firefly: a lazy wander and a slow blink.
    float w = uWander.y * (0.6 + 0.8 * fract(aSeed.x * 5.3));
    p += uWander.x * vec3(sin(t * w + ph), 0.35 * sin(t * w * 1.37 + ph * 3.0), cos(t * w * 0.77 + ph * 1.7));
    p.y = clamp(p.y, uYRange.x, uYRange.y);
    float b = 0.5 + 0.5 * sin(t * uTwinkle.y * (0.6 + 0.8 * fract(aSeed.z * 9.1)) + ph * 5.0);
    b = b * b * b * b;
    cover *= step(0.04, b);
    bright = 0.35 + 0.65 * stepped3(b * 1.2);
  }

  // Wrap horizontally into the camera-centred box; fade near its faces.
  vec2 origin = uCam.xz - uExtent * 0.5;
  p.xz = origin + mod(p.xz - origin, uExtent);
  vec2 rel = abs(p.xz - uCam.xz) / (uExtent * 0.5);
  cover *= 1.0 - smoothstep(0.65, 1.0, max(rel.x, rel.y));

  float tw = 1.0;
  if (mode < 1.5 && uTwinkle.x > 0.0) {
    tw = 0.5 + 0.5 * sin(t * uTwinkle.y * (0.6 + 0.8 * aSeed.x) + ph * 3.0);
    tw = tw * tw * tw;
    // A sharp twinkle for glints (depth near 1): mostly dim, brief flashes —
    // in three switched levels, never a smooth pulse.
    bright *= 1.0 - uTwinkle.x * (1.0 - stepped3(tw));
  }

  vec3 col = mix(uColorA, uColorB, fract(aSeed.w * 13.7));
  vec3 light = uLook.y > 0.0 ? fxLighting(p) : vec3(0.0);
  col = col * (uLook.x + uLook.y * light) * bright;

  float size = mix(uSize.x, uSize.y, fract(aSeed.x * 31.1 + aSeed.z));
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  float depth = max(-mvPosition.z, 0.05);
  float px = size * fxPxPerUnit(depth);
  float N = clamp(floor(2.0 * px + 0.5), 1.0, ${MAX_PX}.0);
  if (2.0 * px < 1.0) cover *= max(2.0 * px, 0.1);

  vec2 corner = position.xy;
  float shape = uKind.x;
  float reach = 0.0;
  vInfo2 = vec4(0.0);
  if (ripple > 0.5) {
    // A ring on the floor, growing as it fades; the fragment shader
    // quantizes it into a stair-stepped pixel circle.
    float r = size * 10.0 + 0.25 * (1.0 - cover);
    mvPosition = modelViewMatrix * vec4(p + vec3(corner.x, 0.0, corner.y) * r, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    vQ = corner;
    shape = 4.0;
    reach = clamp(r / 0.03, 4.0, 16.0);
  } else {
    vec4 clipC = projectionMatrix * mvPosition;
    float ext = N * 0.5;
    if (shape > 0.5 && shape < 1.5) {
      // A falling drop: a short 1-px chain of pixels along its screen path.
      vec4 clipT = projectionMatrix * (modelViewMatrix * vec4(p - vel * 0.035, 1.0));
      vec2 d = vec2(0.0);
      if (clipT.w > 0.05) d = (clipT.xy / clipT.w - clipC.xy / clipC.w) * 0.5 * uViewport;
      float L = min(length(d), 6.0);
      vInfo2 = vec4(L, L > 0.01 ? normalize(d) : vec2(0.0, 1.0), 0.0);
      N = 1.0;
      ext = ceil(L) + 1.5;
    } else if (shape > 2.5) {
      // A glint: one pixel that throws a plus of 1–2 px arms at its peak.
      N = 1.0;
      reach = tw > 0.7 ? 2.0 : (tw > 0.35 ? 1.0 : 0.0);
      ext = reach + 0.5;
    } else if (shape < 0.5 && uLook.x > 1.2) {
      // Bright motes (embers, fireflies) wear a 1-px halo of added light.
      reach = 1.0;
      ext = N * 0.5 + 1.0;
    }
    gl_Position = fxPixelCorner(clipC, ext, corner);
    vQ = corner * ext;
  }

  vColor = vec4(col, clamp(cover, 0.0, 1.0));
  vInfo = vec4(shape, N, reach, fract(aSeed.w * 53.13 + aSeed.x * 7.71) * 0.94 + 0.03);
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform vec4 uLook;
varying vec2 vQ;
varying vec4 vColor;
varying vec4 vInfo;
varying vec4 vInfo2;
#include <fog_pars_fragment>
${FOG_GLSL}
${DITHER_GLSL}
void main() {
  float shape = vInfo.x;
  float N = vInfo.y;
  float reach = vInfo.z;
  vec3 col = vColor.rgb;
  float add = uLook.z;
  vec2 q = vQ;
  vec2 aq = abs(q);
  float cheb = max(aq.x, aq.y);
  float thr = vInfo.w;
  if (shape > 3.5) {
    // Ripple: the floor quad quantized into cells, a pixel ring in it.
    vec2 g = (floor(q * reach) + 0.5) / reach;
    if (abs(length(g) - 0.8) > 0.16) discard;
    thr = fxBayer4(gl_FragCoord.xy);
  } else if (shape > 2.5) {
    // Glint: the core pixel, and a plus of dimmer arms at its peak.
    if (cheb < 0.5) col *= 1.3;
    else if (min(aq.x, aq.y) < 0.5 && cheb <= reach) { col *= 0.45; add = 1.0; }
    else discard;
  } else if (shape > 1.5) {
    // Ash: a flat square speck.
    if (cheb > N * 0.5) discard;
  } else if (shape > 0.5) {
    // Drip: a 1-px chain, brightest at the head.
    float L = vInfo2.x;
    vec2 dir = vInfo2.yz;
    float t = dot(q, dir);
    float s = abs(q.x * dir.y - q.y * dir.x);
    if (s > 0.62 || t < -0.5 || t > L + 0.5) discard;
    if (t > 0.5) col *= 0.55;
  } else {
    // Mote: a crisp N×N speck, bright ones with a corner-cut 1-px halo.
    float R = N * 0.5;
    if (cheb >= R) {
      if (reach < 0.5 || length(q) >= R + 0.9) discard;
      col *= 0.35;
      add = 1.0;
    }
  }
  if (vColor.a < thr) discard;
  gl_FragColor = fxApplyFog(col, 1.0, add);
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
      uViewport: fxUniforms.uViewport,
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
    // Specks are solid or discarded (never blended), so they can write
    // depth — except the added-light layers, which must not hide what's
    // behind their halos.
    depthWrite: layer.additive === 0,
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
