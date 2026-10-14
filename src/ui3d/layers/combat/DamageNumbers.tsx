import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
} from "three";
import { numberLook, numberText } from "../../../combat/numbers";
import { damageNumbers, stepDamageNumbers } from "../../../combat/shooter";
import { useGame } from "../../../state/gameStore";
import { ATLAS_COLS, ATLAS_PAD, CELL_H, CELL_W, glyphAtlas } from "../../font/atlas";
import { ADVANCE, GLYPH_H, GLYPH_W, glyphSlot } from "../../font/glyphs";

/** Your damage, popping off what you hit in the game's own hand-set pixel
 * font (font/glyphs) — bone-white, gold with a "!" for a precision hit,
 * white-hot cooling to red for the killing blow — rising and fading over
 * most of a second, a stream's ticks pouring into one climbing number
 * (combat/numbers; combat/shooter feeds it your hits only).
 *
 * In the world but drawn on the UI canvas: anchored to the hit point (the
 * UI camera is the world camera) and snapped to whole screen pixels, every
 * font pixel the same whole number of them — crisp, never mush. Constant
 * size on screen, like a hit marker. One draw call: an instanced quad per
 * glyph, attributes rewritten only for live numbers. The UI canvas draws
 * over the world, so numbers show through a wall — fine for the second they
 * live, on something you just hit. */

/** Characters per number (5 digits and a "!"). */
const MAX_CHARS = 6;
const MAX_GLYPHS = damageNumbers.items.length * MAX_CHARS;
/** The quad around each glyph: its 6×8 cell plus a pixel of outline round. */
const QW = GLYPH_W + 2;
const QH = GLYPH_H + 2;

const VERT = /* glsl */ `
attribute vec3 aCenter;
attribute vec2 aCell;
attribute float aSlot;
attribute vec3 aColor;
attribute float aAlpha;
attribute float aScale;
attribute vec2 aNudge;
uniform vec2 uViewport;
varying vec2 vGlyph;
varying float vSlot;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec4 clip = projectionMatrix * viewMatrix * vec4(aCenter, 1.0);
  if (clip.w <= 0.0 || aAlpha <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // The anchor on a whole screen pixel, the glyph's pixels whole multiples.
  vec2 anchor = floor((clip.xy / clip.w * 0.5 + 0.5) * uViewport + 0.5) + aNudge;
  // Font pixels within the glyph's cell: x right, y down, -1 … size.
  vGlyph = vec2(position.x * ${QW}.0 - 1.0, (1.0 - position.y) * ${QH}.0 - 1.0);
  vec2 screen = anchor + vec2(aCell.x + vGlyph.x, aCell.y - vGlyph.y) * aScale;
  gl_Position = vec4(screen / uViewport * 2.0 - 1.0, 0.0, 1.0);
  vSlot = aSlot;
  vColor = aColor;
  vAlpha = aAlpha;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vGlyph;
varying float vSlot;
varying vec3 vColor;
varying float vAlpha;

void main() {
  // Round: interpolation can hand over 66.9999 for slot 67.
  float slot = floor(vSlot + 0.5);
  ivec2 cell = ivec2(int(mod(slot, ${ATLAS_COLS}.0)) * ${CELL_W} + ${ATLAS_PAD}, int(floor(slot / ${ATLAS_COLS}.0)) * ${CELL_H} + ${ATLAS_PAD});
  vec4 s = texelFetch(uAtlas, cell + ivec2(floor(vGlyph)), 0);
  bool inked = s.r > 0.5;
  if (!inked && s.b < 0.5) discard;
  vec3 col = inked ? vColor : vec3(0.03, 0.02, 0.05);
  float a = (inked ? 1.0 : 0.85) * vAlpha;
  gl_FragColor = vec4(col * a, a);
  #include <colorspace_fragment>
}
`;

/** Glyph slots of the characters a number uses (char codes 48–57, 33). */
const DIGIT_SLOTS = Array.from({ length: 10 }, (_, d) => glyphSlot(String(d)));
const BANG_SLOT = glyphSlot("!");

