import { Effect, ShaderPass } from "postprocessing";
import {
  Color,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  ShaderMaterial,
  Uniform,
  WebGLRenderTarget,
  type WebGLRenderer,
} from "three";
import type { Grade } from "../../world/biomes";
import { POST_GLSL } from "./glsl";

/** The colour of a place, and the eye that looks at it.
 *
 *  - **Eye adaptation.** The view is metered every frame (a log average,
 *    weighted to the middle — what you look at counts most) and the eye
 *    follows it slowly: step out of a black corridor and the hall opens up
 *    over a second or two; stare into a blast or the forge's fire and the
 *    room around it sinks. Fast toward the light, slow back into the dark,
 *    like an eye — and only half-way and within a narrow range, so the
 *    dungeon stays the near-black it was painted as.
 *  - **The grade**: each place's split tone (its tint in the darks and the
 *    lights), its saturation and a log contrast around middle grey.
 *  - **A filmic shoulder** instead of a hard clip: below the knee nothing
 *    changes (the game was tuned there); above it the light rolls off
 *    smoothly, so a flame, a blast or the moon keeps its shape and
 *    gradient instead of a flat clipped blot.
 *  - **The body**: a blow drains the colour for a moment, nearing death greys
 *    the world, a near blast flashes the exposure. */

/** Meter size (a power of two: its mip chain ends in the 1×1 average). */
const METER = 32;
const METER_LOD = Math.log2(METER);

