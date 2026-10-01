import { Color, DataTexture, NearestFilter, RGBAFormat, ShaderMaterial, SRGBColorSpace, UnsignedByteType } from "three";
import { frameTexture } from "../../PixelFrame";
import type { FrameColors } from "../../theme";

/** The item slot a socket is drawn as — a little well cast into the pane,
 * in one quad:
 *
 *   - a dark haze that thins out toward its rim (no hard edge), the item's
 *     grade pooled behind the item in stepped rings of light;
 *   - a thread of the grade's light round it (its frame bitmap's lit tone),
 *     drawing itself round from the bottom when the socket rises, with a
 *     bright rune-dot at each corner;
 *   - an inner ring of light and a wash for hover and drag feedback;
 *   - the level plate in the bottom-right corner (a dark tile with a
 *     grade-coloured edge — the number itself is RuneText).
 *
 * One draw call per socket, and every look change is a uniform write (the
 * frame swaps textures from a cache), so sockets never re-render to light
 * up. */

const frames = new Map<string, DataTexture>();

/** PixelFrame's bitmap with the corner rivets in the frame's own light tone
 * instead of white-hot: a page of thirty cards shouldn't sparkle at every
 * corner. */
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

float bayer4(vec2 c) {
  vec2 m = mod(c, 4.0);
  int i = int(m.x) + int(m.y) * 4;
  float b[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (b[i] + 0.5) / 16.0;
}
vec3 disp(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }

// Output is premultiplied: the haze darkens what's behind it, the light is
// added on top (colour without alpha), all in display values.
void main() {
  vec2 p = vUv * uCard;
  vec2 n = floor(uCard / uTexel);
  vec2 t = min(floor(p / uTexel), n - 1.0);
  float d = min(min(t.x, t.y), min(n.x - 1.0 - t.x, n.y - 1.0 - t.y));
  vec3 edge = disp(texelFetch(uFrame, ivec2(6, 1), 0).rgb);

  // The well: haze thinning to nothing at the rim.
  float feather = clamp(d / 4.0, 0.0, 1.0);
  float haze = uBody * 0.62 * step(bayer4(t), feather * 1.2);
  vec3 light = vec3(0.0);

  // Its grade pooled behind the item, in stepped rings.
  vec2 c = ((t + 0.5) / n - vec2(0.5, 0.47)) * 2.0;
  float r = length(c);
  light += disp(uGlow) * uGlowK * (r < 0.46 ? 0.16 : r < 0.7 ? 0.08 : r < 0.9 ? 0.03 : 0.0) * uBody;
  light += disp(uFill) * 0.6 * uBody;

  // The thread, forging round from the bottom centre.
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
  if (s <= front) {
    float hot = step(front - 0.03, s) * step(uProgress, 0.999);
    float th = abs(d - 1.0) < 0.5 ? 0.42 : d < 0.5 ? (mod(t.x + t.y, 2.0) < 1.0 ? 0.1 : 0.0) : 0.0;
    vec2 cd = min(t, n - 1.0 - t);
    if (cd.x < 2.5 && cd.y < 2.5 && abs(cd.x - cd.y) < 1.5) th = max(th, cd.x + cd.y < 3.5 ? 0.9 : 0.25);
    light += mix(edge * th, disp(uHot), hot);
  }

  // Feedback: an inner ring and a wash.
  float ring = abs(d - 3.0) < 0.5 ? 1.0 : 0.0;
  light += disp(uRing) * ring * uRingK * 0.8;
  light += disp(uWash) * uWashK * 0.3 * step(2.5, d);

  light *= 1.0 - uDim * 0.7;
  haze = min(1.0, haze + uDim * 0.25 * step(0.5, d));
  vec4 col = vec4(vec3(0.004, 0.003, 0.008) * haze + light, haze);

  if (uPlate.x > 0.0 && uProgress >= 1.0) {
    vec2 k = vec2(n.x - 1.0 - t.x, t.y);
    if (k.x < uPlate.x && k.y < uPlate.y) {
      bool pe = k.x >= uPlate.x - 1.0 || k.y >= uPlate.y - 1.0;
      col = pe ? vec4(disp(uPlateEdge) * 0.8, 0.85) : vec4(0.01, 0.008, 0.015, 0.85);
    }
  }
  if (col.a < 0.002 && dot(col.rgb, col.rgb) < 0.000001) discard;
  gl_FragColor = col * uFade;
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
    // No drop shadow any more (kept as a uniform: callers lay the quad out
    // with it).
    uShadow: { value: 0 },
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
