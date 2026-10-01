import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Color, MeshBasicMaterial, PlaneGeometry, ShaderMaterial, Vector2 } from "three";
import { uiNow } from "./clock";
import { PixelFrame } from "./PixelFrame";
import { useUiShow } from "./presence";
import { ink, type FrameKind } from "./theme";

/** A small framed panel — the grimoire's `.wm-panel` as a thin physical
 * plate: a slab of dark slate (pixel grit, chips and a stepped top light,
 * on the same texel grid as its frame) with a hard drop shadow, inside a
 * pixel frame that forges itself when the plate appears and fades when it
 * goes. For prompts, messages, tooltips and labels; big menus use Tablet.
 *
 * Children sit on the plate's face (local z = 0.003). */

let quad: PlaneGeometry | null = null;
const geo = () => (quad ??= new PlaneGeometry(1, 1));

const SLATE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The slab: whole texels only — three hard bands of light from the top,
 * a slow stepped mottle, and scattered light flecks and dark pits. */
const SLATE_FRAG = /* glsl */ `
uniform vec3 uFill;
uniform vec2 uSize;
uniform float uTexel;
uniform float uOpacity;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 n = max(vec2(1.0), floor(uSize / uTexel));
  vec2 t = min(floor(vUv * uSize / uTexel), n - 1.0);
  float v = (t.y + 0.5) / n.y;
  float k = v > 0.8 ? 1.32 : v > 0.35 ? 1.0 : 0.8;
  float m = vnoise(t / 5.0);
  k *= m > 0.66 ? 1.1 : m < 0.33 ? 0.9 : 1.0;
  float h = hash(t + 3.7);
  k *= h > 0.94 ? 1.45 : h < 0.05 ? 0.62 : 1.0;
  gl_FragColor = vec4(uFill * k, uOpacity);
  #include <colorspace_fragment>
}
`;

type SlateMaterial = ShaderMaterial & {
  uniforms: { uFill: { value: Color }; uSize: { value: Vector2 }; uTexel: { value: number }; uOpacity: { value: number } };
};

function slateMaterial(fill: string): SlateMaterial {
  return new ShaderMaterial({
    uniforms: { uFill: { value: new Color(fill) }, uSize: { value: new Vector2(1, 1) }, uTexel: { value: 1 }, uOpacity: { value: 0 } },
    vertexShader: SLATE_VERT,
    fragmentShader: SLATE_FRAG,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  }) as SlateMaterial;
}

export interface PlateProps {
  width: number;
  height: number;
  frame?: FrameKind | string;
  /** World size of one frame texel. */
  texel: number;
  fill?: string;
  fillOpacity?: number;
  /** Seconds the frame takes to forge. */
  forgeTime?: number;
  children?: ReactNode;
  position?: readonly [number, number, number];
}

export function Plate({
  width,
  height,
  frame = "brass",
  texel,
  fill = "#0c0810",
  fillOpacity = 0.86,
  forgeTime = 0.35,
  children,
  position,
}: PlateProps) {
  const show = useUiShow();
  const since = useRef(uiNow());
  const forge = useRef(show ? 0 : 1);
  const fade = useRef(show ? 1 : 0);
  const fillMat = useMemo(() => slateMaterial(fill), [fill]);
  const shadowMat = useMemo(
    () => new MeshBasicMaterial({ color: ink.ink, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    [],
  );
  useEffect(
    () => () => {
      fillMat.dispose();
      shadowMat.dispose();
    },
    [fillMat, shadowMat],
  );
  useEffect(() => {
    since.current = uiNow();
  }, [show]);

  useFrame(() => {
    const t = uiNow() - since.current;
    if (show) {
      forge.current = Math.min(1, t / forgeTime);
      fade.current = 1;
    } else {
      fade.current = Math.max(0, 1 - t / 0.35);
    }
    // Stepped fill fade (4 steps) — the grimoire animates in steps.
    const f = Math.round(Math.min(1, show ? t / (forgeTime * 0.6) : fade.current) * 4) / 4;
    fillMat.uniforms.uOpacity.value = fillOpacity * f;
    shadowMat.opacity = 0.55 * f;
  });

  const outerW = width + texel * 2;
  const outerH = height + texel * 2;
  fillMat.uniforms.uSize.value.set(outerW - texel * 2, outerH - texel * 2);
  fillMat.uniforms.uTexel.value = texel;
  return (
    <group position={position as [number, number, number] | undefined}>
      <mesh geometry={geo()} material={shadowMat} scale={[outerW, outerH, 1]} position={[texel * 3, -texel * 3, -0.002]} renderOrder={3} />
      <mesh geometry={geo()} material={fillMat} scale={[outerW - texel * 2, outerH - texel * 2, 1]} renderOrder={4} />
      <PixelFrame width={outerW} height={outerH} frame={frame} texel={texel} progressRef={forge} fadeRef={fade} position={[0, 0, 0.001]} />
      <group position={[0, 0, 0.003]}>{children}</group>
    </group>
  );
}
