import {
  Color,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from "three";
import { GLSL_NOISE } from "../render/shaderLib";

/** A tiny standalone full-screen fragment-shader canvas — its own WebGL
 * context, independent of the R3F scene, used for the in-world transitions
 * (portal warp, mind-dive). It renders at a low backing resolution and is
 * upscaled with `image-rendering: pixelated`, so it shares the game's chunky
 * pixel grain "for free" — the same trick the main canvas uses. */
export interface ShaderQuad {
  readonly canvas: HTMLCanvasElement;
  setUniforms(u: Partial<Uniforms>): void;
  start(): void;
  stop(): void;
  dispose(): void;
}

interface Uniforms {
  time: number;
  progress: number;
  mode: number; // 0 = warp, 1 = mind-dive
  tint: string;
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** Backing height in pixels — the whole effect renders into this many rows and
 * the browser blows it up with nearest-neighbour. Higher = finer pixels. Tuned
 * for a "high-res pixel" look: detailed, deliberately chunky, never muddy. */
const BACKING_H = 300;

export function createShaderQuad(fragment: string): ShaderQuad {
  const canvas = document.createElement("canvas");
  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.setPixelRatio(1);

  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: fragment,
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uMode: { value: 0 },
      uTint: { value: new Color("#46ffd0") },
      uRes: { value: new Vector2(1, 1) },
    },
    depthTest: false,
    depthWrite: false,
  });

  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  scene.add(new Mesh(new PlaneGeometry(2, 2), material));

  let raf = 0;
  let startTime = 0;

  const resize = () => {
    const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
    const h = BACKING_H;
    const w = Math.round(h * aspect);
    renderer.setSize(w, h, false);
    material.uniforms.uRes.value.set(w, h);
  };
  resize();
  window.addEventListener("resize", resize);

  const frame = (now: number) => {
    if (!startTime) startTime = now;
    material.uniforms.uTime.value = (now - startTime) / 1000;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };

  return {
    canvas,
    setUniforms(u) {
      if (u.time !== undefined) material.uniforms.uTime.value = u.time;
      if (u.progress !== undefined) material.uniforms.uProgress.value = u.progress;
      if (u.mode !== undefined) material.uniforms.uMode.value = u.mode;
      if (u.tint !== undefined) (material.uniforms.uTint.value as Color).set(u.tint);
    },
    start() {
      if (!raf) {
        startTime = 0;
        raf = requestAnimationFrame(frame);
      }
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    dispose() {
      this.stop();
      window.removeEventListener("resize", resize);
      material.dispose();
      renderer.dispose();
    },
  };
}

/** The transition shader: a log-polar hyperspace tunnel with fbm energy walls,
 * stretched star streaks, and a collapsing iris for the mind-dive. Reused for
 * both the portal warp (mode 0) and the splash→village dive (mode 1). */
export const TRANSITION_FRAG =
  /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uProgress;
uniform float uMode;
uniform vec3 uTint;
uniform vec2 uRes;
` +
  GLSL_NOISE +
  /* glsl */ `
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

void main() {
  vec2 uv = vUv - 0.5;
  uv.x *= uRes.x / uRes.y;

  float r = length(uv);
  float a = atan(uv.y, uv.x);

  // Speed ramps up over the first second so the jump *accelerates* into the
  // tunnel instead of starting at full tilt.
  float ramp = 0.5 + 1.6 * clamp(uTime, 0.0, 1.4);
  float dive = uMode; // 1.0 for mind-dive

  // Log-polar tunnel: 1/r makes the center feel infinitely deep.
  float swirl = (0.5 + 0.8 * dive) / (r + 0.12);
  a += swirl + uTime * (0.3 + 0.4 * dive);
  float z = uTime * ramp + 0.34 / (r + 0.05);
  float u = a * 0.1591549; // /(2pi)

  // Energy walls of the tunnel.
  float wall = fbm(vec2(u * 9.0, z * 1.2));
  wall += 0.5 * fbm(vec2(u * 24.0 + 4.0, z * 2.4 - 1.0));
  wall = pow(clamp(wall, 0.0, 1.0), 1.7);

  // Stretched star streaks screaming past.
  float band = hash21(vec2(floor(u * 240.0), floor(z * 0.6)));
  float streak = pow(band, 22.0) * smoothstep(0.02, 0.45, r);

  vec3 deep = mix(vec3(0.015, 0.010, 0.045), vec3(0.06, 0.02, 0.11), dive);
  vec3 col = deep;
  col += uTint * wall * (0.45 + r * 1.4);
  col += vec3(1.0) * streak * 1.1;
  col += uTint * streak * 0.6;

  // A pull of brightness toward the vanishing point.
  float core = smoothstep(0.55, 0.0, r);
  col += uTint * core * core * (0.35 + 0.7 * dive);

  // Mind-dive: a wizard's iris contracting to a pupil in the first beat, then
  // the pupil swallows the screen — you fall into the mind.
  if (dive > 0.5) {
    float p = clamp(uProgress, 0.0, 1.0);
    float irisR = mix(1.05, 0.0, smoothstep(0.0, 0.55, p));
    float ring = smoothstep(0.06, 0.0, abs(r - irisR));
    // fibrous iris texture
    float fib = 0.5 + 0.5 * sin(a * 40.0 + fbm(vec2(a * 6.0, r * 8.0)) * 6.0);
    col += uTint * ring * (0.8 + 0.8 * fib);
    col *= smoothstep(irisR * 0.5, irisR * 0.85, r); // dark pupil
  }

  // Quantize color into stepped bands — reinforces the pixel-magic look,
  // like a limited palette catching light.
  col = floor(col * 14.0) / 14.0;

  // A bright flash right before we hand off to the world.
  float flash = smoothstep(0.8, 1.0, uProgress) * dive;
  col = mix(col, vec3(0.85, 1.0, 0.96), flash);

  gl_FragColor = vec4(col, 1.0);
}`;
