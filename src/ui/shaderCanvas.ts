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

/** The transition shader — fully choreographed by `uProgress` (0→1) so the
 * motion is smooth and staged, not a constant frantic tunnel:
 *
 *   mode 1 (mind-dive): gentle hover in front of the wizard's eye, then a hard
 *   PUNCH that zooms through the pupil into the mind, then a flash.
 *
 *   mode 0 (floor warp): you get SUCKED IN to a vortex, HOVER in a parallel
 *   starry world drifting downward (descending floors), then get SUCKED OUT
 *   into the destination.
 *
 * Everything is chunky-pixel quantized to keep the gritty pixel-magic look. */
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
float ease(float x) { x = clamp(x, 0.0, 1.0); return x * x * (3.0 - 2.0 * x); }
vec2 pixel(vec2 v, float n) { return (floor(v * n) + 0.5) / n; }

void main() {
  vec2 uv = vUv - 0.5;
  uv.x *= uRes.x / uRes.y;
  float p = uProgress;
  vec3 col = vec3(0.0);

  if (uMode < 0.5) {
    // ---------------- FLOOR WARP: suck in → descend → suck out -------------
    // Colour arc: start saturated in the portal's colour, fall into a dark
    // space with only hints of it, then surge back into colour on the way out.
    float suckIn  = 1.0 - ease(p / 0.20);                  // 1 → 0 (pull in)
    float suckOut = ease((p - 0.66) / 0.20);               // 0 → 1 (forceful eject)
    float descend = ease((p - 0.10) / 0.56);               // vertical travel
    float mid = (1.0 - suckIn) * (1.0 - suckOut);          // 1 while hovering
    float colorAmt = max(suckIn, suckOut);                 // 1 at the ends, ~0 mid

    float r = length(uv);
    float a = atan(uv.y, uv.x);
    // Swirl spikes while sucking, calms to a slow drift while hovering.
    a += (suckIn * 3.6 + suckOut * 4.0 + 0.22) * (1.2 - r) + uTime * 0.12;
    // Radial zoom: rushes toward the center as you're pulled in, then blasts
    // outward past you as you're ejected — a hard outward kick for force.
    float zoom = 1.0 + suckIn * 4.5 - suckOut * 1.9;
    vec2 sp = vec2(cos(a), sin(a)) * r * zoom;

    // Downward drift — you sink through the parallel world floor by floor.
    float vy = descend * 8.0 + uTime * 0.5 * mid;

    // Three parallax star layers — bright at the colourful ends, dim in the
    // dark middle.
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float depth = 1.0 + fi * 1.7;
      vec2 cell = pixel(vec2(sp.x * depth, sp.y * depth - vy * (0.5 + fi * 0.45)), 42.0);
      float h = hash21(floor(cell * 20.0) + fi * 31.0);
      float star = step(0.93 - 0.015 * fi, h);
      float tw = 0.55 + 0.45 * sin(uTime * 3.0 + h * 30.0);
      col += (uTint * 0.7 + 0.3) * star * tw * (0.55 - fi * 0.13) * (0.35 + 0.65 * colorAmt);
    }
    // Parallel-world nebula — mostly dark in the middle, only a hint of colour.
    float neb = pow(fbm(vec2(sp.x * 1.8, sp.y * 1.8 - vy * 0.5)), 2.0);
    col += uTint * neb * (0.10 + 0.5 * colorAmt);
    col += mix(vec3(0.006, 0.005, 0.020), uTint * 0.05, r) * (0.5 + 0.5 * colorAmt);

    // Radial streaks screaming past — heavier on the forceful eject.
    float streak = pow(hash21(vec2(floor((a * 0.1591549 + 0.5) * 210.0), 3.0)), 20.0);
    col += (uTint + 0.3) * streak * (suckIn + suckOut * 2.0) * smoothstep(0.0, 0.6, r) * 2.6;

    // Eject: surge back into the portal colour, then a hard white flash.
    col = mix(col, uTint * 1.8 + 0.2, suckOut * 0.85);
    col = mix(col, vec3(0.94, 0.99, 1.0), pow(suckOut, 2.5) * 0.8);
  } else {
    // ---------------- MIND-DIVE: hover → PUNCH into the mind ---------------
    // A calm dreaming void with a distant glowing core, then a hard punch that
    // yanks you into the core — into the wizard's mind. No literal eye.
    float hover = ease(p / 0.50);
    float punch = pow(clamp((p - 0.50) / 0.24, 0.0, 1.0), 2.4); // snappy
    float fly = hover * 0.14 + punch * punch * 11.0;            // big zoom on the punch
    // Gentle floating sway before the punch.
    uv += 0.035 * vec2(sin(uTime * 0.7), cos(uTime * 0.55)) * (1.0 - punch);

    float scale = 1.0 / (1.0 + fly);
    vec2 z = uv * scale;
    float r = length(z);
    float a = atan(z.y, z.x);

    // Dreamy pixel starfield + nebula.
    vec2 cell = pixel(z, 26.0);
    float star = step(0.93, hash21(floor(cell * 40.0)));
    float neb = pow(fbm(z * 3.0 + uTime * 0.15), 2.0);

    // The mind's core: a soft glow at center that blooms as you punch into it.
    float core = smoothstep(0.5, 0.0, r);
    float pulse = 0.6 + 0.4 * sin(uTime * 2.0);

    col = vec3(0.02, 0.015, 0.05);
    col += uTint * neb * 0.35;
    col += (uTint * 0.7 + 0.3) * star * 0.7;
    col += uTint * core * core * (0.5 + 0.8 * pulse + punch * 3.0);

    // Streaks screaming inward as the punch accelerates.
    float streak = pow(hash21(vec2(floor((a * 0.1591549 + 0.5) * 240.0), 5.0)), 16.0);
    col += (uTint + 0.5) * streak * punch * smoothstep(0.0, 0.55, r) * 4.5;

    // Whiteout as we punch through the core, peaking just before the reveal.
    col = mix(col, vec3(0.95, 0.98, 1.0), pow(clamp((p - 0.78) / 0.12, 0.0, 1.0), 2.0));
  }

  // Stepped palette → deliberate pixel-magic banding.
  col = floor(col * 13.0) / 13.0;
  gl_FragColor = vec4(col, 1.0);
}`;
