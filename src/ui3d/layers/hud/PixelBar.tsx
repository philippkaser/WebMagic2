import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, type MutableRefObject } from "react";
import { Color, ShaderMaterial } from "three";
import { uiNow } from "../../clock";
import { ink } from "../../theme";
import { unitQuad } from "./PixelSprite";

/** The grimoire's segmented pixel bar (artpass components/Bar + its CSS),
 * drawn by one shader on a grid of whole artpass pixels so every edge is
 * hard at any size: a brass-dark hairline, an ink border, the near-black
 * channel with its inset shadow, the fill with a lit top band and a shaded
 * belly, segment ticks every n pixels — and the pale "ghost" of a loss that
 * lingers, then drains (gauge.ts).
 *
 * The fill is still a liquid: its leading edge leans as you turn and run
 * (the slosh spring), ripples when you're struck, flashes white on a blow,
 * and mana fizzes with rising bright pixels while it refills. The owner
 * writes all of that into `state` each frame; the bar only draws it. */

export interface BarState {
  /** Displayed fill and the ghost behind it, 0..1. */
  level: number;
  ghost: number;
  /** 0..1: the fill blanched toward white (a blow). */
  flash: number;
  /** Leading-edge lean, pixels per row from the middle row (slosh). */
  lean: number;
  /** Leading-edge ripple amplitude, 0..1. */
  wave: number;
  /** Rising sparkle density, 0..1. */
  bubbles: number;
  /** Fill brightness multiplier (low-health throb). */
  bright: number;
}

export function makeBarState(level = 0): BarState {
  return { level, ghost: level, flash: 0, lean: 0, wave: 0, bubbles: 0, bright: 1 };
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec2 uPx;
uniform float uLevel;
uniform float uGhost;
uniform float uSegments;
uniform float uFlash;
uniform float uLean;
uniform float uWave;
uniform float uBubbles;
uniform float uBright;
uniform float uTime;
uniform float uShow;
uniform float uReveal;
uniform vec3 uFill;
uniform vec3 uGhostCol;
uniform vec3 uHot;
uniform vec3 uTrack;
uniform vec3 uOutline;
uniform vec3 uInk;
varying vec2 vUv;

float hash(float n) { return fract(sin(n * 91.3458) * 47453.5453); }

void main() {
  vec2 p = floor(vUv * uPx);
  float W = uPx.x;
  float H = uPx.y;
  // Builds in from the left, in whole steps.
  if (p.x >= floor(uReveal * W)) discard;
  vec3 col;
  if (p.x < 1.0 || p.y < 1.0 || p.x > W - 2.0 || p.y > H - 2.0) {
    col = uOutline;
  } else if (p.x < 3.0 || p.y < 3.0 || p.x > W - 4.0 || p.y > H - 4.0) {
    col = uInk;
  } else {
    vec2 q = p - 3.0;
    float iw = W - 6.0;
    float ih = H - 6.0;
    float row = ih - 1.0 - q.y; // 0 = top row
    // The liquid's leading edge: leaning with the slosh, rippling on a blow.
    float mid = q.y - (ih - 1.0) * 0.5;
    float ripple = uWave * sin(q.y * 1.9 + uTime * 21.0) * 2.2;
    float edge = uLevel <= 0.0005 ? 0.0 : clamp(floor(uLevel * iw + 0.5 + floor(mid * uLean + ripple + 0.5)), 1.0, iw);
    float gEdge = floor(uGhost * iw + 0.5);
    col = uTrack * (row < 2.0 ? 0.45 : 1.0);
    if (q.x < edge) {
      vec3 f = uFill * uBright;
      if (row < 2.0) f = mix(f, vec3(1.0), 0.28);
      else if (row >= 6.0) f *= 0.7;
      // Rising sparks in the liquid (mana refilling).
      float h = hash(q.x + 3.0);
      float speed = 3.0 + h * 5.0;
      float by = floor(fract(uTime * speed / (ih + 2.0) + h * 7.0) * (ih + 2.0)) - 1.0;
      if (h > 1.0 - uBubbles * 0.45 && abs(q.y - by) < 0.5) f = mix(f, uHot, 0.55);
      col = mix(f, uHot, uFlash);
    } else if (q.x < gEdge) {
      col = uGhostCol;
    }
    // Segment ticks: the last two pixels of every segment, darkened.
    float segW = iw / uSegments;
    float k = floor((q.x + 0.5) / segW);
    float segEnd = floor((k + 1.0) * segW + 0.5);
    if (q.x >= segEnd - 2.0 && q.x < iw - 0.5) col *= 0.45;
  }
  gl_FragColor = vec4(col * uShow, uShow);
  #include <colorspace_fragment>
}
`;

export interface PixelBarProps {
  /** Outer size in artpass pixels (track incl. its border; the 1 px brass
   * hairline is drawn outside it). */
  width: number;
  height: number;
  /** World size of one artpass pixel. */
  unit: number;
  fill: string;
  segments: number;
  state: MutableRefObject<BarState>;
  /** Stepped visibility (fade.ts). */
  showRef: MutableRefObject<number>;
  /** 0..1 build-in from the left; omitted = follows showRef. */
  revealRef?: MutableRefObject<number>;
  position?: readonly [number, number, number];
  renderOrder?: number;
}

export function PixelBar({ width, height, unit, fill, segments, state, showRef, revealRef, position, renderOrder = 6 }: PixelBarProps) {
  const W = width + 2;
  const H = height + 2;
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uPx: { value: [W, H] },
          uLevel: { value: 0 },
          uGhost: { value: 0 },
          uSegments: { value: segments },
          uFlash: { value: 0 },
          uLean: { value: 0 },
          uWave: { value: 0 },
          uBubbles: { value: 0 },
          uBright: { value: 1 },
          uTime: { value: 0 },
          uShow: { value: 0 },
          uReveal: { value: 0 },
          uFill: { value: new Color(fill) },
          uGhostCol: { value: new Color("#f4e7c8") },
          uHot: { value: new Color("#fff6d8") },
          uTrack: { value: new Color("#07050a") },
          uOutline: { value: new Color(ink.brassDark) },
          uInk: { value: new Color(ink.ink) },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
      }),
    // Size and colours are written below, not rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const u = material.uniforms;
  u.uPx!.value = [W, H];
  u.uSegments!.value = segments;
  (u.uFill!.value as Color).set(fill);

  useFrame(() => {
    const s = state.current;
    u.uLevel!.value = s.level;
    u.uGhost!.value = s.ghost;
    u.uFlash!.value = s.flash;
    u.uLean!.value = s.lean;
    u.uWave!.value = s.wave;
    u.uBubbles!.value = s.bubbles;
    u.uBright!.value = s.bright;
    u.uTime!.value = uiNow();
    u.uShow!.value = showRef.current;
    u.uReveal!.value = revealRef ? revealRef.current : showRef.current;
  });

  return (
    <mesh
      geometry={unitQuad()}
      material={material}
      scale={[W * unit, H * unit, 1]}
      position={position as [number, number, number] | undefined}
      renderOrder={renderOrder}
    />
  );
}
