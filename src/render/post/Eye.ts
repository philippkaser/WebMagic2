import { ShaderPass } from "postprocessing";
import {
  DataUtils,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  ShaderMaterial,
  type Texture,
  Uniform,
  WebGLRenderTarget,
  type WebGLRenderer,
} from "three";

/** The eye: the view is metered every frame (a log average, weighted to the
 * middle — what you look at counts most) and the eye follows it: step out
 * of a black corridor and the hall opens up over a second or two; stare
 * into a blast or the forge's fire and the room around it sinks. Fast
 * toward the light, slow back into the dark, like an eye. The result is one
 * pixel (log2 luminance) the composite reads to set its exposure — all on
 * the GPU, nothing read back. */

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

export class Eye {
  private meter: WebGLRenderTarget;
  private adapted: [WebGLRenderTarget, WebGLRenderTarget];
  private meterPass: ShaderPass;
  private adaptPass: ShaderPass;
  private reset = true;

  constructor() {
    this.meter = new WebGLRenderTarget(METER, METER, {
      type: HalfFloatType,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
      generateMipmaps: true,
    });
    // Half float like the rest of the chain (renderable wherever it runs at
    // all; a log luminance needs no more precision).
    const one = () =>
      new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false });
    this.adapted = [one(), one()];
    this.meterPass = new ShaderPass(meterMaterial());
    this.adaptPass = new ShaderPass(adaptMaterial(this.meter));
  }

  /** The adapted log2 luminance (one pixel, red). */
  get texture(): Texture {
    return this.adapted[0].texture;
  }

  /** Meter `view` and let the eye follow it over `dt` seconds. */
  update(renderer: WebGLRenderer, view: WebGLRenderTarget, dt: number): void {
    this.meterPass.render(renderer, view, this.meter);
    const [from, to] = this.adapted;
    const m = this.adaptPass.fullscreenMaterial as ShaderMaterial;
    m.uniforms.uDt.value = Math.min(dt, 0.1);
    m.uniforms.uReset.value = this.reset ? 1 : 0;
    this.adaptPass.render(renderer, from, to);
    this.adapted = [to, from];
    this.reset = false;
  }

  /** The eye's current reading, log2 luminance (dev: tuning the keys). */
  read(renderer: WebGLRenderer): number {
    const px = new Uint16Array(4);
    renderer.readRenderTargetPixels(this.adapted[0], 0, 0, 1, 1, px);
    return DataUtils.fromHalfFloat(px[0]);
  }

  dispose(): void {
    this.meter.dispose();
    for (const t of this.adapted) t.dispose();
    this.meterPass.dispose();
    this.adaptPass.dispose();
  }
}
