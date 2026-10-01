import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { Color, DataTexture, Mesh, NearestFilter, PlaneGeometry, RGBAFormat, ShaderMaterial, SRGBColorSpace, UnsignedByteType } from "three";
import { uiNow } from "./clock";
import { LIGHT_BLENDING } from "./holo/holoMaterial";
import { frameFor, ink, type FrameColors, type FrameKind } from "./theme";

/** A pixel-art frame around a rectangle — the grimoire's brass trim, in 3D.
 *
 * The frame is a 12×12 nine-slice bitmap (ink outline, trim band, lit and
 * shadowed edges, notched corners with a bright rivet — after artpass's DOM
 * frames), painted in code and stretched over a single quad by a shader that
 * keeps every texel square and hard-edged at any size: corners stay 4×4
 * texels, edges tile their middle texels. `progress` (0→1) lets the frame
 * forge itself: the trim runs out from the bottom centre along both sides
 * and meets at the top, a white-hot pixel at each leading end. */

const S = 12;
const SLICE = 4;

const cache = new Map<string, DataTexture>();

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The 12×12 nine-slice source, row 0 = top (read with texelFetch). */
export function frameTexture(c: FrameColors): DataTexture {
  const key = `${c.trim}|${c.light}|${c.dark}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const data = new Uint8Array(S * S * 4);
  const put = (x: number, y: number, hex: string | null, a = 255) => {
    const i = (y * S + x) * 4;
    if (!hex) {
      data[i + 3] = 0;
      return;
    }
    const [r, g, b] = hexRgb(hex);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  };
  // Edge profile from the outside in: ink outline, trim, dark, soft shadow.
  const band: [string, number][] = [
    [ink.ink, 255],
    [c.trim, 255],
    [c.dark, 255],
    ["#000000", 115],
  ];
  for (let i = 0; i < S; i++)
    for (let d = 0; d < SLICE; d++) {
      const [hex, a] = band[d]!;
      put(i, d, hex, a);
      put(i, S - 1 - d, hex, a);
      put(d, i, hex, a);
      put(S - 1 - d, i, hex, a);
    }
  // Top and left trim catch the light.
  for (let i = SLICE; i < S - SLICE; i++) {
    put(i, 1, c.light);
    put(1, i, c.light);
  }
  // Notched corners with a rivet.
  const corner = ["..oo", ".oLT", "oLMt", "oTtd"];
  const pal: Record<string, string> = { o: ink.ink, L: c.light, M: "#fff6d8", T: c.trim, t: c.trim, d: c.dark };
  for (let y = 0; y < SLICE; y++)
    for (let x = 0; x < SLICE; x++) {
      const ch = corner[y]![x]!;
      const hex = ch === "." ? null : pal[ch]!;
      put(x, y, hex);
      put(S - 1 - x, y, hex);
      put(x, S - 1 - y, hex);
      put(S - 1 - x, S - 1 - y, hex);
    }
  const t = new DataTexture(data, S, S, RGBAFormat, UnsignedByteType);
  // The bytes are sRGB hex colours: decode on fetch, or the output pass
  // encodes them twice and brass turns pale cream.
  t.colorSpace = SRGBColorSpace;
  t.magFilter = t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The frame as cast light (the UI is magic, not carpentry): no ink
 * outline and no bevel — a thread of the frame's light two texels in,
 * pulsing as power flows round it, a faint dithered glow outside it, and a
 * bright rune-dot at each corner. It still draws itself round from the
 * bottom centre (uProgress) with a white-hot leading spark. Pure added
 * light in display values (no colour-space step). */
const FRAG = /* glsl */ `
uniform sampler2D uFrame;
uniform vec2 uSize;      // quad size, world units
uniform float uTexel;    // world size of one frame texel
uniform float uProgress; // 0..1 forge-in
uniform float uFade;
uniform float uTime;
uniform vec3 uHot;
varying vec2 vUv;

void main() {
  vec2 p = vUv * uSize;
  vec2 n = floor(uSize / uTexel);
  vec2 t = min(floor(p / uTexel), n - 1.0);
  float d = min(min(t.x, t.y), min(n.x - 1.0 - t.x, n.y - 1.0 - t.y));
  if (d > 3.5) discard;
  // The frame's lit tone (its bitmap's top edge), decoded to display values.
  vec3 light = pow(texelFetch(uFrame, ivec2(6, 1), 0).rgb, vec3(1.0 / 2.2));

  // Perimeter position from the bottom centre (0) up both sides to the top
  // centre (1), in whole texels, for the forge.
  vec2 q = (t + 0.5) * uTexel;
  float dx = abs(q.x - uSize.x * 0.5);
  float dB = q.y;
  float dT = uSize.y - q.y;
  float dS = uSize.x * 0.5 - dx;
  float s;
  if (dB <= min(dT, dS)) s = dx;
  else if (dS <= dT) s = uSize.x * 0.5 + q.y;
  else s = uSize.x * 0.5 + uSize.y + (uSize.x * 0.5 - dx);
  s /= (uSize.x + uSize.y);
  float front = uProgress * 1.02;
  if (s > front) discard;
  float hot = step(front - 0.012, s) * step(uProgress, 0.999);

  float flow = 0.5 + 0.5 * sin(s * 40.0 - uTime * 2.5);
  float b = 0.0;
  if (abs(d - 1.0) < 0.5) b = 0.32 + 0.22 * flow;
  else if (abs(d - 2.0) < 0.5) b = 0.06;
  else if (d < 0.5) b = mod(t.x + t.y, 2.0) < 1.0 ? 0.08 : 0.0;
  // Rune-dots at the corners.
  vec2 cd = min(t, n - 1.0 - t);
  if (cd.x < 2.5 && cd.y < 2.5 && abs(cd.x - cd.y) < 1.5) b = max(b, cd.x + cd.y < 3.5 ? 0.85 : 0.2);
  if (b <= 0.0) discard;
  vec3 col = mix(light * b, uHot, hot);
  gl_FragColor = vec4(col * uFade, 0.0);
}
`;

let quad: PlaneGeometry | null = null;

export interface PixelFrameProps {
  width: number;
  height: number;
  /** Frame colours: a named frame or any accent colour. */
  frame?: FrameKind | string;
  /** World size of one frame texel (the border is 4 texels thick). */
  texel?: number;
  /** Forge progress source: seconds since the frame should start forging,
   * or null when fully shown. Driven by a ref for zero re-renders. */
  progressRef?: { current: number };
  fadeRef?: { current: number };
  position?: readonly [number, number, number];
  renderOrder?: number;
}

export function PixelFrame({
  width,
  height,
  frame = "brass",
  texel = 0.006,
  progressRef,
  fadeRef,
  position,
  renderOrder = 6,
}: PixelFrameProps) {
  const colors = frameFor(frame);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uFrame: { value: frameTexture(colors) },
          uSize: { value: [width, height] },
          uTexel: { value: texel },
          uProgress: { value: 1 },
          uFade: { value: 1 },
          uTime: { value: 0 },
          uHot: { value: new Color("#fff6d8") },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        ...LIGHT_BLENDING,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colors.trim, colors.light, colors.dark],
  );
  const mesh = useMemo(() => {
    const m = new Mesh((quad ??= new PlaneGeometry(1, 1)), material);
    m.renderOrder = renderOrder;
    return m;
  }, [material, renderOrder]);
  useEffect(() => () => material.dispose(), [material]);

  mesh.scale.set(width, height, 1);
  material.uniforms.uSize!.value = [width, height];
  material.uniforms.uTexel!.value = texel;

  useFrame(() => {
    material.uniforms.uTime!.value = uiNow();
    material.uniforms.uProgress!.value = progressRef ? progressRef.current : 1;
    material.uniforms.uFade!.value = fadeRef ? fadeRef.current : 1;
  });

  return <primitive object={mesh} position={position as [number, number, number] | undefined} />;
}
