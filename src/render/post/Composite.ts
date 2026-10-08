import { ShaderPass } from "postprocessing";
import { Color, ShaderMaterial, type Texture, Uniform, Vector2, type WebGLRenderer, type WebGLRenderTarget } from "three";
import type { Grade } from "../../world/biomes";
import { POST_GLSL } from "./glsl";

/** The final picture, drawn at the screen's full resolution: crisp pixel
 * art seen through a camera.
 *
 *  - **The world's pixels**, fetched exactly — each world pixel is a block
 *    of exactly `scale` screen pixels (render/pixelGrid), never filtered —
 *    darkened by their ambient occlusion (post/Occlusion) where surfaces
 *    crowd each other.
 *    In the Ember Forge the air over the magma shimmers: the lookup wavers,
 *    more the further you look through it, so the pixels themselves swim.
 *  - **Everything that is light or blur is smooth.** The out-of-focus layer
 *    (post/LensEffect), the light hanging in the air (post/Air), the god
 *    rays and the lens's glare are all computed at the world's low
 *    resolution — cheap — and upsampled here bicubically, so they lie over
 *    the pixels as soft, continuous light.
 *  - **The lens's glare**: a thresholdless, energy-conserving bloom, as a
 *    real lens has it — every light spreads a little of itself, so only
 *    what is truly bright visibly glows — and faint dirt on the glass that
 *    catches it.
 *  - **The eye and the film**: exposure from the adapted eye (half-way
 *    toward each place's key, within ±½ EV), the place's split tone,
 *    saturation and log contrast, then ACES — film's S-curve, per channel,
 *    so lights roll off into a soft shoulder and fire burns from red
 *    through orange to white — over the painted darks, which are kept as
 *    they were. A blow drains the colour; near death the world greys.
 *  - **The print**: a smooth, heavy vignette tinted with the place's darks
 *    (it breathes in the Hollow and closes with the heartbeat near death), a
 *    fine grain at screen resolution, strongest in the mid-tones, and a
 *    sub-step of noise in the output so dark gradients never band. */

