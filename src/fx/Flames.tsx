import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BufferAttribute,
  Color,
  CustomBlending,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
} from "three";
import { fxUniforms } from "./fxUniforms";
import { FOG_GLSL, NOISE_GLSL } from "./glsl";

/** Living pixel flames: every torch's fire is a procedural shader flame in
 * the game's pixel-magic look — fbm noise rising through a teardrop mask and
 * licking sideways, but sampled on a coarse grid of square cells (~2.5 cm,
 * like the artpass 16×32 flame sprite) and on a stepped clock (a 10 fps
 * flipbook), and painted in four flat colours: white-hot core, gold, the
 * torch's colour, a deep-red fringe. Crisp, flickering, never a soft blob —
 * bloom supplies the glow. All flames share ONE instanced draw call; owners
 * register a handle and mutate it (intensity for flicker) like a light
 * source.
 *
 * Why a shader and not only particles: a convincing flame needs a continuous
 * body, and a body built from particles costs ~20 live sprites per torch
 * forever. The shader flame is one quad; particles are spent where they're
 * worth it — the embers and sparks it sheds. */

const MAX_FLAMES = 128;

export interface FlameHandle {
  x: number;
  y: number;
  z: number;
  /** Height of the flame body in metres (width follows). */
  scale: number;
  /** Brightness multiplier — drive it with the owner's flicker. */
  intensity: number;
  /** Linear RGB of the fire's mid tone. */
  r: number;
  g: number;
  b: number;
  /** @internal */
  _seed: number;
}

const flames: FlameHandle[] = [];
let seedCounter = 0;
const tmpColor = new Color();

export function addFlame(opts: {
  position: readonly [number, number, number] | { x: number; y: number; z: number };
  color: string;
  scale?: number;
  intensity?: number;
}): FlameHandle {
  const p = opts.position;
  const [x, y, z] = "x" in p ? [p.x, p.y, p.z] : p;
  tmpColor.set(opts.color);
  const h: FlameHandle = {
    x,
    y,
    z,
    scale: opts.scale ?? 0.42,
    intensity: opts.intensity ?? 1,
    r: tmpColor.r,
    g: tmpColor.g,
    b: tmpColor.b,
    _seed: (seedCounter = (seedCounter + 0.6180339) % 1),
  };
  if (flames.length < MAX_FLAMES) flames.push(h);
  return h;
}

export function removeFlame(h: FlameHandle): void {
  const i = flames.indexOf(h);
  if (i >= 0) flames.splice(i, 1);
}

