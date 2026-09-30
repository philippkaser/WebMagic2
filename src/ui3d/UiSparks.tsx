import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
} from "three";

/** Embers for the UI layer: what dissolving text and collapsing tablets
 * shed. The world canvas has its own (much bigger) particle system; this one
 * lives in the UI canvas so the sparks sit exactly on the glyphs they came
 * from and stay crisp at full resolution.
 *
 * A fixed pool of camera-facing quads simulated on the CPU (gravity, drag,
 * a little curl so they wander like real embers) and drawn in one additive
 * call. Emitting past capacity recycles the oldest spark. */

const CAPACITY = 768;

const pos = new Float32Array(CAPACITY * 3);
const vel = new Float32Array(CAPACITY * 3);
const life = new Float32Array(CAPACITY); // seconds left
const ttl = new Float32Array(CAPACITY);
const size = new Float32Array(CAPACITY);
const colors = new Float32Array(CAPACITY * 3);
let cursor = 0;
let alive = 0;

export interface UiSparkOptions {
  position: readonly [number, number, number];
  color: string;
  count?: number;
  /** Initial speed, m/s (the UI lives ~1–3 m from the eye: keep it small). */
  speed?: number;
  /** Extra upward drift, m/s. */
  up?: number;
  ttl?: number;
  size?: number;
  /** Positional jitter radius, m. */
  spread?: number;
}

const tmpColor = new Color();

export function emitUiSparks(o: UiSparkOptions): void {
  const count = o.count ?? 6;
  const speed = o.speed ?? 0.25;
  const up = o.up ?? 0.18;
  const spread = o.spread ?? 0.01;
  tmpColor.set(o.color);
  for (let n = 0; n < count; n++) {
    const i = cursor;
    cursor = (cursor + 1) % CAPACITY;
    const a = Math.random() * Math.PI * 2;
    const b = Math.random() * 2 - 1;
    const r = Math.sqrt(1 - b * b);
    const s = speed * (0.3 + Math.random() * 0.7);
    pos[i * 3] = o.position[0] + (Math.random() - 0.5) * spread;
    pos[i * 3 + 1] = o.position[1] + (Math.random() - 0.5) * spread;
    pos[i * 3 + 2] = o.position[2] + (Math.random() - 0.5) * spread;
    vel[i * 3] = Math.cos(a) * r * s;
    vel[i * 3 + 1] = b * s + up;
    vel[i * 3 + 2] = Math.sin(a) * r * s;
    const t = (o.ttl ?? 0.9) * (0.6 + Math.random() * 0.6);
    life[i] = t;
    ttl[i] = t;
    size[i] = (o.size ?? 0.012) * (0.6 + Math.random() * 0.8);
    // Slight per-spark hue drift toward white-hot keeps a burst lively.
    const hot = Math.random() * 0.4;
    colors[i * 3] = tmpColor.r + (1 - tmpColor.r) * hot;
    colors[i * 3 + 1] = tmpColor.g + (1 - tmpColor.g) * hot;
    colors[i * 3 + 2] = tmpColor.b + (1 - tmpColor.b) * hot;
  }
  alive = CAPACITY; // simulate the whole pool until it has burnt down again
}

const VERT = /* glsl */ `
attribute vec4 aPosSize;
attribute vec4 aColorAlpha;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vUv = uv;
  vColor = aColorAlpha;
  vec4 mv = modelViewMatrix * vec4(aPosSize.xyz, 1.0);
  mv.xy += position.xy * aPosSize.w;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec2 d = vUv - 0.5;
  float r = dot(d, d) * 4.0;
  float g = exp(-r * 3.5) + step(r, 0.08) * 0.6;
  if (g * vColor.a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb * g * vColor.a * 1.6, 1.0);
  #include <colorspace_fragment>
  // Alpha 0: on the transparent UI canvas a spark must only ADD light to the
  // world beneath it, never cover it (see the blending note below).
  gl_FragColor.a = 0.0;
}
`;

/** Mount once inside the UI canvas. */
export function UiSparks() {
  const { mesh, posSize, colorAlpha } = useMemo(() => {
    const base = new PlaneGeometry(1, 1);
    const geometry = new InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.setAttribute("position", base.getAttribute("position"));
    geometry.setAttribute("uv", base.getAttribute("uv"));
    const posSize = new InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
    const colorAlpha = new InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
    posSize.setUsage(DynamicDrawUsage);
    colorAlpha.setUsage(DynamicDrawUsage);
    geometry.setAttribute("aPosSize", posSize);
    geometry.setAttribute("aColorAlpha", colorAlpha);
    geometry.instanceCount = 0;
    const material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      // Premultiplied additive = ONE, ONE on colour AND alpha: with the shader
      // writing alpha 0 the canvas stays see-through where sparks glow.
      blending: AdditiveBlending,
      premultipliedAlpha: true,
    });
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 50;
    return { mesh, posSize, colorAlpha };
  }, []);

  useFrame((_, rawDt) => {
    const geometry = mesh.geometry as InstancedBufferGeometry;
    if (alive === 0) {
      geometry.instanceCount = 0;
      return;
    }
    const dt = Math.min(rawDt, 0.05);
    const drag = Math.exp(-dt * 2.2);
    const ps = posSize.array as Float32Array;
    const ca = colorAlpha.array as Float32Array;
    let n = 0;
    for (let i = 0; i < CAPACITY; i++) {
      if (life[i]! <= 0) continue;
      life[i] = life[i]! - dt;
      if (life[i]! <= 0) continue;
      const k = i * 3;
      // Buoyant embers: a little lift and a sideways wobble instead of gravity.
      vel[k] = vel[k]! * drag + Math.sin(life[i]! * 9 + i) * 0.03 * dt;
      vel[k + 1] = vel[k + 1]! * drag + 0.12 * dt;
      vel[k + 2] = vel[k + 2]! * drag;
      pos[k] = pos[k]! + vel[k]! * dt;
      pos[k + 1] = pos[k + 1]! + vel[k + 1]! * dt;
      pos[k + 2] = pos[k + 2]! + vel[k + 2]! * dt;
      const f = life[i]! / ttl[i]!;
      const o = n * 4;
      ps[o] = pos[k]!;
      ps[o + 1] = pos[k + 1]!;
      ps[o + 2] = pos[k + 2]!;
      ps[o + 3] = size[i]! * (0.4 + f * 0.6);
      ca[o] = colors[k]!;
      ca[o + 1] = colors[k + 1]!;
      ca[o + 2] = colors[k + 2]!;
      ca[o + 3] = Math.min(1, f * 2.2);
      n++;
    }
    if (n === 0) alive = 0;
    geometry.instanceCount = n;
    posSize.needsUpdate = true;
    colorAlpha.needsUpdate = true;
  });

  return <primitive object={mesh} />;
}