const fragment = /* glsl */ `
#include <packing>
${POST_GLSL}
uniform sampler2D inputBuffer;
uniform sampler2D uDepth;
uniform sampler2D uDof;
uniform sampler2D uBloom;
uniform sampler2D uRays;
uniform sampler2D uAir;
uniform sampler2D uAo;
uniform float uAoStrength;
uniform sampler2D uDirt;
uniform sampler2D uEye;
uniform vec2 uLow;
uniform vec2 uBloomSize;
uniform float uScale;
uniform float uDofOn;
uniform float uRaysOn;
uniform float uBloomMix;
uniform float uFilmExposure;
uniform float uDirtStrength;
uniform float uHaze;
uniform float uTime;
uniform float uNear;
uniform float uFar;
uniform float uKey;
uniform float uAdapt;
uniform vec2 uEvRange;
uniform float uExposure;
uniform vec3 uShadows;
uniform vec3 uHighlights;
uniform float uSaturation;
uniform float uContrast;
uniform float uDrain;
uniform float uVignette;
uniform vec3 uVignetteTint;
uniform float uClose;
uniform float uGrain;
uniform float uFrame;
uniform float uAspect;

#define COC_RANGE 16.0

// ACES (Narkowicz's fit of the Academy's filmic reference): the S-curve
// film and most cinema-grade engines grade through — rich contrast, and
// per channel, so a hot red runs to orange and then to yellow-white as fire
// does, and every light rolls off into a soft shoulder instead of a clip.
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

float hazeNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = postHash(vec3(i, 7.0));
  float b = postHash(vec3(i + vec2(1.0, 0.0), 7.0));
  float c = postHash(vec3(i + vec2(0.0, 1.0), 7.0));
  float d = postHash(vec3(i + vec2(1.0, 1.0), 7.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / (uLow * uScale);
  vec2 low = frag / uScale;

  // Heat shimmer: the lookup wavers through the hot air, more the further
  // you look (the staff in your hand is left alone).
  if (uHaze > 0.0) {
    ivec2 dp = clamp(ivec2(low), ivec2(0), ivec2(uLow) - 1);
    float d = -perspectiveDepthToViewZ(texelFetch(uDepth, dp, 0).r, uNear, uFar);
    float through = d < 0.75 ? 0.0 : smoothstep(1.5, 14.0, min(d, 30.0));
    vec2 q = uv * vec2(uAspect, 1.0) * vec2(9.0, 5.0) + vec2(0.0, -uTime * 1.3);
    vec2 w = vec2(hazeNoise(q), hazeNoise(q + 17.3)) - 0.5;
    low += w * vec2(0.6, 1.0) * uHaze * 1.5 * through;
  }

  // The world's pixel, exactly.
  ivec2 px = clamp(ivec2(floor(low)), ivec2(0), ivec2(uLow) - 1);
  vec3 c = texelFetch(inputBuffer, px, 0).rgb;
  // Ambient occlusion, per world pixel: creases and contact darken.
  c *= mix(1.0, texelFetch(uAo, px, 0).r, uAoStrength);

  // Out of focus: the smooth layer, where the blur is real.
  if (uDofOn > 0.5) {
    vec4 dof = postBicubic(uDof, uv, uLow);
    float coc = dof.a * COC_RANGE;
    c = mix(c, max(dof.rgb, 0.0), smoothstep(0.45, 1.6, coc));
  }

  // Light in the air, and the moon's shafts: smooth over the pixels.
  c += max(postBicubic(uAir, uv, uLow).rgb, 0.0);
  if (uRaysOn > 0.5) c += max(postBicubic(uRays, uv, uLow).rgb, 0.0);
  // The lens's own glare, as a camera has it: every light spreads a little
  // of itself — no threshold, energy kept (a blend, not an add) — so only
  // what is truly bright blooms visibly, wrapping round edges and over what
  // stands in front of it; the glass's dirt catches the same glare.
  vec3 glare = max(postBicubic(uBloom, uv, uBloomSize).rgb, 0.0);
  c = mix(c, glare, uBloomMix);
  c += glare * texture2D(uDirt, uv).rgb * uDirtStrength;

  // The eye: half-way toward the key, within a narrow range.
  float avg = texture2D(uEye, vec2(0.5)).r;
  float ev = clamp((uKey - avg) * uAdapt, uEvRange.x, uEvRange.y);
  c *= exp2(ev) * uExposure;

  // The grade: saturation, split tone (hue-only tints weighted by the
  // pixel's brightness, a faint coloured lift in the blacks), log contrast.
  float l = postLuma(c);
  c = mix(vec3(l), c, uSaturation);
  float w = smoothstep(0.0, 0.35, l);
  vec3 sh = uShadows / max(postLuma(uShadows), 1e-3);
  vec3 hi = uHighlights / max(postLuma(uHighlights), 1e-3);
  c *= mix(mix(vec3(1.0), sh, 0.45), mix(vec3(1.0), hi, 0.3), w);
  c += uShadows * 0.35;
  c = 0.18 * pow(max(c, 0.0) / 0.18, vec3(uContrast));
  // The film: ACES from the mid-tones up (where light rolls off and burns
  // to white), the painted darks kept exactly as they were — the curve's
  // own toe would crush a torch-lit dungeon's shadows to black.
  c = mix(min(c, 1.0), aces(c * uFilmExposure), smoothstep(0.03, 0.2, postLuma(c)));
  c = mix(vec3(postLuma(c)), c, 1.0 - uDrain);

  // Vignette: an oval following the screen, its inner edge drawn in as the
  // rim of sight closes; the rim cools (or warms) toward the place's darks.
  vec2 p = (uv - 0.5) * vec2(1.0 + (uAspect - 1.0) * 0.25, 1.0);
  float r = length(p) * 1.05 * (1.0 + uClose * 0.55);
  float dark = clamp(smoothstep(0.16, 0.8, r) * uVignette, 0.0, 0.97);
  c *= mix(vec3(1.0), uVignetteTint, dark * 0.25) * (1.0 - dark);

  // Fine grain at screen resolution, in the mid-tones (none in the black,
  // little in the light).
  vec3 g3 = vec3(frag, uFrame);
  float n = postHash(g3) + postHash(g3 + vec3(31.0, 17.0, 5.0)) - 1.0;
  float lg = postLuma(c);
  c *= 1.0 + n * uGrain * 0.07 * smoothstep(0.0, 0.05, lg) * (1.0 - smoothstep(0.35, 1.0, lg));

  gl_FragColor = vec4(max(c, 0.0), 1.0);
  #include <colorspace_fragment>
  // A sub-step of noise in the 8-bit output: no banding in the dark.
  gl_FragColor.rgb += (postHash(g3 + vec3(5.0, 11.0, 23.0)) - 0.5) / 255.0;
}
`;

