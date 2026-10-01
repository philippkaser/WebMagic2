import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, MeshBasicMaterial, ShaderMaterial, Vector3, type Mesh } from "three";
import { uiNow } from "../../clock";
import { ink } from "../../theme";
import { emitUiSparks } from "../../UiSparks";
import type { RuneState } from "./copy";
import { useStepFade } from "./fade";
import { Materialize } from "./Materialize";
import { PixelSprite, unitQuad } from "./PixelSprite";
import { RUNES } from "./sprites";

/** One rune of the Tithe of Five on the location panel (artpass RunTrack):
 * a small dark square with a hairline border and a pixel rune. Floors
 * behind you are kindled arcane with a light pooled inside; the floor you
 * stand on pulses; once the way home is open all five burn gold. The moment
 * a rune kindles it flares and spits sparks. Each rune is set into the
 * panel one by one as it builds (Materialize). */

/** Box size in artpass pixels (.wm-rune) and the link between boxes. */
export const RUNE_BOX = { w: 22, h: 24, link: 6 } as const;

const LOOK: Record<RuneState, { border: string; glow: string; rune: string; inner: number; outer: number }> = {
  dark: { border: "#2c2432", glow: ink.arcane, rune: "#3a3140", inner: 0, outer: 0 },
  done: { border: ink.arcaneDim, glow: ink.arcane, rune: ink.arcane, inner: 0.55, outer: 0 },
  now: { border: ink.arcane, glow: ink.arcane, rune: ink.arcane, inner: 0.6, outer: 0.25 },
  home: { border: ink.gold, glow: ink.gold, rune: ink.gold, inner: 0.8, outer: 0.7 },
};

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec2 uPx;
uniform vec3 uBorder;
uniform vec3 uGlow;
uniform float uInner;
uniform float uOuter;
uniform float uShow;
varying vec2 vUv;
void main() {
  vec2 p = floor(vUv * uPx);
  // Chebyshev distance outside the box (2 px margin), and depth inside it.
  vec2 lo = vec2(2.0);
  vec2 hi = uPx - 3.0;
  vec2 o = max(lo - p, p - hi);
  float out_ = max(o.x, o.y);
  vec3 col;
  float a;
  if (out_ > 0.0) {
    a = uOuter * (out_ < 1.5 ? 0.55 : 0.25);
    col = uGlow;
  } else {
    float depth = -out_; // 0 on the border
    if (depth < 0.5) { col = uBorder; a = 1.0; }
    else if (depth < 1.5) { col = vec3(0.027, 0.024, 0.04); a = 1.0; }
    else {
      // Light pooled against the inner walls, in hard bands.
      float g = uInner * max(0.0, 1.0 - floor(depth - 1.0) / 4.0);
      col = mix(vec3(0.039, 0.027, 0.051), uGlow, g * 0.45);
      a = 1.0;
    }
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(col * a * uShow, a * uShow);
  #include <colorspace_fragment>
}
`;

const tmp = new Vector3();
let linkMats: Record<"dark" | "lit", MeshBasicMaterial> | null = null;

export function TitheRune({
  index,
  state,
  unit,
  linkLit,
  position,
}: {
  index: number;
  state: RuneState;
  /** World size of one artpass pixel. */
  unit: number;
  /** Draw the link to the previous rune lit (index > 0). */
  linkLit: boolean;
  position: readonly [number, number, number];
}) {
  const look = LOOK[state];
  const W = RUNE_BOX.w + 4;
  const H = RUNE_BOX.h + 4;
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uPx: { value: [W, H] },
          uBorder: { value: new Color(look.border) },
          uGlow: { value: new Color(look.glow) },
          uInner: { value: look.inner },
          uOuter: { value: look.outer },
          uShow: { value: 0 },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
      }),
    // Colours are written below, not rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const u = material.uniforms;
  (u.uBorder!.value as Color).set(look.border);
  (u.uGlow!.value as Color).set(look.glow);
  const box = useRef<Mesh>(null);
  const fade = useStepFade({ delay: 0.25 + index * 0.08, inTime: 0.2, steps: 3 });
  const lit = state !== "dark";
  const flare = useRef({ was: lit, at: -10 });

  useFrame(() => {
    const now = uiNow();
    const f = flare.current;
    if (lit && !f.was && box.current) {
      // It kindles: a flare and a spit of sparks.
      f.at = now;
      box.current.getWorldPosition(tmp);
      emitUiSparks({ position: [tmp.x, tmp.y, tmp.z], color: look.glow, count: 12, speed: unit * 60, up: unit * 40, size: unit * 2.5, spread: unit * 10, ttl: 0.8 });
    }
    f.was = lit;
    const since = now - f.at;
    const kindle = since < 0.8 ? Math.ceil((1 - since / 0.8) * 4) / 4 : 0;
    // The floor you stand on breathes (4 steps, 1.4 s, as artpass's CSS).
    const pulse = state === "now" ? Math.round((0.5 - 0.5 * Math.cos((now / 1.4) * Math.PI * 2)) * 4) / 4 : 0;
    u.uInner!.value = look.inner + pulse * 0.5 + kindle;
    u.uOuter!.value = look.outer + pulse * 0.5 + kindle * 0.8;
    u.uShow!.value = fade.current;
  });

  linkMats ??= {
    dark: new MeshBasicMaterial({ color: "#2c2432", toneMapped: false }),
    lit: new MeshBasicMaterial({ color: ink.arcaneDim, toneMapped: false }),
  };
  return (
    <group position={position as [number, number, number]}>
      <Materialize delay={0.2 + index * 0.08} color={look.glow} size={RUNE_BOX.h * unit} from={[0, 0, RUNE_BOX.h * unit * 3]} spin={1.5}>
        {index > 0 && (
          <mesh
            geometry={unitQuad()}
            material={linkMats[linkLit ? "lit" : "dark"]}
            scale={[RUNE_BOX.link * unit, 2 * unit, 1]}
            position={[-(RUNE_BOX.w + RUNE_BOX.link) * 0.5 * unit, 0, 0]}
            renderOrder={7}
          />
        )}
        <mesh ref={box} geometry={unitQuad()} material={material} scale={[W * unit, H * unit, 1]} renderOrder={7} />
        <PixelSprite name={RUNES[index % RUNES.length]!} tint={look.rune} texel={2 * unit} position={[0, 0, 0.0005]} delay={0.3 + index * 0.08} renderOrder={8} />
      </Materialize>
    </group>
  );
}
