import { Color, DataTexture, NearestFilter, RGBAFormat, ShaderMaterial, SRGBColorSpace, UnsignedByteType } from "three";
import { frameTexture } from "../../PixelFrame";
import type { FrameColors } from "../../theme";

/** The item card a socket is drawn as — artpass's `.wm-card` in one quad:
 *
 *   - the grimoire's 12×12 nine-slice pixel frame (PixelFrame's bitmap:
 *     ink outline, trim, lit and shadowed edges, notched corners with a
 *     rivet) in the item's grade colours, forging itself around the rim
 *     when the socket rises;
 *   - a soot fill lit in three hard bands from the top, with the grade's
 *     colour pooled behind the item in stepped rings (the card's radial
 *     glow, quantized: no soft gradients);
 *   - a hard 1-texel ring and a flat wash for hover and drag feedback;
 *   - the level plate in the bottom-right corner (ink box, grade-coloured
 *     top and left edge — the number itself is RuneText);
 *   - a hard offset drop shadow.
 *
 * One draw call per socket, and every look change is a uniform write (the
 * frame swaps textures from a cache), so sockets never re-render to light
 * up. */

const frames = new Map<string, DataTexture>();

/** PixelFrame's bitmap, re-wrapped as an sRGB texture so the frame's bytes
 * mean the same colours as the uniforms they're mixed with — and with the
 * corner rivets in the frame's own light tone instead of white-hot: a page
 * of thirty cards shouldn't sparkle at every corner. */
