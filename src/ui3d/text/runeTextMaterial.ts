import { Color, ShaderMaterial, Vector2 } from "three";
import { getPixelFace, type Face } from "../font/faces";

/** The shader behind every word of in-world text.
 *
 * One instanced quad per glyph. Each glyph has its own timeline, computed on
 * the GPU from a birth time (per instance) and the block's vanish time (a
 * uniform), so a line of text costs one draw call and zero per-frame CPU:
 *
 *   materialize  the glyph drifts in from the dark behind its place,
 *                tumbling, and burns in pixel by pixel as a white-hot RUNE;
 *                the rune's pixels then cool one by one into the letter.
 *                Glyphs start in reading order, so lines write themselves.
 *   hold         steady, with the faintest candle flicker.
 *   dissolve     pixels burn away from random seeds with an ember edge while
 *                the glyph rises and drifts toward the viewer, halo fading.
 *
 * Output is premultiplied: halo pixels add more colour than they cover, so
 * the glow brightens what is behind it (the transparent UI canvas is
 * composited over the world), while the dark outline darkens it. */

const VERT = /* glsl */ `
uniform float uPx;
uniform vec2 uOrigin;
uniform float uTime;
uniform float uIn;
uniform float uStagger;
uniform float uVanishAt;
uniform float uOut;
uniform float uOutStagger;
uniform float uDepth;
uniform vec2 uCell;
uniform vec2 uGlyphOrigin;
uniform vec2 uHalfGlyph;

attribute vec2 aCell;
attribute vec2 aSlots;
attribute vec3 aColor;
attribute vec3 aMeta;

varying vec2 vUv;
varying vec2 vSlots;
varying vec3 vColor;
varying float vIn;
varying float vOut;
varying float vSeed;


mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

void main() {
  float order = aMeta.x;
  float seed = aMeta.y;
  float born = aMeta.z;
  float tin = clamp((uTime - born - order * uStagger) / uIn, 0.0, 1.0);
  float tout = clamp((uTime - uVanishAt - order * uOutStagger) / uOut, 0.0, 1.0);
  vIn = tin; vOut = tout; vSeed = seed; vSlots = aSlots; vColor = aColor; vUv = uv;

  // Font space: pixels, y down, origin at the block's anchor.
  vec2 p = aCell + vec2(uv.x * uCell.x, (1.0 - uv.y) * uCell.y) - uGlyphOrigin - uOrigin;
  vec2 c = aCell + uHalfGlyph - uOrigin;

  float e = 1.0 - pow(1.0 - tin, 3.0);
  float away = 1.0 - e;
  float o = tout * tout;
  float spin = away * (seed - 0.5) * 2.4 + o * (seed - 0.5) * 3.0;
  vec2 d = rot(spin) * (p - c) * (1.0 + away * 0.6 - o * 0.3);
  p = c + d;
  p.y -= away * (seed - 0.5) * 8.0 + o * (6.0 + seed * 16.0);
  p.x += o * (seed - 0.5) * 14.0;

  vec3 pos = vec3(p.x, -p.y, (-away * 30.0 + o * 12.0) * uDepth) * uPx;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uTime;
uniform float uGlow;
uniform float uOutline;
uniform float uOpacity;
uniform float uFlicker;
uniform float uBright;
uniform vec3 uHot;
uniform vec2 uCell;
uniform float uCols;

varying vec2 vUv;
varying vec2 vSlots;
varying vec3 vColor;
varying float vIn;
varying float vOut;
varying float vSeed;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

ivec2 cellOrigin(float slotIn) {
  // Slots arrive through a varying: constant across the quad, but
  // interpolation can deliver 66.9999 for 67 — round, or every so often a
  // "c" renders as the "b" before it.
  float slot = floor(slotIn + 0.5);
  float col = mod(slot, uCols);
  float row = floor(slot / uCols);
  return ivec2(int(col) * int(uCell.x), int(row) * int(uCell.y));
}

void main() {
  vec2 cellPx = vec2(vUv.x * uCell.x, (1.0 - vUv.y) * uCell.y);
  ivec2 pix = clamp(ivec2(floor(cellPx)), ivec2(0), ivec2(uCell) - 1);
  vec4 L = texelFetch(uAtlas, cellOrigin(vSlots.x) + pix, 0);
  vec4 R = texelFetch(uAtlas, cellOrigin(vSlots.y) + pix, 0);

  // Materialize: pixels burn in (appear) as the rune, then cool into the
  // letter (settle). The same per-pixel seed drives both, so each pixel is
  // first rune, then letter — the glyph morphs rather than cross-fades.
  float n = hash(vec2(pix) + vSeed * 97.0);
  float appear = smoothstep(0.0, 0.45, vIn);
  float settle = smoothstep(0.3, 1.0, vIn);
  bool letter = n < settle;
  vec4 G = letter ? L : R;
  float shown = step(n, appear);

  // Dissolve: pixels burn away in a different random order, ember-edged.
  float n2 = hash(vec2(pix) * 1.37 + 13.1 + vSeed * 31.0);
  float front = vOut * 1.25;
  float gone = step(n2, front - 0.25);
  float burning = (1.0 - gone) * step(n2, front) * step(0.001, vOut);

  float core = G.r * shown * (1.0 - gone);
  float outline = G.b * shown * (1.0 - gone) * (1.0 - vOut);
  float halo = mix(R.g, L.g, settle) * appear * (1.0 - vOut * vOut);

  float heat = letter ? (1.0 - settle) * 0.7 : 1.0;
  heat = max(heat, burning);
  float flick = 1.0 + uFlicker * (sin(uTime * 11.0 + vSeed * 40.0) * 0.5 + sin(uTime * 23.0 + vSeed * 17.0) * 0.3);
  vec3 hot = mix(vColor, uHot, 0.7) * 1.8;
  vec3 coreCol = mix(vColor, hot, heat) * flick * uBright;

  // Layers, back to front: halo (only OUTSIDE the outline, or it would
  // wash the dark rim grey and smear the letter), dark outline, ink.
  float ol = outline * (1.0 - core);
  vec3 col = coreCol * core;
  float a = core + ol * uOutline;
  float h = halo * uGlow * (1.0 - outline) * 0.55 * (1.0 + burning);
  col += mix(vColor, hot, vOut) * h;
  a += h * 0.3;

  gl_FragColor = vec4(col, min(a, 1.0)) * uOpacity;
  if (gl_FragColor.a < 0.002 && dot(gl_FragColor.rgb, gl_FragColor.rgb) < 0.00001) discard;
  #include <colorspace_fragment>
}
`;

