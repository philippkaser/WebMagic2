import { Color, CustomBlending, NormalBlending, OneFactor, ShaderMaterial, Vector2, ZeroFactor } from "three";

/** The look of every cast pane: a plane of light the wizard projects into
 * the air — no frame, no hard border, nothing stiff.
 *
 * Two layers share one shader:
 *  - SMOKE (normal blending): a dark, feathered haze behind the light so
 *    words stay legible over a bright hall. It has no edge — it thins out.
 *  - LIGHT (additive): the projection itself. A faint fill in the pane's
 *    colour, scanlines drifting upward, an interference band rolling
 *    through, a slow rune lattice, shimmering noise, a soft inner border
 *    that breaks into drifting dashes, brighter corner brackets, and a
 *    glow along the edge the beam feeds it from.
 *
 * Everything is computed on a grid of square "holo pixels" (`uCell`, a few
 * screen pixels) and its softness is ordered-dithered rather than blended,
 * so the projection is made of the same chunky pixels as the world.
 *
 * Build and collapse are uniforms: `uLine` grows a bright scan line out
 * from the centre of the feed edge, `uReveal` sweeps it across the pane
 * (with glitching rows while it tunes in), `uAlpha` fades the whole. */

/** Blending for light on the UI's transparent canvas: add the colour, leave
 * the canvas's alpha alone. (Plain additive blending would also add alpha
 * and turn the light into an opaque sheet over the world; a premultiplied
 * pixel with colour and zero alpha is pure added light when the browser
 * composites the canvas.) Spread into a material's parameters. */
export const LIGHT_BLENDING = {
  blending: CustomBlending,
  blendSrc: OneFactor,
  blendDst: OneFactor,
  blendSrcAlpha: ZeroFactor,
  blendDstAlpha: OneFactor,
} as const;

export interface HoloUniforms {
  uSize: { value: Vector2 };
  uCell: { value: number };
  uColor: { value: Color };
  uReveal: { value: number };
  uLine: { value: number };
  uAlpha: { value: number };
  uTime: { value: number };
  uSeed: { value: number };
  uGlitch: { value: number };
  uHover: { value: number };
  /** Fill brightness multiplier (buttons and keys are brighter). */
  uFill: { value: number };
  /** Draw the corner brackets and border (0 for tiny plates). */
  uBorder: { value: number };
}