const VERT = /* glsl */ `
attribute vec4 aFlame;   // xyz base of the flame, w height
attribute vec4 aTint;    // rgb mid colour, w intensity
attribute float aSeed;
varying vec2 vUv;
varying vec4 vTint;
varying float vSeed;
#include <fog_pars_vertex>
void main() {
  // Cylindrical billboard: faces the camera around the vertical axis only,
  // so the flame always stands upright.
  vec3 base = aFlame.xyz;
  vec3 toCam = cameraPosition - base;
  vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-5, 0.0, 0.0));
  float h = aFlame.w;
  // Quad spans x ±0.5·w, y from −0.25·h (halo below the root) to 1.1·h.
  vec3 world = base + right * position.x * h * 0.9 + vec3(0.0, 1.0, 0.0) * (position.y * 1.35 - 0.25) * h;
  vUv = vec2(position.x + 0.5, position.y);
  vTint = aTint;
  vSeed = aSeed;
  vec4 mvPosition = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

/** Cells per flame height: the flame's pixel grid. */
const FLAME_CELLS = 18;
/** Flipbook rate: the flame redraws this many times a second. */
const FLAME_FPS = 10;

const FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec4 vTint;
varying float vSeed;
#include <fog_pars_fragment>
${NOISE_GLSL}
${FOG_GLSL}
void main() {
  // Flame space: x in flame heights, y = 0 at the root, 1 at the nominal tip
  // — snapped to the centre of its grid cell, so the flame is drawn in
  // square pixels that stay the same size however close you stand.
  float G = ${FLAME_CELLS}.0;
  float y = (floor((vUv.y * 1.35 - 0.25) * G) + 0.5) / G;
  float x = (floor((vUv.x - 0.5) * 0.9 * G) + 0.5) / G;
  // Stepped clock: the shape changes in frames, like a hand-drawn flipbook.
  float t = floor((uTime + vSeed * 17.0) * ${FLAME_FPS}.0) / ${FLAME_FPS}.0;
  float hy = clamp(y, 0.0, 1.2);
  float n = fxFbm(vec2(x * 6.0 + vSeed * 9.0, y * 3.0 - t * 3.8));
  // Lick: the body sways more the higher up it is.
  float sway = (n - 0.5) * 0.16 * hy + sin(t * 5.7 + y * 4.0) * 0.03 * hy;
  float width = mix(0.23, 0.04, clamp(y, 0.0, 1.0));
  float d = abs(x - sway) / width;
  float root = step(-0.06, y);
  // Heat: hottest low in the middle; noise tears tongues off the edges.
  float heat = (1.0 - d) * mix(1.0, 0.42, clamp(y, 0.0, 1.0)) + (n - 0.5) * 0.55;
  heat *= root * (1.0 - smoothstep(0.7, 1.15, y + (n - 0.5) * 0.3));
  // Four flat colours, no gradient: a pixel-art palette ramp. The body is
  // drawn SOLID, so its colours stay exact against a brightly lit wall
  // (added light would wash them to white); only the deep-red fringe adds
  // light, so the flame's edge melts into its own glow.
  vec3 tint = vTint.rgb;
  vec3 col;
  float add = 0.0;
  if (heat > 0.62) col = mix(tint, vec3(1.0, 0.96, 0.84), 0.72) * 1.8;
  else if (heat > 0.4) col = mix(tint, vec3(1.0, 0.8, 0.4), 0.4) * 1.35;
  else if (heat > 0.2) col = tint * 1.1;
  else if (heat > 0.08) { col = tint * vec3(0.8, 0.32, 0.2); add = 1.0; }
  else discard;
  // The owner's flicker, switched between a few levels rather than dimmed.
  col *= floor(vTint.a * 6.0 + 0.5) / 6.0;
  gl_FragColor = fxApplyFog(col, 1.0, add);
  #include <colorspace_fragment>
}
`;

/** Upload only the live prefix of a streaming attribute. */
export function markRange(attr: InstancedBufferAttribute, floats: number): void {
  attr.clearUpdateRanges();
  if (floats > 0) attr.addUpdateRange(0, floats);
  attr.needsUpdate = floats > 0;
}

/** Renders every registered flame (mounted once by FxSystems). */
export function FlameSprites() {
  const mesh = useRef<Mesh>(null);
  const { geometry, flameAttr, tintAttr, seedAttr } = useMemo(() => {
    const g = new InstancedBufferGeometry();
    g.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3),
    );
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const flameAttr = new InstancedBufferAttribute(new Float32Array(MAX_FLAMES * 4), 4);
    const tintAttr = new InstancedBufferAttribute(new Float32Array(MAX_FLAMES * 4), 4);
    const seedAttr = new InstancedBufferAttribute(new Float32Array(MAX_FLAMES), 1);
    flameAttr.setUsage(DynamicDrawUsage);
    tintAttr.setUsage(DynamicDrawUsage);
    seedAttr.setUsage(DynamicDrawUsage);
    g.setAttribute("aFlame", flameAttr);
    g.setAttribute("aTint", tintAttr);
    g.setAttribute("aSeed", seedAttr);
    g.instanceCount = 0;
    return { geometry: g, flameAttr, tintAttr, seedAttr };
  }, []);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { ...UniformsUtils.clone(UniformsLib.fog), uTime: fxUniforms.uTime },
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
      }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(() => {
    const n = Math.min(flames.length, MAX_FLAMES);
    const fa = flameAttr.array as Float32Array;
    const ta = tintAttr.array as Float32Array;
    const sa = seedAttr.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const f = flames[i];
      fa[i * 4] = f.x;
      fa[i * 4 + 1] = f.y;
      fa[i * 4 + 2] = f.z;
      fa[i * 4 + 3] = f.scale;
      ta[i * 4] = f.r;
      ta[i * 4 + 1] = f.g;
      ta[i * 4 + 2] = f.b;
      ta[i * 4 + 3] = f.intensity;
      sa[i] = f._seed;
    }
    markRange(flameAttr, n * 4);
    markRange(tintAttr, n * 4);
    markRange(seedAttr, n);
    geometry.instanceCount = n;
    if (mesh.current) mesh.current.visible = n > 0;
  });

  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />;
}
