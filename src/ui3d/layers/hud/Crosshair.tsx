import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, ShaderMaterial, type Mesh } from "three";
import { newMarks } from "../../../combat/confirm";
import { hitMarks } from "../../../combat/shooter";
import { gameEvents } from "../../../core/events";
import { ViewAnchor } from "../../anchors";
import { ink } from "../../theme";
import { KillCallout } from "../combat/KillCallout";
import { apx } from "./ap";
import { useStepFade } from "./fade";
import { unitQuad } from "./PixelSprite";

/** The aim (artpass hud/Crosshair): a 2 px bone-white dot and four short
 * arms with a hard ink shadow, every pixel square. Spells fly along the
 * camera ray, so its centre is exactly where they go. Every cast (the
 * staff's kick) snaps the arms outward a few whole pixels and lights them
 * arcane, and they step back in.
 *
 * It answers your hits (combat/shooter): four diagonal ticks flare round
 * the dot and step outward as they fade — gold for a weak point, longer for
 * a heavy shot — and a killing blow burns a red pixel X that holds a beat
 * and steps away (gold for a precision kill). A spell that sputters for
 * want of mana flickers the arms blood-dim. A streak's rune word burns
 * itself in beneath (KillCallout).
 *
 * Rigidly carried (no lag): an aim that trails the view would lie. */

const D = 1;
const A = apx(D);
/** The pixel grid: 32 × 32 artpass pixels centred on a pixel corner. */
const N = 32;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uSpread;
uniform float uShow;
uniform float uHot;
uniform float uTick;
uniform float uTickR;
uniform float uTickLen;
uniform float uKill;
uniform float uCrit;
uniform float uFizz;
uniform vec3 uBone;
uniform vec3 uArc;
uniform vec3 uGold;
uniform vec3 uRed;
varying vec2 vUv;

// Arm pixels: four 5×2 bars starting 4 px (+ spread) from the centre.
bool arm(vec2 p) {
  bool midY = p.y >= -1.0 && p.y <= 0.0;
  bool midX = p.x >= -1.0 && p.x <= 0.0;
  float a = 4.0 + uSpread;
  float b = a + 4.0;
  bool h = midY && ((p.x >= a && p.x <= b) || (p.x <= -a - 1.0 && p.x >= -b - 1.0));
  bool v = midX && ((p.y >= a && p.y <= b) || (p.y <= -a - 1.0 && p.y >= -b - 1.0));
  return h || v;
}
bool dot_(vec2 p) {
  return p.x >= -1.0 && p.x <= 0.0 && p.y >= -1.0 && p.y <= 0.0;
}
// The four diagonals, folded into one quadrant: the grid is centred on a
// pixel corner, so pixel -1 mirrors pixel 0.
vec2 fold(vec2 p) {
  return vec2(p.x >= 0.0 ? p.x : -1.0 - p.x, p.y >= 0.0 ? p.y : -1.0 - p.y);
}
// A two-pixel-thick diagonal from a to b (whole pixels).
bool diag(vec2 q, float a, float b) {
  return abs(q.x - q.y) <= 1.0 && min(q.x, q.y) >= a && max(q.x, q.y) <= b;
}
// Hit ticks: 2×2 blocks (heavier shots: a longer stroke) out on the
// diagonals.
bool tick(vec2 p) {
  return uTick > 0.0 && diag(fold(p), uTickR, uTickR + uTickLen);
}
// The kill X: the diagonals from 2 px out, shrinking a step at a time as it
// goes.
bool killX(vec2 p) {
  return uKill > 0.0 && diag(fold(p), 2.0, 2.0 + floor(4.0 * uKill + 0.5));
}

void main() {
  vec2 p = floor(vUv * ${N}.0) - ${N / 2}.0;
  vec3 col;
  float a;
  vec3 armCol = mix(mix(uBone, uArc, uHot), uRed * 0.7, uFizz);
  vec3 markCol = mix(uBone, uGold, uCrit);
  vec3 killCol = mix(uRed, uGold, uCrit);
  vec2 sh = p + vec2(-1.0, 1.0);
  if (dot_(p)) { col = uBone; a = 1.0; }
  else if (killX(p)) { col = killCol; a = 0.96 * (0.45 + 0.55 * uKill); }
  else if (tick(p)) { col = markCol; a = 0.95; }
  else if (arm(p)) { col = armCol; a = 0.88 * (1.0 - 0.5 * uFizz); }
  // The dot's ink ring, and everything's hard 1 px shadow (down-right).
  else if (abs(p.x + 0.5) <= 1.5 && abs(p.y + 0.5) <= 1.5) { col = vec3(0.0); a = 0.7; }
  else if (arm(sh) || tick(sh) || killX(sh)) { col = vec3(0.0); a = 0.7; }
  else discard;
  gl_FragColor = vec4(col * a * uShow, a * uShow);
  #include <colorspace_fragment>
}
`;

export function Crosshair() {
  const mesh = useRef<Mesh>(null);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uSpread: { value: 0 },
          uShow: { value: 0 },
          uHot: { value: 0 },
          uTick: { value: 0 },
          uTickR: { value: 6 },
          uTickLen: { value: 1 },
          uKill: { value: 0 },
          uCrit: { value: 0 },
          uFizz: { value: 0 },
          uBone: { value: new Color("#f4ecd8") },
          uArc: { value: new Color(ink.arcane) },
          uGold: { value: new Color(ink.gold) },
          uRed: { value: new Color("#ff3b2e") },
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
  useEffect(() => () => material.dispose(), [material]);
  const fade = useStepFade({ inTime: 0.3, outTime: 0.2, steps: 3 });
  const kick = useRef(0);
  const fizz = useRef(0);
  const marks = useMemo(newMarks, []);

  useEffect(() => {
    const offs = [
      gameEvents.on("staffKick", (v) => {
        kick.current = Math.min(1, Math.max(kick.current, v));
      }),
      gameEvents.on("fizzle", () => {
        fizz.current = 1;
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  useFrame((_, rawDt) => {
    // Clamped so a hitch doesn't swallow the cast's pulse.
    const dt = Math.min(rawDt, 1 / 20);
    kick.current *= Math.exp(-dt * 7);
    fizz.current = Math.max(0, fizz.current - dt * 4);
    const u = material.uniforms;
    // Whole pixels only: the arms jump out and step back in.
    u.uSpread!.value = Math.round(kick.current * 3);
    u.uHot!.value = kick.current > 0.25 ? 1 : 0;
    // A sputter flickers: on, off, on, in hard frames.
    u.uFizz!.value = fizz.current > 0 && Math.floor(fizz.current * 6) % 2 === 0 ? 1 : 0;
    hitMarks(marks);
    u.uTick!.value = marks.tick > 0 ? 1 : 0;
    u.uTickR!.value = 6 + marks.spread;
    u.uTickLen!.value = marks.heavy ? 2 : 1;
    u.uKill!.value = marks.kill;
    u.uCrit!.value = marks.crit ? 1 : 0;
    u.uShow!.value = fade.current;
    if (mesh.current) mesh.current.visible = fade.current > 0;
  });

  return (
    <ViewAnchor offset={[0, 0, -D]} follow={Infinity}>
      <mesh ref={mesh} geometry={unitQuad()} material={material} scale={[N * A, N * A, 1]} renderOrder={60} />
      <KillCallout distance={D} />
    </ViewAnchor>
  );
}