export type HoloMaterial = ShaderMaterial & { uniforms: HoloUniforms };

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec2 uSize;
uniform float uCell;
uniform vec3 uColor;
uniform float uReveal;
uniform float uLine;
uniform float uAlpha;
uniform float uTime;
uniform float uSeed;
uniform float uGlitch;
uniform float uHover;
uniform float uFill;
uniform float uBorder;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bayer4(vec2 c) {
  vec2 m = mod(c, 4.0);
  int i = int(m.x) + int(m.y) * 4;
  float b[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (b[i] + 0.5) / 16.0;
}
// A soft value made of pixels: dithered on/off at the cell's threshold.
float dither(float v, vec2 cell) { return step(bayer4(cell), clamp(v, 0.0, 1.0)); }

void main() {
  vec2 n = max(vec2(4.0), floor(uSize / uCell));
  vec2 c = floor(vUv * n);
  float row = c.y;
  // Tuning in: rows slip sideways for a beat.
  float slip = (hash(vec2(row, floor(uTime * 24.0) + uSeed)) - 0.5) * 2.0;
  c.x = floor(c.x + slip * uGlitch * step(0.7, hash(vec2(row * 0.37, floor(uTime * 9.0)))) * n.x * 0.06);
  vec2 f = (c + 0.5) / n;

  // The reveal: everything above the sweep is not there yet.
  float sweep = uReveal * (n.y + 2.0);
  if (row > sweep + 0.5) discard;
  float lead = 1.0 - smoothstep(0.0, 2.5, sweep - row);

  // Distance to the nearest edge, in cells; the feather that replaces a border.
  float d = min(min(c.x, c.y), min(n.x - 1.0 - c.x, n.y - 1.0 - c.y));
  // (Small panes feather less, or a key cap would be all feather.)
  float m = min(n.x, n.y);
  float feather = clamp(d / min(6.0, m * 0.18), 0.0, 1.0);

#ifdef SMOKE
  float soft = clamp(d / min(14.0, m * 0.3), 0.0, 1.0);
  float s = 0.6 * dither(soft * soft * 1.1, c) * (1.0 - lead);
  if (s <= 0.0) discard;
  gl_FragColor = vec4(uColor * 0.06, s * uAlpha);
  #include <colorspace_fragment>
#else
  float t = uTime;
  // The light is added onto the composited picture, so it is computed in
  // display values (no colour-space step below): 0.05 is a faint glow.
  // Fill: faint, with scanlines every third row and a shimmer.
  float b = 0.045 * uFill;
  b += mod(row, 3.0) < 1.0 ? 0.03 * uFill : 0.0;
  b += (hash(c + floor(t * 12.0) + uSeed) - 0.5) * 0.03;
  // An interference band rolling up through the pane.
  float band = abs(fract(f.y * 1.3 - t * 0.12 + uSeed * 0.1) - 0.5);
  b += band < 0.035 ? 0.05 : 0.0;
  // A slow lattice of diagonal rune-lines.
  float lat = mod(c.x + c.y + floor(t * 2.0), 18.0) < 1.0 || mod(c.x - c.y + 400.0, 18.0) < 1.0 ? 0.02 : 0.0;
  b += lat;
  b *= dither(feather * 1.4, c);

  // The edge: a thread of light two cells in, with power flowing along it
  // (bright pulses running round the pane, motes riding them).
  float edge = abs(d - 2.0);
  vec2 cd = min(c, n - 1.0 - c);
  // Position round the perimeter, in cells.
  float per = c.y < 2.5 ? c.x : c.x > n.x - 3.5 ? n.x + c.y : c.y > n.y - 3.5 ? n.x + n.y + (n.x - c.x) : 2.0 * n.x + n.y + (n.y - c.y);
  float flow = 0.5 + 0.5 * sin(per * 0.18 - t * 3.0 + uSeed);
  float mote = step(0.93, hash(vec2(floor(per - t * 14.0), uSeed)));
  b += uBorder * (edge < 0.5 ? 0.1 + 0.22 * flow + 0.6 * mote : edge < 1.5 ? 0.04 * flow : 0.0);
  // Corners: a small rune-diamond each.
  vec2 dc = abs(cd - vec2(2.0));
  float diamond = dc.x + dc.y;
  b += uBorder * (diamond < 1.5 ? 0.85 : diamond < 2.5 ? 0.18 : 0.0);
  // The feed edge (the bottom: where the beam meets it) glows.
  b += 0.2 * pow(1.0 - f.y, 6.0) * dither(feather * 1.6, c);

  b *= 1.0 + uHover * 1.2;
  // A rare flicker, as if the spell wavered.
  b *= 1.0 - 0.3 * step(0.985, hash(vec2(floor(t * 10.0), uSeed)));

  // The scan line and the line it starts as.
  float lineW = abs(f.x - 0.5) * 2.0;
  float onLine = step(lineW, uLine);
  b += lead * 1.1 * onLine;
  if (uReveal <= 0.001) {
    b = (row < 1.0 && lineW <= uLine) ? 1.2 : 0.0;
  }
  if (b <= 0.002) discard;
  gl_FragColor = vec4(pow(uColor, vec3(1.0 / 2.2)) * b * uAlpha, 0.0);
#endif
}
`;

export function makeHoloMaterial(color: string, layer: "light" | "smoke"): HoloMaterial {
  return new ShaderMaterial({
    uniforms: {
      uSize: { value: new Vector2(1, 1) },
      uCell: { value: 0.004 },
      uColor: { value: new Color(color) },
      uReveal: { value: 0 },
      uLine: { value: 0 },
      uAlpha: { value: 1 },
      uTime: { value: 0 },
      uSeed: { value: Math.random() * 100 },
      uGlitch: { value: 0 },
      uHover: { value: 0 },
      uFill: { value: 1 },
      uBorder: { value: 1 },
    },
    defines: layer === "smoke" ? { SMOKE: "" } : {},
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    ...(layer === "smoke" ? { blending: NormalBlending } : LIGHT_BLENDING),
    toneMapped: false,
  }) as HoloMaterial;
}