export function cardFrame(c: FrameColors): DataTexture {
  const key = `${c.trim}|${c.light}|${c.dark}`;
  let t = frames.get(key);
  if (!t) {
    const src = frameTexture(c).image;
    const data = new Uint8Array(src.data as Uint8Array);
    const n = parseInt(c.light.slice(1, 7), 16);
    for (let i = 0; i < data.length; i += 4) {
      // The rivet is the bitmap's one #fff6d8 pixel per corner.
      if (data[i] === 0xff && data[i + 1] === 0xf6 && data[i + 2] === 0xd8) {
        data[i] = (n >> 16) & 255;
        data[i + 1] = (n >> 8) & 255;
        data[i + 2] = n & 255;
      }
    }
    t = new DataTexture(data, src.width, src.height, RGBAFormat, UnsignedByteType);
    t.magFilter = t.minFilter = NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = SRGBColorSpace;
    t.needsUpdate = true;
    frames.set(key, t);
  }
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
uniform vec2 uCard;       // card size, world
uniform float uTexel;     // world size of a frame texel
uniform float uShadow;    // drop-shadow offset, world
uniform vec3 uFill;
uniform vec3 uGlow;
uniform float uGlowK;
uniform vec3 uRing;
uniform float uRingK;
uniform vec3 uWash;
uniform float uWashK;
uniform float uDim;
uniform float uProgress;  // frame forge 0..1
uniform float uBody;      // fill + shadow opacity (stepped by the caller)
uniform float uFade;
uniform vec2 uPlate;      // level plate, texels (0 = none)
uniform vec3 uPlateEdge;
uniform vec3 uHot;
varying vec2 vUv;

int sliceAxis(float p, float size) {
  float t = p / uTexel;
  float n = size / uTexel;
  if (t < 4.0) return int(floor(t));
  if (t > n - 4.0) return 11 - int(floor(n - t));
  return 4 + int(mod(floor(t - 4.0), 4.0));
}

void main() {
  vec2 quad = uCard + vec2(uShadow);
  vec2 q = vUv * quad;
  // Card space: the card is [0,W]x[0,H]; the shadow hangs off its lower right.
  vec2 p = q - vec2(0.0, uShadow);
  vec4 col = vec4(0.0);
  if (p.x >= 0.0 && p.y >= 0.0 && p.x <= uCard.x && p.y <= uCard.y) {
    vec2 n = floor(uCard / uTexel);
    vec2 t = min(floor(p / uTexel), n - 1.0);
    float border = 4.0 * uTexel;
    bool band = p.x < border || p.y < border || p.x > uCard.x - border || p.y > uCard.y - border;
    // Interior: three hard bands of top light, the grade pooled in rings.
    float v = (t.y + 0.5) / n.y;
    vec3 rgb = uFill * (v > 0.72 ? 1.45 : v > 0.3 ? 1.0 : 0.7);
    vec2 c = ((t + 0.5) / n - vec2(0.5, 0.47)) * 2.0;
    float r = length(c);
    rgb += uGlow * uGlowK * (r < 0.46 ? 0.11 : r < 0.7 ? 0.055 : r < 0.9 ? 0.02 : 0.0);
    rgb = mix(rgb, uWash, uWashK);
    float ring = (t.x == 4.0 || t.y == 4.0 || t.x == n.x - 5.0 || t.y == n.y - 5.0) ? 1.0 : 0.0;
    rgb = mix(rgb, uRing, ring * uRingK);
    col = vec4(rgb, uBody);
    if (band) {
      vec2 fromTop = vec2(p.x, uCard.y - p.y);
      vec4 f = texelFetch(uFrame, ivec2(sliceAxis(fromTop.x, uCard.x), sliceAxis(fromTop.y, uCard.y)), 0);
      // Forge: the trim runs from the bottom centre up both sides, in whole
      // texels, a white-hot texel at each leading end.
      vec2 g = (t + 0.5) * uTexel;
      float dx = abs(g.x - uCard.x * 0.5);
      float dB = g.y;
      float dT = uCard.y - g.y;
      float dS = uCard.x * 0.5 - dx;
      float s;
      if (dB <= min(dT, dS)) s = dx;
      else if (dS <= dT) s = uCard.x * 0.5 + g.y;
      else s = uCard.x * 0.5 + uCard.y + (uCard.x * 0.5 - dx);
      s /= (uCard.x + uCard.y);
      float front = uProgress * 1.02;
      if (s > front) f.a = 0.0;
      float hot = step(front - 0.03, s) * step(uProgress, 0.999);
      f.rgb = mix(f.rgb, uHot, hot);
      // Notched corners and unforged trim are holes; the frame's soft inner
      // texel (alpha < 1) shades the fill under it.
      col = f.a <= 0.0 ? vec4(0.0) : vec4(mix(rgb * 0.8, f.rgb, f.a), f.a > 0.99 ? 1.0 : max(f.a, uBody));
    }
    if (uPlate.x > 0.0 && uProgress >= 1.0) {
      vec2 k = vec2(n.x - 1.0 - t.x, t.y);
      if (k.x < uPlate.x && k.y < uPlate.y) {
        bool edge = k.x >= uPlate.x - 1.0 || k.y >= uPlate.y - 1.0;
        col = vec4(edge ? uPlateEdge : vec3(0.0024, 0.002, 0.003), 1.0);
      }
    }
  }
  if (col.a < 0.01) {
    // Hard offset shadow (the card shifted right and down).
    vec2 sp = q - vec2(uShadow, 0.0);
    if (sp.x >= 0.0 && sp.y >= 0.0 && sp.x <= uCard.x && sp.y <= uCard.y) col = vec4(0.0, 0.0, 0.0, 0.55 * uBody);
  }
  if (col.a < 0.01) discard;
  col.rgb *= 1.0 - uDim * 0.65;
  gl_FragColor = vec4(col.rgb * col.a, col.a) * uFade;
  #include <colorspace_fragment>
}
`;

export interface CardUniforms {
  uFrame: { value: DataTexture };
  uCard: { value: [number, number] };
  uTexel: { value: number };
  uShadow: { value: number };
  uFill: { value: Color };
  uGlow: { value: Color };
  uGlowK: { value: number };
  uRing: { value: Color };
  uRingK: { value: number };
  uWash: { value: Color };
  uWashK: { value: number };
  uDim: { value: number };
  uProgress: { value: number };
  uBody: { value: number };
  uFade: { value: number };
  uPlate: { value: [number, number] };
  uPlateEdge: { value: Color };
  uHot: { value: Color };
}

export type CardMaterial = ShaderMaterial & { uniforms: CardUniforms };

/** A card material for a `w`×`h` card (world units) with `texel`-sized
 * frame texels. Per socket: each lights up on its own. */
export function cardMaterial(w: number, h: number, texel: number, frame: FrameColors, fill = "#120e17"): CardMaterial {
  const uniforms: CardUniforms = {
    uFrame: { value: cardFrame(frame) },
    uCard: { value: [w, h] },
    uTexel: { value: texel },
    uShadow: { value: texel * 2 },
    uFill: { value: new Color(fill) },
    uGlow: { value: new Color("#000000") },
    uGlowK: { value: 0 },
    uRing: { value: new Color("#ffffff") },
    uRingK: { value: 0 },
    uWash: { value: new Color("#000000") },
    uWashK: { value: 0 },
    uDim: { value: 0 },
    uProgress: { value: 0 },
    uBody: { value: 0 },
    uFade: { value: 1 },
    uPlate: { value: [0, 0] },
    uPlateEdge: { value: new Color("#ffffff") },
    uHot: { value: new Color("#fff6d8") },
  };
  return new ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, { value: unknown }>,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
  }) as CardMaterial;
}

/** The quad's scale and offset for a card of `w`×`h` with a `shadow`
 * offset: the quad also covers the shadow hanging off the lower right. */
export function cardQuad(w: number, h: number, shadow: number): { scale: [number, number, number]; offset: [number, number] } {
  return { scale: [w + shadow, h + shadow, 1], offset: [shadow / 2, -shadow / 2] };
}