export interface RuneTextUniforms {
  uAtlas: { value: Face["texture"] };
  uCell: { value: Vector2 };
  uCols: { value: number };
  uGlyphOrigin: { value: Vector2 };
  uHalfGlyph: { value: Vector2 };
  uPx: { value: number };
  uOrigin: { value: Vector2 };
  uTime: { value: number };
  uIn: { value: number };
  uStagger: { value: number };
  uVanishAt: { value: number };
  uOut: { value: number };
  uOutStagger: { value: number };
  uDepth: { value: number };
  uGlow: { value: number };
  uOutline: { value: number };
  uOpacity: { value: number };
  uFlicker: { value: number };
  uBright: { value: number };
  uHot: { value: Color };
}

export type RuneTextMaterial = ShaderMaterial & { uniforms: RuneTextUniforms };

/** Far future: "not vanishing" without a branch in the shader. */
export const NEVER = 1e7;

/** Point a material at a face: its atlas and the cell geometry the shader
 * needs to find and place glyphs. */
export function applyFace(material: RuneTextMaterial, face: Face): void {
  const u = material.uniforms;
  u.uAtlas.value = face.texture;
  u.uCell.value.set(face.cellW, face.cellH);
  u.uCols.value = face.cols;
  u.uGlyphOrigin.value.set(face.originX, face.originY);
  u.uHalfGlyph.value.set(face.halfGlyphW, face.halfGlyphH);
}

export function createRuneTextMaterial(face: Face = getPixelFace()): RuneTextMaterial {
  const uniforms: RuneTextUniforms = {
    uAtlas: { value: face.texture },
    uCell: { value: new Vector2(face.cellW, face.cellH) },
    uCols: { value: face.cols },
    uGlyphOrigin: { value: new Vector2(face.originX, face.originY) },
    uHalfGlyph: { value: new Vector2(face.halfGlyphW, face.halfGlyphH) },
    uPx: { value: 0.01 },
    uOrigin: { value: new Vector2() },
    uTime: { value: 0 },
    uIn: { value: 0.45 },
    uStagger: { value: 0.4 },
    uVanishAt: { value: NEVER },
    uOut: { value: 0.6 },
    uOutStagger: { value: 0.25 },
    uDepth: { value: 1 },
    uGlow: { value: 1 },
    uOutline: { value: 0.75 },
    uOpacity: { value: 1 },
    uFlicker: { value: 0.04 },
    uBright: { value: 1 },
    uHot: { value: new Color("#fff1d0") },
  };
  const material = new ShaderMaterial({
    uniforms: uniforms as unknown as ShaderMaterial["uniforms"],
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
  });
  return material as RuneTextMaterial;
}
