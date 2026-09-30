import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  PlaneGeometry,
  QuadraticBezierCurve3,
  ShaderMaterial,
  Vector3,
} from "three";
import { uiNow } from "../../clock";
import { useUiShow } from "../../presence";

/** Light for the menus: soft glows behind burning words, and threads of
 * light that run between things. Both are additive and write alpha 0, so on
 * the transparent UI canvas they only ever ADD light to the world beneath
 * (the same contract as UiSparks and the tablet rim). */

// ── Soft glow ────────────────────────────────────────────────────────────────

const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 d = (vUv - 0.5) * 2.0;
  float r = length(d);
  // A wide, gentle falloff with a brighter core; a slow shimmer so it
  // reads as fire behind the words rather than a lamp.
  float a = pow(max(0.0, 1.0 - r), 2.0) * 0.8 + pow(max(0.0, 1.0 - r), 6.0) * 0.6;
  float shimmer = 0.9 + 0.1 * sin(uTime * 2.3 + d.x * 3.0) * sin(uTime * 1.7 - d.y * 4.0);
  gl_FragColor = vec4(uColor * a * uIntensity * shimmer, 0.0);
  #include <colorspace_fragment>
  gl_FragColor.a = 0.0;
}
`;

let glowQuad: PlaneGeometry | null = null;

/** A soft elliptical glow — the heat behind big burning text. Swells in
 * after `delay`, breathes, and fades with the enclosing presence. The
 * pixel font's own halo is per-texel (right for small text, blocky at
 * title size); this is the smooth light a title throws. */
export function SoftGlow({
  color,
  width,
  height,
  intensity = 1,
  delay = 0,
  fadeIn = 0.8,
  breathe = 0.15,
  position,
}: {
  color: string;
  width: number;
  height: number;
  intensity?: number;
  delay?: number;
  fadeIn?: number;
  /** Amplitude of the slow pulse (fraction of intensity). */
  breathe?: number;
  position?: readonly [number, number, number];
}) {
  const show = useUiShow();
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uColor: { value: new Color(color) }, uIntensity: { value: 0 }, uTime: { value: 0 } },
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        premultipliedAlpha: true,
      }),
    [color],
  );
  useEffect(() => () => material.dispose(), [material]);
  const since = useRef(uiNow());
  const level = useRef(0);
  useEffect(() => {
    since.current = uiNow();
  }, [show]);
  const mesh = useRef<Mesh>(null);
  useFrame((_, dt) => {
    const now = uiNow();
    const t = now - since.current;
    const target = show ? Math.min(1, Math.max(0, (t - delay) / fadeIn)) : 0;
    level.current = show ? target : level.current * Math.exp(-dt * 5);
    const u = material.uniforms;
    u.uTime!.value = now;
    u.uIntensity!.value = intensity * level.current * (1 + Math.sin(now * 1.1) * breathe);
    if (mesh.current) mesh.current.visible = level.current > 0.002;
  });
  return (
    <mesh
      ref={mesh}
      geometry={(glowQuad ??= new PlaneGeometry(1, 1))}
      material={material}
      scale={[width, height, 1]}
      position={position as [number, number, number] | undefined}
      renderOrder={3}
    />
  );
}

// ── Threads of light ─────────────────────────────────────────────────────────

const THREAD_VERT = /* glsl */ `
attribute float aAlong;
attribute float aAcross;
varying float vAlong;
varying float vAcross;
void main() {
  vAlong = aAlong;
  vAcross = aAcross;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const THREAD_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uHead;
uniform float uTail;
uniform float uFade;
uniform float uTime;
varying float vAlong;
varying float vAcross;
void main() {
  float d = abs(vAcross);
  float core = smoothstep(0.45, 0.1, d);
  float glow = exp(-d * d * 5.0) * 0.5;
  float drawn = step(vAlong, uHead) * step(uTail, vAlong);
  // Light flows along the thread toward its end, in beads.
  float flow = 0.65 + 0.35 * pow(0.5 + 0.5 * sin(vAlong * 38.0 - uTime * 9.0), 3.0);
  float head = exp(-abs(vAlong - uHead) * 30.0) * step(uHead, 0.999);
  vec3 col = uColor * (core * 1.4 + glow) * drawn * flow + vec3(1.0, 0.97, 0.9) * head * (core + glow) * 2.5 * step(0.001, uHead);
  gl_FragColor = vec4(col * uFade, 0.0);
  #include <colorspace_fragment>
  gl_FragColor.a = 0.0;
}
`;

/** A flat ribbon along a quadratic curve, `aAlong` 0 → 1 from start to end,
 * `aAcross` −1 → 1 across. Tapers toward the end so threads converge
 * cleanly into a point. */
function threadGeometry(from: Vector3, control: Vector3, to: Vector3, width: number, segments = 40): BufferGeometry {
  const curve = new QuadraticBezierCurve3(from, control, to);
  const pts = curve.getPoints(segments);
  const pos: number[] = [];
  const along: number[] = [];
  const across: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const p = pts[i]!;
    const q = pts[Math.min(segments, i + 1)]!;
    const r = pts[Math.max(0, i - 1)]!;
    const tx = q.x - r.x;
    const ty = q.y - r.y;
    const len = Math.hypot(tx, ty) || 1;
    const s = i / segments;
    const w = (width / 2) * (1 - s * 0.55);
    const nx = (-ty / len) * w;
    const ny = (tx / len) * w;
    pos.push(p.x + nx, p.y + ny, p.z, p.x - nx, p.y - ny, p.z);
    along.push(s, s);
    across.push(1, -1);
    if (i < segments) {
      const b = i * 2;
      index.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("aAlong", new Float32BufferAttribute(along, 1));
  g.setAttribute("aAcross", new Float32BufferAttribute(across, 1));
  g.setIndex(index);
  return g;
}

/** A thread of light running from `from` to `to` (bowing through
 * `control`): it starts `delay` s after showing, runs its length in
 * `duration` s with a white-hot head, then keeps flowing. On exit it drains
 * away from its start and fades. */
export function LightThread({
  from,
  control,
  to,
  color,
  width = 0.01,
  delay = 0,
  duration = 0.6,
  onArrive,
}: {
  from: readonly [number, number, number];
  control: readonly [number, number, number];
  to: readonly [number, number, number];
  color: string;
  width?: number;
  delay?: number;
  duration?: number;
  /** Called once when the head reaches the end. */
  onArrive?: () => void;
}) {
  const show = useUiShow();
  const [fx, fy, fz] = from;
  const [cx, cy, cz] = control;
  const [tx, ty, tz] = to;
  const mesh = useMemo(() => {
    const material = new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color(color) },
        uHead: { value: 0 },
        uTail: { value: 0 },
        uFade: { value: 1 },
        uTime: { value: 0 },
      },
      vertexShader: THREAD_VERT,
      fragmentShader: THREAD_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      premultipliedAlpha: true,
    });
    const g = threadGeometry(new Vector3(fx, fy, fz), new Vector3(cx, cy, cz), new Vector3(tx, ty, tz), width);
    const m = new Mesh(g, material);
    m.frustumCulled = false;
    m.renderOrder = 6;
    return m;
  }, [fx, fy, fz, cx, cy, cz, tx, ty, tz, width, color]);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as ShaderMaterial).dispose();
    },
    [mesh],
  );
  const since = useRef(uiNow());
  const arrived = useRef(false);
  const onArriveRef = useRef(onArrive);
  onArriveRef.current = onArrive;
  useEffect(() => {
    since.current = uiNow();
  }, [show]);
  useFrame(() => {
    const u = (mesh.material as ShaderMaterial).uniforms;
    const now = uiNow();
    const t = now - since.current;
    u.uTime!.value = now;
    if (show) {
      const p = Math.min(1, Math.max(0, (t - delay) / duration));
      // Ease-in: the light gathers speed as it runs.
      u.uHead!.value = p * p * (2 - p) * (p < 1 ? 1 : 1.0001);
      u.uTail!.value = 0;
      u.uFade!.value = 1;
      if (p >= 1 && !arrived.current) {
        arrived.current = true;
        onArriveRef.current?.();
      }
    } else {
      u.uTail!.value = Math.min(1, t / 0.4);
      u.uFade!.value = Math.max(0, 1 - t / 0.6);
      arrived.current = false;
    }
    mesh.visible = u.uHead!.value > 0 && u.uFade!.value > 0;
  });
  return <primitive object={mesh} />;
}
