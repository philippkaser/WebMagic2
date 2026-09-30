import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Mesh, PlaneGeometry, ShaderMaterial, Vector2 } from "three";
import { gameEvents } from "../../../core/events";
import { computeStats } from "../../../items/catalog";
import { useGame } from "../../../state/gameStore";
import { uiNow } from "../../clock";

/** Getting hurt, felt at the edge of sight: every blow strikes the air just
 * in front of your eye like glass — hairline cracks radiate from where it
 * landed on the rim of your vision — and blood splashes in from the edges,
 * then it all drains away. Near death the stain stays, beating faintly with
 * your pulse.
 *
 * The one piece drawn in clip space — a quad over the whole view, nearer
 * than anything else in the UI canvas — because it must cover every aspect
 * ratio and field of view exactly: it's the pane of your own eye. Each hit
 * lands somewhere new (seed + impact point), so a flurry reads as a flurry. */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uHurt;
uniform float uLow;
uniform float uBeat;
uniform float uSeed;
uniform float uAspect;
uniform vec2 uImpact;
uniform float uCrack;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1)) + uSeed * 1.7) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  // Screen-height units, origin at the centre.
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  // Nearness to the rim of sight: a superellipse, so the stain hugs the
  // edges but rounds into the corners instead of drawing a frame.
  vec2 e = abs(p) / vec2(0.5 * uAspect, 0.5);
  float s4 = pow(pow(e.x, 4.0) + pow(e.y, 4.0), 0.25);
  float reach = 0.09 + max(uHurt, uLow) * 0.11;
  float rim = smoothstep(1.0 - reach, 1.05, s4);

  // Blood creeping in from the rim: big clots and fine spatter, so its
  // inner edge is ragged, never a line.
  float n = fbm(p * 3.2 + vec2(uSeed * 0.37, uSeed * 0.11)) * 0.7 + fbm(p * 14.0 - uSeed) * 0.3;
  float amount = max(uHurt, uLow * (0.7 + uBeat * 0.3));
  float blood = smoothstep(0.42, 0.72, rim + (n - 0.5) * 1.1 - (1.0 - amount) * 0.75);
  // A red flush on the moment of the hit (and on each weak heartbeat).
  float flush = rim * rim * rim * (uHurt * 0.6 + uLow * uBeat * 0.4);

  // Struck glass: jagged spokes from the impact point plus a broken
  // concentric fracture, fading with distance.
  vec2 q = p - uImpact;
  float dist = length(q);
  float spokes = 11.0;
  // Jagged, not wavy: a high-frequency kink along each spoke.
  float wob = (noise(vec2(atan(q.y, q.x) * 5.0, dist * 45.0)) - 0.5) * 0.09;
  float ang = atan(q.y, q.x) + wob;
  float k = ang * spokes / 6.2832;
  float across = abs(fract(k) - 0.5) * 6.2832 / spokes * dist;
  float spoke = smoothstep(0.0028, 0.0, across) * step(0.35, hash(vec2(floor(k), 3.0)));
  float ringN = noise(vec2(ang * 6.0, 1.0));
  float rings = smoothstep(0.003, 0.0, abs(dist - 0.09 - ringN * 0.03)) * step(0.45, ringN);
  float spread = 0.1 + uCrack * 0.3;
  float crackMask = smoothstep(spread, spread * 0.3, dist) * uHurt;
  float line = min(1.0, spoke + rings) * crackMask;
  float shade = smoothstep(0.009, 0.0, across) * crackMask * 0.6;

  // Blood reads as blood over dark stone only if it's a saturated red:
  // a deep clot at the rim, brighter where it thins.
  vec3 bloodCol = mix(vec3(0.32, 0.01, 0.015), vec3(0.1, 0.0, 0.004), smoothstep(0.5, 1.0, rim));
  vec3 col = bloodCol * blood + vec3(0.3, 0.01, 0.01) * flush + vec3(1.0, 0.82, 0.78) * line * 0.8;
  float a = clamp(blood * 0.72 + flush * 0.25 + shade * 0.3 + line * 0.5, 0.0, 0.88);
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

export function HurtVignette() {
  const size = useThree((s) => s.size);
  const aspect = size.width / Math.max(1, size.height);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uHurt: { value: 0 },
          uLow: { value: 0 },
          uBeat: { value: 0 },
          uSeed: { value: 0 },
          uAspect: { value: 1 },
          uImpact: { value: new Vector2() },
          uCrack: { value: 0 },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );
  const mesh = useMemo(() => {
    const m = new Mesh(new PlaneGeometry(1, 1), material);
    m.frustumCulled = false;
    m.renderOrder = 1000;
    m.visible = false;
    return m;
  }, [material]);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      material.dispose();
    },
    [mesh, material],
  );
  const hurt = useRef(0);
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;
  const equipment = useGame((s) => s.equipment);
  const maxHealth = useMemo(() => computeStats(equipment).maxHealth, [equipment]);
  const maxRef = useRef(maxHealth);
  maxRef.current = maxHealth;

  useEffect(
    () =>
      gameEvents.on("playerHurt", ({ amount }) => {
        hurt.current = Math.min(1, hurt.current * 0.5 + 0.5 + amount / 45);
        const u = material.uniforms;
        u.uSeed!.value = Math.random() * 97;
        // The blow lands somewhere on the rim of sight; harder blows crack
        // further across the glass.
        const half = 0.5 * aspectRef.current;
        const a = Math.random() * Math.PI * 2;
        const dx = Math.cos(a) * half;
        const dy = Math.sin(a) * 0.5;
        const k = 0.97 / Math.max(Math.abs(dx) / half, Math.abs(dy) / 0.5);
        (u.uImpact!.value as Vector2).set(dx * k, dy * k);
        u.uCrack!.value = Math.min(1, amount / 35);
      }),
    [material],
  );

  useFrame((_, rawDt) => {
    // A frame hitch mustn't swallow the flash: decay at most a frame's worth.
    const dt = Math.min(rawDt, 1 / 20);
    hurt.current *= Math.exp(-dt * 1.6);
    if (hurt.current < 0.002) hurt.current = 0;
    const s = useGame.getState();
    const playing = s.phase === "dungeon" || s.phase === "village";
    const frac = s.health / Math.max(1, maxRef.current);
    // Below a third of your health the stain stays, deepening toward death.
    const low = playing && frac > 0 ? Math.max(0, Math.min(1, (0.34 - frac) / 0.24)) : 0;
    // Lub-dub, quickening as health drains.
    const period = 1.05 - low * 0.4;
    const ph = (uiNow() % period) / period;
    const beat = Math.exp(-(((ph - 0.08) / 0.06) ** 2)) + 0.6 * Math.exp(-(((ph - 0.3) / 0.06) ** 2));
    const u = material.uniforms;
    u.uHurt!.value = hurt.current;
    u.uLow!.value = low;
    u.uBeat!.value = beat;
    u.uAspect!.value = aspectRef.current;
    mesh.visible = hurt.current > 0 || low > 0;
  });

  return <primitive object={mesh} />;
}
