import { Effect, EffectAttribute, ShaderPass } from "postprocessing";
import {
  BasicDepthPacking,
  type Camera,
  HalfFloatType,
  NearestFilter,
  type PerspectiveCamera,
  ShaderMaterial,
  type Texture,
  Uniform,
  WebGLRenderTarget,
  type DepthPackingStrategies,
  type WebGLRenderer,
} from "three";
import { POST_GLSL } from "./glsl";

/** The lens, in one pass over the world's low-resolution image (it reads
 * the depth, so it needs its own pass; everything else in the chain merges
 * into the final one):
 *
 *  - **Depth of field with bokeh.** The eye focuses on what you look at —
 *    the middle of the view, metered every frame on the GPU and racked over
 *    a few tenths of a second — and the world nearer and further goes soft
 *    in proportion to how far out of focus it is (circle of confusion ∝
 *    |1/focus − 1/distance|, like a real lens). Bright things out of focus
 *    open into round discs: a torch down the hall becomes a disc of light,
 *    drawn on the pixel grid. Behind a tablet (the title, the Weighing, the
 *    inventory and its kin, the codex, death) the whole world drops out of
 *    focus. The staff in your hand stays sharp — it's yours, not the
 *    world's.
 *    Gathered in one pass (Dennis Gustafsson's single-pass bokeh: a golden-
 *    angle spiral whose samples count only if their own blur reaches this
 *    pixel, so sharp things in front never smear and blurred things
 *    behind never bleed over them). The spiral only runs as far as the
 *    largest blur on screen, so an ordinary view costs a handful of taps.
 *  - **Heat shimmer**: the air over the Ember Forge's magma wavers, more
 *    the further you look through it. */

const fragment = /* glsl */ `
${POST_GLSL}
uniform sampler2D uFocus;
uniform float uAperture;
uniform float uMaxCoc;
uniform float uSoft;
uniform float uHaze;
uniform float uTime;

// Nearer than this is the staff in your hand (it rides with the camera).
#define HELD 0.75
// A tablet in front: how far out of focus the whole world goes (render px).
#define SOFT_COC 5.0
#define GOLDEN 2.39996
// Spiral step: the radius grows so taps stay ~evenly spread over the disc.
#define RAD_SCALE 0.55

float viewDist(float depth) { return -getViewZ(depth); }

float focusDiopters;

// Circle of confusion (radius, render px) of a point at distance d.
float cocOf(float d) {
  float c = d < HELD ? 0.0 : min(abs(1.0 / d - focusDiopters) * uAperture, uMaxCoc);
  return c + uSoft * SOFT_COC;
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

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float dist = viewDist(readDepth(uv));
  bool held = dist < HELD;
  vec2 at = uv;

  // Heat shimmer: the air between you and what you see wavers, more the
  // further you look through it (the staff is left alone).
  if (uHaze > 0.0 && !held) {
    float through = smoothstep(1.5, 14.0, min(dist, 30.0));
    vec2 q = uv * vec2(aspect, 1.0) * vec2(9.0, 5.0) + vec2(0.0, -uTime * 1.3);
    vec2 w = vec2(hazeNoise(q), hazeNoise(q + 17.3)) - 0.5;
    at += w * vec2(0.6, 1.0) * uHaze * 0.0045 * through;
  }

  vec3 color = texture2D(inputBuffer, at).rgb;
  float reach = uMaxCoc + uSoft * SOFT_COC;
  if (reach >= 0.5) {
    focusDiopters = texture2D(uFocus, vec2(0.5)).r;
    float size = cocOf(dist);
    float total = 1.0;
    float radius = RAD_SCALE;
    float angle = postBayer(gl_FragCoord.xy) * 6.2832;
    for (int i = 0; i < 96; i++) {
      if (radius >= reach) break;
      vec2 p = at + vec2(cos(angle), sin(angle)) * texelSize * radius;
      vec3 c = texture2D(inputBuffer, p).rgb;
      float d = viewDist(readDepth(p));
      float s = cocOf(d);
      // Something behind can't spread over this pixel further than this
      // pixel's own blur allows (no halo of background over a sharp edge).
      if (d > dist) s = clamp(s, 0.0, size * 2.0);
      float m = smoothstep(radius - 0.5, radius + 0.5, s);
      color += mix(color / total, c, m);
      total += 1.0;
      radius += RAD_SCALE / radius;
      angle += GOLDEN;
    }
    color /= total;
  }
  outputColor = vec4(color, inputColor.a);
}
`;

