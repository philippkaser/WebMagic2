import { ShaderPass } from "postprocessing";
import { HalfFloatType, LinearFilter, ShaderMaterial, type Texture, Uniform, Vector2, WebGLRenderTarget, type WebGLRenderer } from "three";

/** Anamorphic streaks: the long horizontal flare a cinema lens draws through
 * a bright light — a torch down the hall, a blast, the rift, the moon —
 * thin and blue-white, reaching across the view. Built from the bloom's
 * bright pass at a quarter of the world's resolution (half wide, quarter
 * tall: a streak needs width, not height) by three horizontal blurs, each
 * reaching four times further than the last, so a dozen taps a pass spread
 * the light hundreds of pixels. The composite upsamples it smooth.
 *
 * Only the world's lights streak: the staff in your hand is always the
 * brightest thing in view, and a flare pinned across the middle of the
 * screen would be a smear, not a lens — so the first pass drops anything
 * nearer than arm's length (by depth), and anything only just over the
 * bloom's threshold. */

const blurMaterial = () =>
  new ShaderMaterial({
    uniforms: {
      inputBuffer: new Uniform(null),
      uStep: new Uniform(1),
      uTexel: new Uniform(new Vector2()),
      uGain: new Uniform(1),
      uGather: new Uniform(1),
      uDepth: new Uniform(null),
      uNear: new Uniform(0.1),
      uFar: new Uniform(100),
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      #include <packing>
      uniform sampler2D inputBuffer;
      uniform sampler2D uDepth;
      uniform float uNear;
      uniform float uFar;
      uniform float uGather;
      uniform float uStep;
      uniform vec2 uTexel;
      uniform float uGain;
      varying vec2 vUv;
      vec3 tap(vec2 p) {
        vec3 c = texture2D(inputBuffer, p).rgb;
        if (uGather < 0.5) return c;
        // The first pass: world lights only, and only the bright ones.
        float d = -perspectiveDepthToViewZ(texture2D(uDepth, p).r, uNear, uFar);
        if (d < 0.75) return vec3(0.0);
        float m = max(c.r, max(c.g, c.b));
        return c * (max(m - 0.5, 0.0) / max(m, 1e-4));
      }
      void main() {
        vec3 sum = vec3(0.0);
        float total = 0.0;
        for (int i = -6; i <= 6; i++) {
          float x = float(i);
          // A long tail, not a bell: streaks fade slowly away from the light.
          float w = exp(-abs(x) * 0.42);
          sum += tap(vUv + vec2(x * uStep * uTexel.x, 0.0)) * w;
          total += w;
        }
        gl_FragColor = vec4(sum / total * uGain, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });

export class Streaks {
  private targets: [WebGLRenderTarget, WebGLRenderTarget];
  private pass = new ShaderPass(blurMaterial());
  private size = new Vector2();

  constructor() {
    const rt = () => new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
    this.targets = [rt(), rt()];
  }

  get texture(): Texture {
    return this.targets[1].texture;
  }
  get textureSize(): Vector2 {
    return this.size;
  }

  setSize(worldWidth: number, worldHeight: number): void {
    const w = Math.max(1, Math.ceil(worldWidth / 2));
    const h = Math.max(1, Math.ceil(worldHeight / 4));
    if (w === this.size.x && h === this.size.y) return;
    this.size.set(w, h);
    for (const t of this.targets) t.setSize(w, h);
  }

  /** Streak the bright pass `bright` (read with filtering), dropping what's
   * nearer than arm's length in `depth` (the world's depth, same framing). */
  render(renderer: WebGLRenderer, bright: Texture, depth: Texture, near: number, far: number): void {
    const m = this.pass.fullscreenMaterial as ShaderMaterial;
    m.uniforms.uTexel.value.set(1 / this.size.x, 1 / this.size.y);
    m.uniforms.uDepth.value = depth;
    m.uniforms.uNear.value = near;
    m.uniforms.uFar.value = far;
    const [a, b] = this.targets;
    // bright → b (step 1, gathering) → a (step 4) → b (step 16).
    m.uniforms.uStep.value = 1;
    m.uniforms.uGain.value = 1;
    m.uniforms.uGather.value = 1;
    this.pass.render(renderer, { texture: bright } as WebGLRenderTarget, b);
    m.uniforms.uGather.value = 0;
    m.uniforms.uStep.value = 4;
    this.pass.render(renderer, b, a);
    m.uniforms.uStep.value = 16;
    // The widest pass gathers the most dilution: give the energy back so
    // the streak keeps a bright core near the light.
    m.uniforms.uGain.value = 1.6;
    this.pass.render(renderer, a, b);
  }

  dispose(): void {
    for (const t of this.targets) t.dispose();
    this.pass.dispose();
  }
}
