import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Color, Group, Mesh, PlaneGeometry, ShaderMaterial } from "three";
import { BASE_FOV, ViewAnchor } from "../../anchors";
import { uiNow } from "../../clock";
import { UiShow, useUiShow } from "../../presence";

/** Staging for the menu screens: where a screen stands, when its parts
 * arrive, and the darkness that gathers behind it.
 *
 * Screens are composed in SCREEN-HEIGHT units: at distance D one unit is
 * the height of the view (`screenUnit(D)` metres), so "x = 0.4, cap 0.02"
 * means the same share of the screen on any display. */

/** Metres that span the full view height at `distance` (BASE_FOV). */
export function screenUnit(distance: number): number {
  return 2 * distance * Math.tan((BASE_FOV * Math.PI) / 360);
}

/** A screen's stage: a plane `distance` ahead of the eye, carried with the
 * view, whose content is designed for a `width` × `height` box in screen-
 * height units. On a display too narrow for it (a portrait phone) the
 * stage shrinks about its own centre — shrinking about the eye would change
 * nothing on screen. */
export function Stage({
  distance,
  width,
  height = 1,
  children,
}: {
  distance: number;
  width: number;
  height?: number;
  children: ReactNode;
}) {
  const size = useThree((s) => s.size);
  const aspect = size.width / Math.max(1, size.height);
  const fit = Math.min(1, (aspect * 0.97) / width, 0.99 / height);
  return (
    <ViewAnchor offset={[0, 0, -distance]} follow={9} maxLagDeg={3}>
      <group scale={fit}>{children}</group>
    </ViewAnchor>
  );
}

/** Children arrive `by` seconds after this becomes visible — the beats of a
 * screen's entrance, without per-frame React state (one timer flip). */
export function Delayed({ by, children }: { by: number; children: ReactNode }) {
  const show = useUiShow();
  const [ready, setReady] = useState(by <= 0);
  useEffect(() => {
    if (!show || by <= 0) return;
    const t = setTimeout(() => setReady(true), by * 1000);
    return () => clearTimeout(t);
  }, [show, by]);
  return <UiShow show={ready}>{children}</UiShow>;
}

/** A back-out ease: arrives, overshoots a touch, settles. */
export function backOut(t: number, s = 1.6): number {
  const u = Math.min(1, Math.max(0, t)) - 1;
  return 1 + u * u * ((s + 1) * u + s);
}

export function smooth01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** A plain 3D object (item, pedestal) given the in-world entrance: it
 * swells out of nothing with a twist and an overshoot, and shrinks away
 * again on exit. RuneText and Tablet have their own; this is for the rest. */
export function Appear({
  delay = 0,
  duration = 0.55,
  twist = 1.2,
  position,
  children,
}: {
  delay?: number;
  duration?: number;
  twist?: number;
  position?: readonly [number, number, number];
  children: ReactNode;
}) {
  const show = useUiShow();
  const group = useRef<Group>(null);
  const since = useRef(uiNow());
  const from = useRef(0);
  const k = useRef(0);
  useEffect(() => {
    since.current = uiNow();
    from.current = k.current;
  }, [show]);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = uiNow() - since.current;
    if (show) {
      const p = (t - delay) / duration;
      k.current = p <= 0 ? from.current : from.current + (1 - from.current) * backOut(p);
    } else {
      const p = smooth01(t / 0.35);
      k.current = from.current * (1 - p);
    }
    const s = Math.max(0.0001, k.current);
    g.scale.setScalar(s);
    g.rotation.y = (1 - Math.min(1, k.current)) * twist;
    g.visible = k.current > 0.001;
  });
  return (
    <group position={position as [number, number, number] | undefined}>
      <group ref={group} visible={false}>
        {children}
      </group>
    </group>
  );
}

// ── The veil ─────────────────────────────────────────────────────────────────

