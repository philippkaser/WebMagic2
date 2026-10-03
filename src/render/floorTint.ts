import { Color, type Material, type WebGLProgramParametersWithUniforms } from "three";

/** A floor's tint: no two floors of a band in quite the same light, and no
 * floor all one colour from end to end.
 *
 * Each floor turns its band's palette a little around the colour wheel
 * (seeded, so everyone on the floor sees the same), and across the floor the
 * hue and brightness drift slowly from region to region — a room a shade
 * greener, the next hall a shade colder and darker, one richer in colour,
 * one paler; the painted glow (magma seams, crystal veins) drifts along.
 * It is applied to the dungeon's own surfaces (walls, ceilings, floors) in their shaders, after
 * the painted map is read and before lighting, so torchlight and the grade
 * still sit on top; the ambient light turns with it, and the torches and
 * the fog take a share of the turn. */

export interface FloorTint {
  /** The floor's turn of the hue, radians. */
  hue: number;
  /** How far the hue drifts either way across the floor, radians. */
  drift: number;
  /** How far brightness drifts either way (a fraction). */
  value: number;
  /** Where on the drift field this floor lies (seeded). */
  offset: [number, number];
}

const MAX_TURN = 0.4;
const DRIFT = 0.3;
const VALUE = 0.1;

function rand(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt + 0x9e37, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The tint of the floor rolled from `seed`. */
export function floorTint(seed: number): FloorTint {
  return {
    hue: (rand(seed, 1) * 2 - 1) * MAX_TURN,
    drift: DRIFT,
    value: VALUE,
    offset: [rand(seed, 2) * 97, rand(seed, 3) * 97],
  };
}

/** No tint (the village, between floors). */
export const NO_TINT: FloorTint = { hue: 0, drift: 0, value: 0, offset: [0, 0] };

/** `hex` turned `turn` radians around the colour wheel. */
export function turnHue(hex: string, turn: number): string {
  const c = new Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL((((hsl.h + turn / (Math.PI * 2)) % 1) + 1) % 1, hsl.s, hsl.l);
  return `#${c.getHexString()}`;
}

const uniforms = {
  uTintHue: { value: 0 },
  uTintDrift: { value: 0 },
  uTintValue: { value: 0 },
  uTintOffset: { value: [0, 0] as [number, number] },
};

/** Make `t` the tint every tinted material draws with (no recompile). */
export function setFloorTint(t: FloorTint): void {
  uniforms.uTintHue.value = t.hue;
  uniforms.uTintDrift.value = t.drift;
  uniforms.uTintValue.value = t.value;
  uniforms.uTintOffset.value = t.offset;
}

const VERT_HEAD = /* glsl */ `
varying vec3 vTintW;
`;
const VERT_BODY = /* glsl */ `
{
  vec4 tintP = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  tintP = instanceMatrix * tintP;
  #endif
  vTintW = (modelMatrix * tintP).xyz;
}
`;
const FRAG_HEAD = /* glsl */ `
uniform float uTintHue;
uniform float uTintDrift;
uniform float uTintValue;
uniform vec2 uTintOffset;
varying vec3 vTintW;
float tintHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tintNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(tintHash(i), tintHash(i + vec2(1.0, 0.0)), f.x), mix(tintHash(i + vec2(0.0, 1.0)), tintHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 tintTurn(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
`;
const FRAG_BODY = /* glsl */ `
{
  // Regions about a room across drift in hue; smaller ones in brightness.
  float tintN = tintNoise(vTintW.xz * 0.055 + uTintOffset);
  float tintV = tintNoise(vTintW.xz * 0.12 + uTintOffset.yx + 7.0);
  float tintS = tintNoise(vTintW.xz * 0.04 + uTintOffset * 1.7 + 3.0);
  float tintA = uTintHue + (tintN - 0.5) * 2.0 * uTintDrift;
  vec3 tintC = max(tintTurn(diffuseColor.rgb, tintA), 0.0);
  // Grey stone hides a turn of hue: some regions are richer in colour too.
  float tintL = dot(tintC, vec3(0.299, 0.587, 0.114));
  tintC = max(mix(vec3(tintL), tintC, 1.0 + (tintS - 0.5) * 2.0 * uTintDrift * 1.6), 0.0);
  diffuseColor.rgb = tintC * (1.0 + (tintV - 0.5) * 2.0 * uTintValue);
}
`;
const EMISSIVE_BODY = /* glsl */ `
{
  // The painted glow (seams, veins, specks) drifts with the stone.
  float tintN2 = tintNoise(vTintW.xz * 0.055 + uTintOffset);
  totalEmissiveRadiance = max(tintTurn(totalEmissiveRadiance, (uTintHue + (tintN2 - 0.5) * 2.0 * uTintDrift) * 0.75), 0.0);
}
`;

/** Inject the floor tint into a built-in lit material (Standard/Physical, or
 * one derived from them), keeping any onBeforeCompile it already has. */
export function withFloorTint<M extends Material>(material: M): M {
  const before = material.onBeforeCompile;
  material.onBeforeCompile = function (shader: WebGLProgramParametersWithUniforms, renderer) {
    before.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERT_HEAD}`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAG_HEAD}`)
      .replace("#include <map_fragment>", `#include <map_fragment>\n${FRAG_BODY}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${EMISSIVE_BODY}`);
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|floor-tint`;
  return material;
}