const vertex = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 1.0, 1.0); }
`;

export interface CompositeInputs {
  scene: WebGLRenderTarget;
  depth: Texture;
  dof: Texture;
  bloom: Texture;
  rays: Texture | null;
  air: Texture;
  ao: Texture;
  eye: Texture;
  dirt: Texture;
}

export class Composite {
  private pass: ShaderPass;
  private scratch = new Color();
  private frame = 0;
  private time = 0;

  constructor(start: Grade) {
    this.pass = new ShaderPass(
      new ShaderMaterial({
        uniforms: {
          inputBuffer: new Uniform(null),
          uDepth: new Uniform(null),
          uDof: new Uniform(null),
          uBloom: new Uniform(null),
          uRays: new Uniform(null),
          uAir: new Uniform(null),
          uAo: new Uniform(null),
          uAoStrength: new Uniform(1),
          uDirt: new Uniform(null),
          uEye: new Uniform(null),
          uLow: new Uniform(new Vector2(1, 1)),
          uBloomSize: new Uniform(new Vector2(1, 1)),
          uScale: new Uniform(1),
          uDofOn: new Uniform(1),
          uRaysOn: new Uniform(0),
          uBloomMix: new Uniform(0.08),
          uFilmExposure: new Uniform(0.8),
          uDirtStrength: new Uniform(0.25),
          uHaze: new Uniform(0),
          uTime: new Uniform(0),
          uNear: new Uniform(0.1),
          uFar: new Uniform(100),
          uKey: new Uniform(-4.6),
          uAdapt: new Uniform(0.5),
          uEvRange: new Uniform(new Vector2(-0.45, 0.5)),
          uExposure: new Uniform(1),
          uShadows: new Uniform(new Color(start.shadows)),
          uHighlights: new Uniform(new Color(start.highlights)),
          uSaturation: new Uniform(start.saturation),
          uContrast: new Uniform(start.contrast),
          uDrain: new Uniform(0),
          uVignette: new Uniform(0.9),
          uVignetteTint: new Uniform(new Color(1, 1, 1)),
          uClose: new Uniform(0),
          uGrain: new Uniform(1),
          uFrame: new Uniform(0),
          uAspect: new Uniform(1),
        },
        vertexShader: vertex,
        fragmentShader: fragment,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.pass.renderToScreen = true;
  }

  get uniforms(): ShaderMaterial["uniforms"] {
    return (this.pass.fullscreenMaterial as ShaderMaterial).uniforms;
  }

  /** Ease the grade toward `g` by the fraction `k` (0…1). */
  approach(g: Grade, k: number): void {
    const u = this.uniforms;
    (u.uShadows.value as Color).lerp(this.scratch.set(g.shadows), k);
    (u.uHighlights.value as Color).lerp(this.scratch.set(g.highlights), k);
    u.uSaturation.value += (g.saturation - u.uSaturation.value) * k;
    u.uContrast.value += (g.contrast - u.uContrast.value) * k;
  }

  /** The grade's tint in the darks, as it stands (eased). */
  get shadows(): Color {
    return this.uniforms.uShadows.value as Color;
  }

  /** Draw the final picture to the screen. `scale` is screen pixels per
   * world pixel; `camera` gives the depth range for the shimmer. */
  render(renderer: WebGLRenderer, inputs: CompositeInputs, scale: number, near: number, far: number, dt: number): void {
    const u = this.uniforms;
    const img = inputs.scene.texture.image as { width: number; height: number };
    const bloomImg = inputs.bloom.image as { width: number; height: number } | undefined;
    this.frame = (this.frame + 1) % 4096;
    this.time = (this.time + dt) % 1000;
    u.uDepth.value = inputs.depth;
    u.uDof.value = inputs.dof;
    u.uBloom.value = inputs.bloom;
    u.uRays.value = inputs.rays;
    u.uRaysOn.value = inputs.rays ? 1 : 0;
    u.uAir.value = inputs.air;
    u.uAo.value = inputs.ao;
    u.uDirt.value = inputs.dirt;
    u.uEye.value = inputs.eye;
    (u.uLow.value as Vector2).set(img.width, img.height);
    (u.uBloomSize.value as Vector2).set(bloomImg?.width ?? img.width, bloomImg?.height ?? img.height);
    u.uScale.value = scale;
    u.uNear.value = near;
    u.uFar.value = far;
    u.uAspect.value = img.width / Math.max(1, img.height);
    u.uFrame.value = this.frame;
    u.uTime.value = this.time;
    this.pass.render(renderer, inputs.scene, null as unknown as WebGLRenderTarget);
  }

  dispose(): void {
    this.pass.dispose();
  }
}
