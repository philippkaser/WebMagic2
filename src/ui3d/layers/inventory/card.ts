import { Color, DataTexture, NearestFilter, RGBAFormat, ShaderMaterial, SRGBColorSpace, UnsignedByteType } from "three";
import { frameTexture } from "../../PixelFrame";
import type { FrameColors } from "../../theme";

/** The item slot a socket is drawn as — a soft, round-cornered well cut
 * into the stone of the page, in one quad:
 *
 *   - the well: dark at its floor, its upper-left walls in shadow and its
 *     lower-right walls catching the torch, its rim worn round — no border
 *     line, the edge is just where the stone turns down;
 *   - the item's grade glowing up from the floor of the well behind the
 *     item, in stepped rings;
 *   - a soft ring of light inside the rim and a wash for hover and drag
 *     feedback;
 *   - the level tab in the bottom-right corner (a small dark rounded tab —
 *     the number itself is RuneText).
 *
 * It opens from its centre when the socket rises (uProgress). One draw
 * call per socket, and every look change is a uniform write. */

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

float roundRect(vec2 p, vec2 hs, float r) {
  vec2 q = abs(p) - (hs - r);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// Premultiplied output: the well darkens the stone, light is added on top.
void main() {
  vec2 n = floor(uCard / uTexel);
  vec2 t = min(floor(vUv * uCard / uTexel), n - 1.0);
  vec2 c = t + 0.5 - n * 0.5;                // texels from the centre
  float r = min(n.x, n.y) * 0.32;            // a generous corner
  // Opens from its centre as the socket rises.
  float grow = mix(0.25, 1.0, uProgress);
  float sd = roundRect(c, n * 0.5 * grow, r * grow);
  if (sd > 0.0) discard;
  vec3 edge = disp(texelFetch(uFrame, ivec2(6, 1), 0).rgb);

  // The well's walls: the rim's two outer texels slope down into it.
  float wall = clamp(1.0 + sd / 3.0, 0.0, 1.0);          // 1 at the rim, 0 inside
  vec2 dir = normalize(c + 0.0001);
  float facing = dot(dir, normalize(vec2(1.0, -1.0)));   // lower-right walls face the torch
  // The floor of the well is near-black; its rim is where the stone turns
  // down: the lit lower-right lip is a thin bright crescent, the upper-left
  // wall falls into shadow.
  float a = uBody * 0.92;
  vec3 light = vec3(0.0);
  vec3 dark = vec3(0.004, 0.003, 0.007);
  if (wall > 0.0) {
    if (facing > 0.0) light += vec3(0.24, 0.22, 0.26) * wall * wall * facing * uBody;
    else a = min(1.0, a + 0.08 * wall * -facing);
  }

  // The grade glowing up from the floor of the well, in stepped rings.
  vec2 g = c / (n * 0.5);
  float rr = length(g - vec2(0.0, -0.06));
  light += disp(uGlow) * uGlowK * (rr < 0.46 ? 0.16 : rr < 0.7 ? 0.075 : rr < 0.9 ? 0.03 : 0.0) * uBody;
  light += disp(uFill) * 0.4 * uBody;
  // A hint of the grade on the lit lip.
  if (wall > 0.5 && facing > 0.3) light += edge * 0.08 * uBody;

  // Feedback: a soft ring inside the rim, and a wash.
  float ring = abs(sd + 3.0) < 0.75 ? 1.0 : abs(sd + 3.0) < 1.75 ? 0.35 : 0.0;
  light += disp(uRing) * ring * uRingK * 0.8;
  light += disp(uWash) * uWashK * 0.3 * step(2.5, -sd);
  light += disp(uHot) * (1.0 - uProgress) * 0.25 * step(-1.5, sd) * step(uProgress, 0.999);

  light *= 1.0 - uDim * 0.7;
  a = min(1.0, a + uDim * 0.15);
  vec4 col = vec4(dark * a + light, a);

  if (uPlate.x > 0.0 && uProgress >= 1.0) {
    vec2 k = vec2(n.x - 1.0 - t.x, t.y);
    if (k.x < uPlate.x && k.y < uPlate.y && roundRect(k + 0.5 - uPlate * 0.5, uPlate * 0.5, 1.5) < 0.0) {
      col = vec4(0.01, 0.008, 0.015, 0.88);
    }
  }
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
