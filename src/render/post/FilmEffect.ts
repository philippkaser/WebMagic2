import { Effect } from "postprocessing";
import { Color, Uniform } from "three";
import { POST_GLSL } from "./glsl";

/** The last touch, on the image as it will be shown:
 *
 *  - **The vignette**: heavy, an oval following the screen, tinted with the
 *    place's own darks rather than plain black. In the Hollow it breathes;
 *    near death it closes in with each beat of the heart.
 *  - **The old console's colour**: the image is brought down to 15-bit
 *    colour (32 levels a channel) through the 4×4 ordered dither the
 *    first 3D dungeon crawlers were drawn with — the same Bayer matrix the
 *    god rays, the glow and the dithered particles use. Every gradient (the
 *    fog swallowing a hall, torchlight falling off a wall, the vignette)
 *    breaks into crisp pixel-art steps with a dither between them, on the
 *    world's pixel grid. */

const fragment = /* glsl */ `
${POST_GLSL}
uniform float uVignette;
uniform vec3 uVignetteTint;
uniform float uClose;
uniform float uLevels;

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

  // 15-bit colour through the ordered dither, in display space (where the
  // eye judges steps; the output encode is exact, so it round-trips).
  // Right at black the dither gives way to rounding, so the deep dark
  // stays ink instead of a sparse dot screen (as the god rays leave the
  // faintest air empty).
  vec3 s = clamp(postToSRGB(c), 0.0, 1.0);
  vec3 dither = mix(vec3(0.5), vec3(postBayer(gl_FragCoord.xy)), smoothstep(0.0, 2.0 / uLevels, s));
  s = floor(s * uLevels + dither) / uLevels;
  outputColor = vec4(postFromSRGB(clamp(s, 0.0, 1.0)), inputColor.a);
}
`;

export class FilmEffect extends Effect {
  constructor() {
    super("FilmEffect", fragment, {
      uniforms: new Map<string, Uniform>([
        ["uVignette", new Uniform(0.9)],
        ["uVignetteTint", new Uniform(new Color(1, 1, 1))],
        ["uClose", new Uniform(0)],
        ["uLevels", new Uniform(31)],
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
  /** Colour levels per channel, less one (31 = 15-bit colour). */
  set levels(v: number) {
    this.uniforms.get("uLevels")!.value = v;
  }
  /** The vignette's tint: the place's darks, scaled so the strongest
   * channel is 1 — it turns the hue of the rim, it doesn't brighten it. */
  get tint(): Color {
    return this.uniforms.get("uVignetteTint")!.value as Color;
  }
}