/** Where the eye focuses: the middle of the view (a small cross of depth
 * taps, the staff and sky ignored), in diopters (1 / metres), racked toward
 * over time. One pixel, ping-ponged. */
const focusMaterial = () =>
  new ShaderMaterial({
    uniforms: {
      inputBuffer: new Uniform(null),
      uDepth: new Uniform(null),
      uNear: new Uniform(0.1),
      uFar: new Uniform(100),
      uDt: new Uniform(0),
      uReset: new Uniform(1),
    },
    vertexShader: /* glsl */ `void main() { gl_Position = vec4(position.xy, 1.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      #include <packing>
      uniform sampler2D inputBuffer;
      uniform sampler2D uDepth;
      uniform float uNear;
      uniform float uFar;
      uniform float uDt;
      uniform float uReset;
      float diopters(vec2 p) {
        float d = -perspectiveDepthToViewZ(texture2D(uDepth, p).r, uNear, uFar);
        // The staff isn't what you're looking at; nor is the sky (infinity).
        if (d < 0.75) return -1.0;
        return 1.0 / max(d, 0.5);
      }
      void main() {
        float sum = 0.0;
        float n = 0.0;
        vec2 o[5] = vec2[5](vec2(0.0), vec2(0.03, 0.0), vec2(-0.03, 0.0), vec2(0.0, 0.04), vec2(0.0, -0.04));
        for (int i = 0; i < 5; i++) {
          float w = i == 0 ? 2.0 : 1.0;
          float v = diopters(vec2(0.5) + o[i]);
          if (v >= 0.0) { sum += v * w; n += w; }
        }
        float was = texture2D(inputBuffer, vec2(0.5)).r;
        float now = n > 0.0 ? sum / n : was;
        float k = uReset > 0.5 ? 1.0 : 1.0 - exp(-uDt * 5.0);
        gl_FragColor = vec4(mix(was, now, k), 0.0, 0.0, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });

export class LensEffect extends Effect {
  private focus: [WebGLRenderTarget, WebGLRenderTarget];
  private focusPass: ShaderPass;
  private depth: Texture | null = null;
  private reset = true;

  constructor(private readonly camera: Camera) {
    super("LensEffect", fragment, {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ["uFocus", new Uniform(null)],
        ["uAperture", new Uniform(2.6)],
        ["uMaxCoc", new Uniform(0)],
        ["uSoft", new Uniform(0)],
        ["uHaze", new Uniform(0)],
        ["uTime", new Uniform(0)],
      ]),
    });
    const one = () =>
      new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false });
    this.focus = [one(), one()];
    this.focusPass = new ShaderPass(focusMaterial());
    this.uniforms.get("uFocus")!.value = this.focus[0].texture;
  }

  /** How strong the world's depth of field is (0 = everything sharp). */
  set depthOfField(v: number) {
    this.uniforms.get("uMaxCoc")!.value = v * MAX_COC;
  }
  /** The focus pulled off the world (0 = sharp, 1 = soft behind a menu). */
  get soft(): number {
    return this.uniforms.get("uSoft")!.value;
  }
  set soft(v: number) {
    this.uniforms.get("uSoft")!.value = v;
  }
  set haze(v: number) {
    this.uniforms.get("uHaze")!.value = v;
  }

  override setDepthTexture(depthTexture: Texture, depthPacking: DepthPackingStrategies = BasicDepthPacking): void {
    super.setDepthTexture(depthTexture, depthPacking);
    this.depth = depthTexture;
  }

  override update(renderer: WebGLRenderer, _input: WebGLRenderTarget, dt = 1 / 60): void {
    const u = this.uniforms;
    u.get("uTime")!.value = (u.get("uTime")!.value + dt) % 1000;
    if (!this.depth) return;
    const cam = this.camera as PerspectiveCamera;
    const m = this.focusPass.fullscreenMaterial as ShaderMaterial;
    m.uniforms.uDepth.value = this.depth;
    m.uniforms.uNear.value = cam.near;
    m.uniforms.uFar.value = cam.far;
    m.uniforms.uDt.value = Math.min(dt, 0.1);
    m.uniforms.uReset.value = this.reset ? 1 : 0;
    const [from, to] = this.focus;
    this.focusPass.render(renderer, from, to);
    this.focus = [to, from];
    u.get("uFocus")!.value = to.texture;
    this.reset = false;
  }

  override dispose(): void {
    super.dispose();
    for (const t of this.focus) t.dispose();
    this.focusPass.dispose();
  }
}

/** The world's largest blur at full depth of field (render px radius). */
const MAX_COC = 4;