const VEIL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  // A full-screen quad: the veil is the dark gathering around the whole
  // view, not an object at any one depth.
  gl_Position = vec4(position.xy * 2.0, 0.9999, 1.0);
}
`;

const VEIL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uInner;
uniform float uAlpha;
uniform float uCenter;
uniform float uCy;
uniform float uTime;
uniform float uAspect;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return v;
}
// 4×4 ordered dither: the gradient steps like a pixel-art backdrop.
float bayer(vec2 c) {
  vec2 m = mod(c, 4.0);
  int i = int(m.x) + int(m.y) * 4;
  int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(b[i]) + 0.5) / 16.0;
}

void main() {
  // The whole veil lives on a 180-row grid (artpass's backdrop canvas), so
  // its gradient is banded pixels, not a smooth airbrush.
  vec2 grid = vec2(180.0 * uAspect, 180.0);
  vec2 cell = floor(vUv * grid);
  vec2 uv = (cell + 0.5) / grid;
  vec2 p = (uv - vec2(0.5, 0.5 + uCy)) * vec2(uAspect, 1.0);
  float t = floor(uTime * 12.0) / 12.0;
  // Slow smoke: two layers drifting against each other.
  float smoke = fbm(p * 2.2 + vec2(t * 0.035, -t * 0.05)) * 0.6 + fbm(p * 4.1 - vec2(t * 0.05, t * 0.02)) * 0.4;
  float r = length(p / vec2(uAspect * 0.62, 0.62));
  float edge = smoothstep(0.15, 1.0, r);
  float a = uAlpha * mix(uCenter, 1.0, edge) * (0.86 + 0.28 * smoke);
  // Quantize to 10 levels, dithered between neighbours.
  float levels = 10.0;
  a = floor(a * levels + bayer(cell)) / levels;
  vec3 col = mix(uInner, uColor, edge);
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.98));
  #include <colorspace_fragment>
}
`;

let veilQuad: PlaneGeometry | null = null;

/** The world dims behind a menu the way a room does when you stop looking at
 * it: a slow smoke of darkness gathers, heavier toward the edges, lighter
 * where the menu stands. `strength` is the edge opacity, `center` the share
 * of it that reaches the middle; `inner` tints the middle (artpass's
 * backdrop glows a little toward its circle: violet-black on the title,
 * oxblood on death), `cy` lifts the middle (fraction of the view height).
 * Drawn on a 180-row pixel grid with dithered steps, like the artpass
 * backdrop canvas it stands in for. */
export function Veil({
  color,
  inner,
  strength = 0.8,
  center = 0.55,
  cy = 0,
}: {
  color: string;
  inner?: string;
  strength?: number;
  center?: number;
  cy?: number;
}) {
  const show = useUiShow();
  const size = useThree((s) => s.size);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color(color) },
          uInner: { value: new Color(inner ?? color) },
          uAlpha: { value: 0 },
          uCenter: { value: center },
          uCy: { value: cy },
          uTime: { value: 0 },
          uAspect: { value: 1 },
        },
        vertexShader: VEIL_VERT,
        fragmentShader: VEIL_FRAG,
        transparent: true,
        // Depth-tested at the far plane: opaque UI (stones, items) draws
        // before any transparent, so an untested veil would paint over it.
        // At depth ≈ 1 it only covers the empty canvas — the world beneath.
        depthTest: true,
        depthWrite: false,
      }),
    [color, inner, center, cy],
  );
  useEffect(() => () => material.dispose(), [material]);
  const mesh = useMemo(() => {
    const m = new Mesh((veilQuad ??= new PlaneGeometry(1, 1)), material);
    m.frustumCulled = false;
    m.renderOrder = -100;
    return m;
  }, [material]);
  useFrame((_, dt) => {
    const u = material.uniforms;
    u.uTime!.value = uiNow();
    u.uAspect!.value = size.width / Math.max(1, size.height);
    const target = show ? strength : 0;
    // Gathers slowly, lifts a little faster.
    const rate = show ? 2.2 : 3.2;
    u.uAlpha!.value += (target - u.uAlpha!.value) * (1 - Math.exp(-dt * rate));
    mesh.visible = u.uAlpha!.value > 0.003;
  });
  return <primitive object={mesh} />;
}
