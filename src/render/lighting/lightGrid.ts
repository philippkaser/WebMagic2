import {
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  type Material,
  NearestFilter,
  RedFormat,
  RGBAFormat,
  ShaderChunk,
  UnsignedByteType,
  Vector4,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { TILE } from "../../core/config";
import { MAX_STEPS, UNSTICK } from "./gridRay";

/** The light grid: the dungeon's tile grid on the GPU, so its surfaces know
 * where the rock is.
 *
 *  - **Grid shadows.** Every pooled point light's direct light is multiplied
 *    by a visibility term marched through the floor's occupancy texture
 *    (one texel per tile) from the pixel to the light — gridRay.ts's DDA,
 *    per pixel per light. Walls are full height, so the 2D march is exact:
 *    torchlight stays in its room, a doorway throws a hard-edged wedge of
 *    light down the corridor, a bolt flying past a corner sweeps the
 *    corner's shadow across the floor. Each light is a small disc; each
 *    pixel's TEXEL (32 per metre, the painted surfaces' own grid) aims its
 *    one ray at its own spot on the disc, picked by a 2×2 ordered dither —
 *    so a shadow edge steps in whole texels and its soft band is an
 *    ordered dither, like the rest of the pixel art.
 *  - **Bounce.** A soft indirect term from a per-floor bake (bounce.ts):
 *    each torch's colour spilled through the rooms and round corners, added
 *    to the ambient irradiance — the darks lifted with colour.
 *
 * Uniform objects are shared by every patched material (like floorTint), so
 * one write per floor reaches them all. Swapping a texture or flipping
 * `uLgGrid.z` never recompiles anything, and the light COUNT is untouched.
 * The patch only goes on the dungeon's own surfaces (walls, vault, floor,
 * floor decals); with no floor mounted (`clearLightGrid`) it is a single
 * uniform branch per pixel. */

const placeholderOcc = new DataTexture(new Uint8Array([0]), 1, 1, RedFormat, UnsignedByteType);
// One byte per texel: rows of odd widths are not 4-byte aligned.
placeholderOcc.unpackAlignment = 1;
placeholderOcc.needsUpdate = true;
const placeholderBounce = new DataTexture(new Uint16Array(4), 1, 1, RGBAFormat, HalfFloatType);
placeholderBounce.needsUpdate = true;

/** Penumbra disc radius in metres (the light's apparent size). */
const SOFT_RADIUS_M = 0.36;
/** Default strength of the bounce term (scaled by each band's own). */
export const BOUNCE_STRENGTH = 1;

export const lightGridUniforms = {
  /** R8, one texel per tile: 1 = open floor. */
  uLgOcc: { value: placeholderOcc as DataTexture },
  /** RGBA16F at bounce resolution: linear irradiance (rgb). */
  uLgBounce: { value: placeholderBounce as DataTexture },
  /** x: grid size (tiles), y: penumbra radius (cells), z: shadows on, w:
   * bounce strength (0 = off). */
  uLgGrid: { value: new Vector4(1, SOFT_RADIUS_M / TILE, 0, 0) },
};

let occ: DataTexture | null = null;
let bounce: DataTexture | null = null;
let shadowsEnabled = true;
let bounceScale = 1;
let bounceStrength = 0;

/** A baked bounce field (bounce.ts): `width`² cells of rgb irradiance. */
export interface BounceField {
  width: number;
  rgb: Float32Array;
}

/** Mount a floor's grid (and its baked bounce, if any). Replaces the last. */
export function setLightGrid(tiles: Uint8Array, size: number, field: BounceField | null, strength = BOUNCE_STRENGTH): void {
  disposeTextures();
  const data = new Uint8Array(size * size);
  for (let i = 0; i < data.length; i++) data[i] = tiles[i] === 1 ? 255 : 0;
  occ = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
  occ.magFilter = NearestFilter;
  occ.minFilter = NearestFilter;
  occ.generateMipmaps = false;
  occ.unpackAlignment = 1;
  occ.needsUpdate = true;
  lightGridUniforms.uLgOcc.value = occ;

  if (field) {
    const half = new Uint16Array(field.width * field.width * 4);
    for (let i = 0; i < field.width * field.width; i++) {
      half[i * 4] = DataUtils.toHalfFloat(field.rgb[i * 3]);
      half[i * 4 + 1] = DataUtils.toHalfFloat(field.rgb[i * 3 + 1]);
      half[i * 4 + 2] = DataUtils.toHalfFloat(field.rgb[i * 3 + 2]);
      half[i * 4 + 3] = DataUtils.toHalfFloat(1);
    }
    bounce = new DataTexture(half, field.width, field.width, RGBAFormat, HalfFloatType);
    bounce.magFilter = LinearFilter;
    bounce.minFilter = LinearFilter;
    bounce.generateMipmaps = false;
    bounce.needsUpdate = true;
    lightGridUniforms.uLgBounce.value = bounce;
  }
  bounceStrength = field ? strength : 0;
  const g = lightGridUniforms.uLgGrid.value;
  g.x = size;
  apply();
}

/** No floor mounted (the village, between floors): everything off. */
export function clearLightGrid(): void {
  disposeTextures();
  lightGridUniforms.uLgOcc.value = placeholderOcc;
  lightGridUniforms.uLgBounce.value = placeholderBounce;
  lightGridUniforms.uLgGrid.value.x = 1;
  occ = null;
  bounceStrength = 0;
  apply();
}

function disposeTextures(): void {
  occ?.dispose();
  bounce?.dispose();
  occ = null;
  bounce = null;
}

function apply(): void {
  const g = lightGridUniforms.uLgGrid.value;
  g.z = occ && shadowsEnabled ? 1 : 0;
  g.w = occ ? bounceStrength * bounceScale : 0;
}

/** Dev/perf switches (A/B in the same frame): grid shadows on/off and a
 * multiplier on the bounce term. */
export function setLightGridDebug(opts: { shadows?: boolean; bounce?: number }): void {
  if (opts.shadows !== undefined) shadowsEnabled = opts.shadows;
  if (opts.bounce !== undefined) bounceScale = opts.bounce;
  apply();
}

if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__lightGrid = setLightGridDebug;
}