const PLAIN = new Color("#f4ecd8");
const GOLD = new Color("#ffd44f");
const HOT = new Color("#fff0c4");
const RED = new Color("#ff4a2a");
/** Size by style, before the pop: precision and killing blows stand out. */
const STYLE_SCALE = [1, 1.25, 1.5] as const;

const buffer = new Vector2();
const tmpColor = new Color();

export function DamageNumbers() {
  const { mesh, attrs, material } = useMemo(() => {
    const geometry = new InstancedBufferGeometry();
    const quad = new PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
    geometry.index = quad.index;
    geometry.setAttribute("position", quad.getAttribute("position"));
    const attr = (size: number) => new InstancedBufferAttribute(new Float32Array(MAX_GLYPHS * size), size);
    const attrs = { center: attr(3), cell: attr(2), slot: attr(1), color: attr(3), alpha: attr(1), scale: attr(1), nudge: attr(2) };
    geometry.setAttribute("aCenter", attrs.center);
    geometry.setAttribute("aCell", attrs.cell);
    geometry.setAttribute("aSlot", attrs.slot);
    geometry.setAttribute("aColor", attrs.color);
    geometry.setAttribute("aAlpha", attrs.alpha);
    geometry.setAttribute("aScale", attrs.scale);
    geometry.setAttribute("aNudge", attrs.nudge);
    geometry.instanceCount = 0;
    const material = new ShaderMaterial({
      uniforms: { uAtlas: { value: glyphAtlas() }, uViewport: { value: new Vector2(1, 1) } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 55;
    return { mesh, attrs, material };
  }, []);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      material.dispose();
    },
    [mesh, material],
  );
  const chars = useMemo(() => new Array<number>(MAX_CHARS).fill(0), []);

  useFrame(({ gl }, rawDt) => {
    // Real time: a number's life is its life, however slow the frames.
    stepDamageNumbers(Math.min(rawDt, 0.5));
    const s = useGame.getState();
    mesh.visible = (s.phase === "village" || s.phase === "dungeon") && s.overlay === "none";
    if (!mesh.visible) return;
    gl.getDrawingBufferSize(buffer);
    material.uniforms.uViewport!.value.copy(buffer);
    // About 2% of the view's height a glyph, in whole pixels.
    const unit = Math.max(1, Math.round(buffer.y / 330));

    let n = 0;
    for (const e of damageNumbers.items) {
      if (!e.live) continue;
      const look = numberLook(e);
      const len = numberText(e, chars);
      const scale = Math.max(1, Math.round(unit * STYLE_SCALE[e.style] * look.scale));
      // The killing blow cools from white-hot to red as it settles.
      if (e.style === 2) tmpColor.copy(HOT).lerp(RED, Math.min(1, e.bump / 0.25));
      else tmpColor.copy(e.style === 1 ? GOLD : PLAIN);
      const cy = e.y + look.rise;
      // Centred on the anchor; the last glyph's gap column doesn't count.
      const left = -Math.floor((len * ADVANCE - 1) / 2);
      for (let i = 0; i < len && n < MAX_GLYPHS; i++, n++) {
        const code = chars[i]!;
        attrs.center.setXYZ(n, e.x, cy, e.z);
        attrs.nudge.setXY(n, e.dx * unit, e.dy * unit);
        attrs.cell.setXY(n, left + i * ADVANCE, GLYPH_H / 2);
        attrs.slot.setX(n, code === 33 ? BANG_SLOT : DIGIT_SLOTS[code - 48]!);
        attrs.color.setXYZ(n, tmpColor.r, tmpColor.g, tmpColor.b);
        attrs.alpha.setX(n, look.alpha);
        attrs.scale.setX(n, scale);
      }
    }
    mesh.geometry.instanceCount = n;
    if (n > 0) for (const a of Object.values(attrs)) a.needsUpdate = true;
  });

  return <primitive object={mesh} />;
}
