import { Effect } from "postprocessing";
import { Color, Uniform, type WebGLRenderer, type WebGLRenderTarget } from "three";
import { POST_GLSL } from "./glsl";

/** The last touch, on the image as it will be shown:
 *
 *  - **The vignette**: heavy, round (corrected for the screen's shape),
 *    falling off like light through a real lens, and tinted with the place's
 *    own darks rather than plain black. In the Hollow it breathes; near death
 *    it closes in with each beat of the heart.
 *  - **Film grain** on the pixel grid: a soft Gaussian grain, strongest in
 *    the mid-tones and gone in the black and the white — texture in the
 *    stone, never a snow of lit specks in the dark.
 *  - **Ordered dither**: the image is quantized in display space against
 *    the 4×4 Bayer matrix the rest of the world's pixels use, so the long
 *    dark gradients of fog and torchlight break into crisp pixel-art steps
 *    instead of banding. */

const fragment = /* glsl */ `
${POST_GLSL}
uniform float uVignette;
uniform vec3 uVignetteTint;
uniform float uClose;
uniform float uGrain;
uniform float uLevels;
uniform float uFrame;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;

  // Lens falloff: an oval following the screen's shape, a little rounder
  // than it, its inner edge drawn in as the rim of sight closes.
  vec2 p = (uv - 0.5) * vec2(1.0 + (aspect - 1.0) * 0.25, 1.0);
  float r = length(p) * 1.05 * (1.0 + uClose * 0.55);
  float v = smoothstep(0.16, 0.8, r);
  float dark = clamp(v * uVignette, 0.0, 0.97);
  // The rim cools (or warms) toward the place's darks as it falls away.
  c *= mix(vec3(1.0), uVignetteTint, dark * 0.25) * (1.0 - dark);

  // Into display space: grain and dither live where the eye judges steps.
  vec3 s = clamp(postToSRGB(c), 0.0, 1.0);
  vec2 px = floor(gl_FragCoord.xy);
  // Grain: a sum of three uniforms is near enough Gaussian; mostly in the
  // brightness, a touch in the colour.
  vec3 f = vec3(px, uFrame);
  float g = (postHash(f) + postHash(f + vec3(17.0, 59.0, 3.0)) + postHash(f + vec3(83.0, 11.0, 7.0))) / 1.5 - 1.0;
  float gc = postHash(f + vec3(31.0, 7.0, 13.0)) - 0.5;
  float l = postLuma(s);
  float body = smoothstep(0.015, 0.16, l) * (1.0 - smoothstep(0.55, 1.0, l));
  s += (g * vec3(1.0) + gc * vec3(0.4, -0.25, -0.15)) * uGrain * 0.075 * body;

  // Ordered dither onto the display grid.
  s = floor(s * uLevels + postBayer(px)) / uLevels;
  outputColor = vec4(postFromSRGB(clamp(s, 0.0, 1.0)), inputColor.a);
}
`;

export class FilmEffect extends Effect {
  private frame = 0;

  constructor() {
    super("FilmEffect", fragment, {
      uniforms: new Map<string, Uniform>([
        ["uVignette", new Uniform(0.9)],
        ["uVignetteTint", new Uniform(new Color(1, 1, 1))],
        ["uClose", new Uniform(0)],
        ["uGrain", new Uniform(1)],
        ["uLevels", new Uniform(64)],
        ["uFrame", new Uniform(0)],
      ]),
    });
  }

  set vignette(v: number) {
    this.uniforms.get("uVignette")!.value = v;
  }
  /** How far the rim of sight has closed in (0 = open). */
  set close(v: number) {
    this.uniforms.get("uClose")!.value = v;
  }
  set grain(v: number) {
    this.uniforms.get("uGrain")!.value = v;
  }
  /** The vignette's tint: the place's darks, scaled so the strongest
   * channel is 1 — it turns the hue of the rim, it doesn't brighten it. */
  get tint(): Color {
    return this.uniforms.get("uVignetteTint")!.value as Color;
  }

  override update(_renderer: WebGLRenderer, _input: WebGLRenderTarget, _dt?: number): void {
    // A fresh grain every frame, on a long cycle (float-exact).
    this.frame = (this.frame + 1) % 4096;
    this.uniforms.get("uFrame")!.value = this.frame;
  }
}