const TEXELS_PER_METRE = 32;

const FRAG_HEAD = /* glsl */ `
uniform sampler2D uLgOcc;
uniform sampler2D uLgBounce;
uniform vec4 uLgGrid;

// No bounds check: the grid's outer two rings are always rock, so a march
// from inside never leaves it (and WebGL makes a stray fetch safe anyway).
bool lgOpen(ivec2 c) {
  return texelFetch(uLgOcc, c, 0).r > 0.5;
}

// gridRay.ts#unstick — a light in rock steps out through its nearest face.
vec2 lgUnstick(vec2 p) {
  vec2 c = floor(p);
  if (lgOpen(ivec2(c))) return p;
  vec2 f = p - c;
  float m = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  if (m == f.x) return vec2(c.x - ${UNSTICK.toFixed(3)}, p.y);
  if (m == 1.0 - f.x) return vec2(c.x + 1.0 + ${UNSTICK.toFixed(3)}, p.y);
  if (m == f.y) return vec2(p.x, c.y - ${UNSTICK.toFixed(3)});
  return vec2(p.x, c.y + 1.0 + ${UNSTICK.toFixed(3)});
}

// gridRay.ts#gridVisible — Amanatides & Woo through the occupancy grid;
// neither end's own cell is tested.
float lgMarch(vec2 a, vec2 b) {
  ivec2 c = ivec2(floor(a));
  ivec2 e = ivec2(floor(b));
  vec2 d = b - a;
  ivec2 s = ivec2(sign(d));
  vec2 td = 1.0 / max(abs(d), vec2(1e-5));
  vec2 f = a - floor(a);
  vec2 tm = vec2(s.x > 0 ? 1.0 - f.x : f.x, s.y > 0 ? 1.0 - f.y : f.y) * td;
  for (int i = 0; i < ${MAX_STEPS}; i++) {
    if (min(tm.x, tm.y) >= 1.0 || c == e) return 1.0;
    if (tm.x < tm.y) { tm.x += td.x; c.x += s.x; }
    else { tm.y += td.y; c.y += s.y; }
    if (c == e) return 1.0;
    if (!lgOpen(c)) return 0.0;
  }
  return 1.0;
}

// gridRay.ts#lightVisibility — one ray, aimed at this texel's dithered spot
// on the light's disc: 0 or 1.
float lgVisibility(vec2 p, vec2 l, float phase) {
  vec2 u = lgUnstick(l);
  vec2 d = u - p;
  float len = length(d);
  if (len < 1e-3) return 1.0;
  float k = uLgGrid.y * (2.0 * phase - 0.75) / len;
  return lgMarch(p, lgUnstick(u + vec2(-d.y, d.x) * k));
}

vec2 lgCell(vec3 w) { return w.xz * ${(1 / TILE).toFixed(6)} + uLgGrid.x * 0.5; }
`;

/** Per-pixel setup (world position snapped to the texel grid, pushed off
 * its face, the dither phase), then each point light's visibility, one bit
 * a light in a uint (no local array) — in a plain loop, so the march is
 * compiled once rather than once per light. Never marched: lights out of
 * this pixel's reach; the eye's own (the lantern and the staff ride at the
 * camera — whatever you can see, they light); and lights well behind the
 * surface (rock is in the way by definition — a wall's far side). */