const meterMaterial = () =>
  new ShaderMaterial({
    uniforms: { inputBuffer: new Uniform(null) },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D inputBuffer;
      varying vec2 vUv;
      void main() {
        // Four bilinear taps cover the block of the view this texel stands for.
        vec2 o = vec2(0.25 / ${METER.toFixed(1)});
        vec3 c = texture2D(inputBuffer, vUv + vec2(-o.x, -o.y)).rgb + texture2D(inputBuffer, vUv + vec2(o.x, -o.y)).rgb
          + texture2D(inputBuffer, vUv + vec2(-o.x, o.y)).rgb + texture2D(inputBuffer, vUv + vec2(o.x, o.y)).rgb;
        float l = dot(c * 0.25, vec3(0.2126, 0.7152, 0.0722));
        // Centre-weighted; a lone blinding pixel can't dominate the log.
        vec2 p = vUv - 0.5;
        float w = exp(-dot(p, p) * 5.0);
        gl_FragColor = vec4(clamp(log2(l + 1e-4), -12.0, 4.0) * w, w, 0.0, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });

const adaptMaterial = (meter: WebGLRenderTarget) =>
  new ShaderMaterial({
    uniforms: {
      inputBuffer: new Uniform(null),
      uMeter: new Uniform(meter.texture),
      uDt: new Uniform(0),
      uReset: new Uniform(1),
    },
    vertexShader: /* glsl */ `
      void main() { gl_Position = vec4(position.xy, 1.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D inputBuffer;
      uniform sampler2D uMeter;
      uniform float uDt;
      uniform float uReset;
      void main() {
        vec4 m = textureLod(uMeter, vec2(0.5), ${METER_LOD.toFixed(1)});
        float now = m.x / max(m.y, 1e-4);
        float was = texture2D(inputBuffer, vec2(0.5)).r;
        // Toward the light in a fraction of a second, back into the dark slowly.
        float rate = now > was ? 3.0 : 0.9;
        float k = uReset > 0.5 ? 1.0 : 1.0 - exp(-uDt * rate);
        gl_FragColor = vec4(mix(was, now, k), 0.0, 0.0, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });

const fragment = /* glsl */ `
${POST_GLSL}
uniform sampler2D uAdapted;
uniform float uKey;
uniform float uAdapt;
uniform vec2 uEvRange;
uniform float uExposure;
uniform vec3 uShadows;
uniform vec3 uHighlights;
uniform float uSaturation;
uniform float uContrast;
uniform float uDrain;

#define KNEE 0.72

// Per channel, like the hard clip the art was painted against — so a hot
// red runs to orange and then to white, as fire does — but rolled off
// smoothly, keeping the shape inside a flame or a blast instead of a flat
// blot.
vec3 shoulder(vec3 c) {
  const float span = 1.0 - KNEE;
  vec3 rolled = KNEE + span * (1.0 - exp(-(c - KNEE) / span));
  return mix(c, rolled, step(KNEE, c));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb, 0.0);
  // The eye: half-way toward the key, within a narrow range.
  float avg = texture2D(uAdapted, vec2(0.5)).r;
  float ev = clamp((uKey - avg) * uAdapt, uEvRange.x, uEvRange.y);
  c *= exp2(ev) * uExposure;

  float l = postLuma(c);
  c = mix(vec3(l), c, uSaturation);
  // Split tone: hue-only tints (normalized to unit luma), weighted by the
  // pixel's own brightness, plus a faint coloured lift in the blacks.
  float w = smoothstep(0.0, 0.35, l);
  vec3 sh = uShadows / max(postLuma(uShadows), 1e-3);
  vec3 hi = uHighlights / max(postLuma(uHighlights), 1e-3);
  c *= mix(mix(vec3(1.0), sh, 0.45), mix(vec3(1.0), hi, 0.3), w);
  c += uShadows * 0.35;
  // Log contrast around middle grey keeps the darks inky…
  c = 0.18 * pow(max(c, 0.0) / 0.18, vec3(uContrast));
  // …and the shoulder keeps the lights from clipping.
  c = shoulder(c);
  // A blow, or death near: the colour drains out of the world.
  c = mix(vec3(postLuma(c)), c, 1.0 - uDrain);
  outputColor = vec4(c, inputColor.a);
}
`;

export class GradeEffect extends Effect {
  private scratch = new Color();
  private meter: WebGLRenderTarget;
  private adapted: [WebGLRenderTarget, WebGLRenderTarget];
  private meterPass: ShaderPass;
  private adaptPass: ShaderPass;
  private reset = true;

  constructor(start: Grade) {
    super("GradeEffect", fragment, {
      uniforms: new Map<string, Uniform>([
        ["uAdapted", new Uniform(null)],
        ["uKey", new Uniform(-4.6)],
        ["uAdapt", new Uniform(0.5)],
        ["uEvRange", new Uniform([-0.45, 0.5])],
        ["uExposure", new Uniform(1)],
        ["uShadows", new Uniform(new Color(start.shadows))],
        ["uHighlights", new Uniform(new Color(start.highlights))],
        ["uSaturation", new Uniform(start.saturation)],
        ["uContrast", new Uniform(start.contrast)],
        ["uDrain", new Uniform(0)],
      ]),
    });
    this.meter = new WebGLRenderTarget(METER, METER, {
      type: HalfFloatType,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
      generateMipmaps: true,
    });
    this.meter.texture.name = "Grade.Meter";
    // Half float like the composer's own buffers (renderable wherever the
    // chain runs at all; a log luminance needs no more precision).
    const one = () =>
      new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false });
    this.adapted = [one(), one()];
    this.meterPass = new ShaderPass(meterMaterial());
    this.adaptPass = new ShaderPass(adaptMaterial(this.meter));
    this.uniforms.get("uAdapted")!.value = this.adapted[0].texture;
  }

  /** Ease the grade toward `g` by the fraction `k` (0…1). */
  approach(g: Grade, k: number): void {
    const u = this.uniforms;
    (u.get("uShadows")!.value as Color).lerp(this.scratch.set(g.shadows), k);
    (u.get("uHighlights")!.value as Color).lerp(this.scratch.set(g.highlights), k);
    u.get("uSaturation")!.value += (g.saturation - u.get("uSaturation")!.value) * k;
    u.get("uContrast")!.value += (g.contrast - u.get("uContrast")!.value) * k;
  }

  /** The grade's tint in the darks, as it stands (eased). */
  get shadows(): Color {
    return this.uniforms.get("uShadows")!.value as Color;
  }

  set exposure(v: number) {
    this.uniforms.get("uExposure")!.value = v;
  }
  set drain(v: number) {
    this.uniforms.get("uDrain")!.value = v;
  }
  /** The log2 luminance the eye settles the view toward. */
  set key(v: number) {
    this.uniforms.get("uKey")!.value = v;
  }

  /** Start the eye afresh (a new scene: no adapting from the last one's
   * light through the cut). */
  resetEye(): void {
    this.reset = true;
  }

  /** The eye's current reading, log2 luminance (dev: tuning the key). */
  readEye(renderer: WebGLRenderer): number {
    const px = new Uint16Array(4);
    renderer.readRenderTargetPixels(this.adapted[0], 0, 0, 1, 1, px);
    return DataUtils.fromHalfFloat(px[0]);
  }

  override update(renderer: WebGLRenderer, input: WebGLRenderTarget, dt = 1 / 60): void {
    this.meterPass.render(renderer, input, this.meter);
    const [from, to] = this.adapted;
    const m = this.adaptPass.fullscreenMaterial as ShaderMaterial;
    m.uniforms.uDt.value = Math.min(dt, 0.1);
    m.uniforms.uReset.value = this.reset ? 1 : 0;
    this.adaptPass.render(renderer, from, to);
    this.adapted = [to, from];
    this.uniforms.get("uAdapted")!.value = to.texture;
    this.reset = false;
  }

  override dispose(): void {
    super.dispose();
    this.meter.dispose();
    for (const t of this.adapted) t.dispose();
    this.meterPass.dispose();
    this.adaptPass.dispose();
  }
}
