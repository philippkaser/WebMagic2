import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { Color, DataTexture, Mesh, NearestFilter, PlaneGeometry, RGBAFormat, ShaderMaterial, UnsignedByteType } from "three";
import { uiNow } from "./clock";
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

const FRAG = /* glsl */ `
uniform sampler2D uFrame;
uniform vec2 uSize;      // quad size, world units
uniform float uTexel;    // world size of one frame texel
uniform float uProgress; // 0..1 forge-in
uniform float uFade;     // 1 → 0 on close
uniform float uTime;
uniform vec3 uHot;
varying vec2 vUv;

// Nine-slice: world position → texel of the 12×12 source (row 0 = top).
int sliceAxis(float p, float size) {
  float t = p / uTexel;
  float n = size / uTexel;
  if (t < 4.0) return int(floor(t));
  if (t > n - 4.0) return 11 - int(floor(n - t));
  return 4 + int(mod(floor(t - 4.0), 4.0));
}

void main() {
  vec2 p = vUv * uSize;              // from bottom-left
  vec2 fromTop = vec2(p.x, uSize.y - p.y);
  float border = 4.0 * uTexel;
  bool inBand = p.x < border || p.y < border || p.x > uSize.x - border || p.y > uSize.y - border;
  if (!inBand) discard;
  ivec2 tx = ivec2(sliceAxis(fromTop.x, uSize.x), sliceAxis(fromTop.y, uSize.y));
  vec4 c = texelFetch(uFrame, tx, 0);
  if (c.a < 0.01) discard;

  // Perimeter position from the bottom centre (0) up both sides to the
  // top centre (1), quantized to whole texels so the trim grows in steps.
  vec2 q = floor(p / uTexel) * uTexel + 0.5 * uTexel;
  float s;
  float dx = abs(q.x - uSize.x * 0.5);
  float dBottom = q.y;
  float dTop = uSize.y - q.y;
  float dSide = uSize.x * 0.5 - dx;
  if (dBottom <= min(dTop, dSide)) s = dx;
  else if (dSide <= dTop) s = uSize.x * 0.5 + q.y;
  else s = uSize.x * 0.5 + uSize.y + (uSize.x * 0.5 - dx);
  s /= (uSize.x + uSize.y);
  float front = uProgress * 1.02;
  if (s > front) discard;
  float hot = step(front - 0.012, s) * step(uProgress, 0.999);
  vec3 col = mix(c.rgb, uHot, hot);
  gl_FragColor = vec4(col * c.a, c.a) * uFade;
  #include <colorspace_fragment>
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
        premultipliedAlpha: true,
        depthWrite: false,
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
