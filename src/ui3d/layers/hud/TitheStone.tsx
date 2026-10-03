import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { uiNow } from "../../clock";
import { ATLAS_COLS, CELL_H, CELL_W, glyphAtlas } from "../../font/atlas";
import { RUNE_BASE, RUNE_COUNT } from "../../font/glyphs";
import { stoneMaterial } from "../../materials";
import { emitUiSparks } from "../../UiSparks";
import { Materialize } from "./Materialize";

/** One stone of the Tithe of Five: a small, worn, round-edged block with a
 * rune cut into its face. Unlit, the rune is a dark groove; the floor it
 * stands for played, it KINDLES — the groove fills with light, flickering
 * like a coal — and the moment it catches it spits a few sparks. The floor
 * you stand on pulses; once the way home is open all five burn gold. The
 * runes are the same sixteen the text burns through as it materializes,
 * read straight from the glyph atlas. */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uSlot;
uniform float uLit;
uniform float uTime;
uniform float uSeed;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 cellPx = vec2(vUv.x * ${CELL_W}.0, (1.0 - vUv.y) * ${CELL_H}.0);
  ivec2 pix = clamp(ivec2(floor(cellPx)), ivec2(0), ivec2(${CELL_W - 1}, ${CELL_H - 1}));
  float col = mod(uSlot, ${ATLAS_COLS}.0);
  float row = floor(uSlot / ${ATLAS_COLS}.0);
  vec4 g = texelFetch(uAtlas, ivec2(int(col) * ${CELL_W}, int(row) * ${CELL_H}) + pix, 0);
  float flick = 0.85 + 0.15 * sin(uTime * 9.0 + uSeed * 20.0) * sin(uTime * 5.3 + uSeed * 7.0);
  vec3 lit = uColor * (g.r * 1.7 + g.g * 0.55) * flick;
  // Unlit: the carved groove, darker than the stone around it.
  vec3 c = mix(vec3(0.0), lit, min(uLit, 1.0)) * max(1.0, uLit);
  float a = mix(g.r * 0.75, g.r + g.g * 0.35, min(uLit, 1.0));
  if (a < 0.003) discard;
  gl_FragColor = vec4(c, min(1.0, a));
  #include <colorspace_fragment>
}
`;

let geo: { box: RoundedBoxGeometry; face: PlaneGeometry } | null = null;
const tmp = new Vector3();

export function TitheStone({
  index,
  lit,
  pulse = false,
  color,
  size,
  position,
}: {
  index: number;
  lit: boolean;
  /** The floor you stand on: its rune breathes. */
  pulse?: boolean;
  color: string;
  /** Stone height, m. */
  size: number;
  position: readonly [number, number, number];
}) {
  geo ??= { box: new RoundedBoxGeometry(1, 1, 1, 3, 0.22), face: new PlaneGeometry(1, 1) };
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uAtlas: { value: glyphAtlas() },
          // Each stone of the five wears its own rune.
          uSlot: { value: RUNE_BASE + ((index * 5 + 3) % RUNE_COUNT) },
          uLit: { value: lit ? 1 : 0 },
          uTime: { value: 0 },
          uSeed: { value: index * 0.37 },
          uColor: { value: new Color(color) },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
      }),
    // Colour and lit are animated below, not rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index],
  );
  useEffect(() => () => material.dispose(), [material]);
  const face = useRef<Mesh>(null);
  const state = useRef({ lit: lit ? 1 : 0, was: lit, flare: 0 });

  useEffect(() => {
    (material.uniforms.uColor!.value as Color).set(color);
  }, [color, material]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const s = state.current;
    const u = material.uniforms;
    const now = uiNow();
    u.uTime!.value = now;
    if (lit && !s.was && face.current) {
      // It catches: a spit of sparks and a flare.
      s.flare = 1;
      face.current.getWorldPosition(tmp);
      emitUiSparks({ position: [tmp.x, tmp.y, tmp.z], color, count: 12, speed: size * 4, up: size * 3, size: size * 0.18, spread: size * 0.6, ttl: 0.8 });
    }
    s.was = lit;
    s.lit += ((lit ? 1 : 0) - s.lit) * (1 - Math.exp(-dt * 4));
    s.flare *= Math.exp(-dt * 3);
    const breathe = pulse ? 0.25 * (0.5 + 0.5 * Math.sin(now * 3)) : 0;
    u.uLit!.value = Math.min(1.8, s.lit + s.flare * 0.8 + breathe);
  });

  const w = size * 0.86;
  const faceW = (size * 0.8 * CELL_W) / CELL_H;
  return (
    <Materialize position={position} delay={0.1 + index * 0.08} color={color} size={size} from={[0, 0, size * 3]} spin={1.5}>
      <mesh geometry={geo.box} material={stoneMaterial("#5a5462")} scale={[w, size, size * 0.45]} position={[0, 0, size * 0.22]} rotation={[0, 0, (index % 2 ? 1 : -1) * 0.04]} />
      <mesh ref={face} geometry={geo.face} material={material} scale={[faceW, size * 0.8, 1]} position={[0, 0, size * 0.451]} renderOrder={7} />
    </Materialize>
  );
}
