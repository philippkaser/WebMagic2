import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Mesh, PlaneGeometry, ShaderMaterial, Vector2 } from "three";
import { gameEvents } from "../../../core/events";
import { computeStats } from "../../../items/catalog";
import { useGame } from "../../../state/gameStore";
import { uiNow } from "../../clock";

/** Getting hurt, felt at the edge of sight (artpass hud/Vignettes): every
 * blow bites a red rim in from the edges of the view — ragged, heaviest
 * where it landed — that drains away in hard steps; near death a darker
 * stain stays, throbbing with your pulse.
 *
 * Drawn the grimoire way: in coarse square blocks (about the world's own
 * pixel size) and a handful of flat alpha bands, never a smooth gradient.
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
uniform vec2 uRes;
uniform vec2 uImpact;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1)) + uSeed * 1.7) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  // Snap to blocks ~1/180 of the screen tall: the vignette is pixel art too.
  float block = max(2.0, floor(uRes.y / 180.0));
  vec2 cell = floor(vUv * uRes / block);
  vec2 uv = (cell + 0.5) * block / uRes;
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  // Nearness to the rim of sight: a superellipse, hugging the edges and
  // rounding into the corners.
  vec2 e = abs(p) / vec2(0.5 * uAspect, 0.5);
  float s4 = pow(pow(e.x, 4.0) + pow(e.y, 4.0), 0.25);
  // A blow bites deeper where it landed.
  float near = exp(-pow(length(p - uImpact) / 0.32, 2.0));
  float n = noise(cell * 0.22 + uSeed) * 0.6 + noise(cell * 0.07 - uSeed) * 0.4;
  float hurtReach = uHurt * (0.13 + near * 0.12);
  float lowReach = uLow * (0.15 + uBeat * 0.05);
  float edgeIn = 1.0 - s4;
  float hurt = clamp(1.0 - (edgeIn - (n - 0.5) * 0.08) / max(0.001, hurtReach), 0.0, 1.0) * step(0.001, uHurt);
  float low = clamp(1.0 - (edgeIn - (n - 0.5) * 0.06) / max(0.001, lowReach), 0.0, 1.0) * step(0.001, uLow);
  // Flat bands, as a pixel artist would shade it.
  hurt = floor(hurt * 4.0 + 0.5) / 4.0;
  low = floor(low * 4.0 + 0.5) / 4.0;
  // artpass: rgba(190,22,22,0.55) for a blow, rgba(120,0,0,0.6) near death.
  float aH = hurt * 0.6;
  float aL = low * 0.62;
  float a = max(aH, aL);
  if (a < 0.01) discard;
  vec3 col = aH >= aL ? vec3(0.745, 0.086, 0.086) : vec3(0.47, 0.0, 0.0);
  gl_FragColor = vec4(col * a, a);
  #include <colorspace_fragment>
}
`;

export function HurtVignette() {
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const aspect = size.width / Math.max(1, size.height);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uHurt: { value: 0 },
          uLow: { value: 0 },
          uBeat: { value: 0 },
          uSeed: { value: 0 },
          uAspect: { value: 1 },
          uRes: { value: new Vector2(1, 1) },
          uImpact: { value: new Vector2() },
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
    // Stepped like artpass's steps(6) fade: the bite drains in hard steps.
    u.uHurt!.value = Math.ceil(hurt.current * 6) / 6;
    u.uLow!.value = low;
    u.uBeat!.value = Math.round(beat * 3) / 3;
    (u.uRes!.value as Vector2).set(sizeRef.current.width * gl.getPixelRatio(), sizeRef.current.height * gl.getPixelRatio());
    u.uAspect!.value = aspectRef.current;
    mesh.visible = hurt.current > 0 || low > 0;
  });

  return <primitive object={mesh} />;
}