const LIGHTS_BEGIN_HEAD = /* glsl */ `
vec3 lgWorld = (-vViewPosition - viewMatrix[3].xyz) * mat3(viewMatrix);
vec3 lgNormal = normalize(nonPerturbedNormal * mat3(viewMatrix));
vec3 lgTex = floor(lgWorld * ${TEXELS_PER_METRE.toFixed(1)});
vec3 lgSnap = (lgTex + 0.5) / ${TEXELS_PER_METRE.toFixed(1)};
lgSnap.y = lgWorld.y;
uint lgMask = 0xFFFFFFFFu;
#if NUM_POINT_LIGHTS > 0
if ( uLgGrid.z > 0.5 ) {
  vec2 lgPlane = abs(lgNormal.y) > 0.5 ? lgTex.xz : (abs(lgNormal.x) > abs(lgNormal.z) ? lgTex.zy : lgTex.xy);
  vec2 lgB = mod(lgPlane, 2.0);
  float lgPhase = mod(3.0 * lgB.y + 2.0 * lgB.x, 4.0) * 0.25;
  vec2 lgP = lgCell(lgSnap + lgNormal * 0.07);
  mat3 lgR = mat3(viewMatrix);
  for ( int i = 0; i < NUM_POINT_LIGHTS && i < 32; i ++ ) {
    vec3 lgL = pointLights[ i ].position;
    vec3 lgD = lgL + vViewPosition;
    float lgCut = pointLights[ i ].distance;
    if ( lgCut > 0.0 && dot( lgD, lgD ) >= lgCut * lgCut ) continue;
    if ( dot( lgL, lgL ) < 2.25 ) continue;
    if ( pointLights[ i ].color == vec3( 0.0 ) ) continue;
    float lgV = 0.0;
    if ( dot( lgD, nonPerturbedNormal ) > -0.25 ) {
      vec3 lgLV = lgL - viewMatrix[3].xyz;
      vec2 lgLW = vec2( dot( lgLV, lgR[0] ), dot( lgLV, lgR[2] ) );
      lgV = lgVisibility( lgP, lgLW * ${(1 / TILE).toFixed(6)} + uLgGrid.x * 0.5, lgPhase );
    }
    if ( lgV < 0.5 ) lgMask &= ~( 1u << uint( i ) );
  }
}
#endif
`;

/** The unrolled light loop reads its light's bit back. */
const POINT_VIS = /* glsl */ `
		#if UNROLLED_LOOP_INDEX < 32
		directLight.color *= float( ( lgMask >> uint( UNROLLED_LOOP_INDEX ) ) & 1u );
		#endif`;

const POINT_INFO = "getPointLightInfo( pointLight, geometryPosition, directLight );";

const BOUNCE = /* glsl */ `
#if defined( RE_IndirectDiffuse )
if ( uLgGrid.w > 0.0 ) {
  // Walls read the air in front of them; the field is linear-filtered and
  // read at the texel's centre, so it steps with the painted pixels.
  vec2 lgBc = lgCell( lgSnap + lgNormal * 0.5 );
  irradiance += texture( uLgBounce, lgBc / uLgGrid.x ).rgb * uLgGrid.w;
}
#endif
`;

let patchedBegin: string | null = null;

function lightsBegin(): string {
  if (patchedBegin) return patchedBegin;
  const chunk = ShaderChunk.lights_fragment_begin;
  if (!chunk.includes(POINT_INFO)) {
    if (import.meta.env?.DEV) console.warn("lightGrid: three's lights_fragment_begin changed; grid shadows off.");
    patchedBegin = `${LIGHTS_BEGIN_HEAD}\n${chunk}`;
    return patchedBegin;
  }
  patchedBegin = `${LIGHTS_BEGIN_HEAD}\n${chunk.replace(POINT_INFO, `${POINT_INFO}\n${POINT_VIS}`)}`;
  return patchedBegin;
}

/** Patch a built-in lit material (Standard/Physical, or derived) with the
 * grid shadows and the bounce term, keeping any onBeforeCompile it has. */
export function withLightGrid<M extends Material>(material: M): M {
  // Dev: `?nolightgrid` leaves the materials as they were (perf baselines).
  if (import.meta.env?.DEV && typeof location !== "undefined" && location.search.includes("nolightgrid")) return material;
  const before = material.onBeforeCompile;
  material.onBeforeCompile = function (shader: WebGLProgramParametersWithUniforms, renderer) {
    before.call(this, shader, renderer);
    Object.assign(shader.uniforms, lightGridUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAG_HEAD}`)
      .replace("#include <lights_fragment_begin>", lightsBegin())
      .replace("#include <lights_fragment_maps>", `#include <lights_fragment_maps>\n${BOUNCE}`);
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|light-grid`;
  return material;
}
