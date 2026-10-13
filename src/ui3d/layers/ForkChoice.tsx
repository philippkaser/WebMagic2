import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Color, Group, PlaneGeometry, ShaderMaterial, Vector3 } from "three";
import { playUiHover } from "../../audio/uiSounds";
import { input } from "../../player/input";
import { PIXEL_NOISE_GLSL } from "../../transition/vortexGlsl";
import { chooseFork, faceFork, useFork, type ForkWay } from "../../transition/fork";
import { pxFor } from "../anchors";
import { uiNow } from "../clock";
import { UiPresence } from "../presence";
import { RuneText } from "../text/RuneText";
import { capFraction, STEP } from "../text/type";
import { ink } from "../theme";

/** The fork in the rift — two tears opening in the void ahead while the
 * journey hangs in its tunnel (transition/fork.ts): the way down in cyan on
 * the right, the way home in gold on the left. They stand where they
 * opened, so you choose by turning toward one (it burns brighter, its words
 * light up); click, E or Space takes it, A/D or the arrows turn to it. A
 * sealed way home is there all the same — a thin, cracked, dim slit — so
 * the Tithe of Five is shown, not told. If you do nothing, the way you face
 * takes you when the rift tires of waiting.
 *
 * The tears are drawn with the rifts' own silhouette (vortexGlsl tearSd) in
 * chunky pixels, a starry void inside streaming toward their hearts. */

const DIST = 2.4;
const SPREAD = 1.05;
const TEAR_W = 1.15;
const TEAR_H = 2.1;
const TITLE_PX = pxFor(DIST, capFraction(2, "heading"));
const LINE_PX = pxFor(DIST, capFraction(STEP.lead));
const HOME = new Color("#ffd44f");
const DEEPER = new Color("#46ffd0");
const SEALED = new Color("#8a7a6a");

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
${PIXEL_NOISE_GLSL}
uniform float uTime;
uniform float uSeed;
uniform float uOpen;
uniform float uHot;
uniform float uSealed;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  // The tear's own metres (half-height 1.9), on a chunky pixel grid.
  vec2 m = pix((vUv - 0.5) * vec2(2.4, 4.2), 15.0);
  float spine;
  float width = mix(0.22, 1.0, uOpen * (1.0 - uSealed));
  float sd = tearSd(m, uTime, uSeed, width, spine);
  if (sd > 0.16) discard;
  vec3 hot = mix(uColor, vec3(1.0), 0.65);
  vec3 col;
  float a = 1.0;
  if (sd > 0.0) {
    // The burning rim, frayed and flickering in hard steps.
    float flick = step(0.45, hash21(floor(m * 15.0) + floor(uTime * 9.0)));
    float k = 1.0 - sd / 0.16;
    if (k < 0.5 && flick < 0.5) discard;
    col = mix(uColor, hot, step(0.75, k)) * (1.2 + uHot * 1.6);
  } else {
    // Inside: a dark void with blocky stars streaming toward its heart.
    vec2 q = m - vec2(spine, 0.0);
    float r = length(q * vec2(1.6, 0.6));
    float ang = atan(q.y, q.x);
    float flow = fract(r * 1.4 - uTime * (0.5 + uHot * 0.6));
    float star = step(0.93, hash21(floor(vec2(ang * 5.0, r * 9.0 - uTime * 4.0) + uSeed)));
    col = mix(vec3(0.02, 0.01, 0.05), uColor * 0.35, smoothstep(0.0, 1.2, -sd * 6.0) * 0.6);
    col += uColor * star * (0.8 + uHot) * (1.0 - flow * 0.5);
    col += hot * step(-0.05, sd) * 0.6;
    // A sealed way home: cracked glass glints across the slit.
    if (uSealed > 0.5) {
      float crack = step(0.97, hash21(floor(m * vec2(30.0, 7.0))));
      col = mix(col * 0.4, vec3(0.9), crack * 0.5);
    }
  }
  gl_FragColor = vec4(col, a);
}
`;

function tearMaterial(color: Color, seed: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: seed },
      uOpen: { value: 0 },
      uHot: { value: 0 },
      uSealed: { value: 0 },
      uColor: { value: color.clone() },
    },
    transparent: false,
    toneMapped: false,
  });
}

let planeGeo: PlaneGeometry | null = null;

export function ForkChoice() {
  const open = useFork((s) => s.open);
  return (
    <UiPresence show={open} exit={0.5}>
      <Fork />
    </UiPresence>
  );
}

function Fork() {
  const camera = useThree((s) => s.camera);
  const fork = useFork();
  const root = useRef<Group>(null);
  const [placed] = useState(() => {
    // Where the fork opened: it stays there, so you turn to choose.
    const fwd = new Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const centre = camera.position.clone().addScaledVector(fwd, DIST);
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    return { centre, yaw };
  });
  const home = useMemo(() => tearMaterial(fork.homeOpen ? HOME : SEALED, 3.1), [fork.homeOpen]);
  const deeper = useMemo(() => tearMaterial(DEEPER, 7.7), []);
  useEffect(
    () => () => {
      home.dispose();
      deeper.dispose();
    },
    [home, deeper],
  );
  planeGeo ??= new PlaneGeometry(1, 1);
  const opened = useRef(uiNow());
  const lastFacing = useRef<ForkWay>(fork.facing);
  const [countdown, setCountdown] = useState(0);
  const wasDown = useRef(input.mouseLeft);
  const tmp = useMemo(() => ({ fwd: new Vector3(), to: new Vector3() }), []);

  useFrame(() => {
    const t = uiNow();
    const s = useFork.getState();
    const k = Math.min(1, (t - opened.current) / 0.7);
    for (const [mat, way] of [
      [home, "home"],
      [deeper, "deeper"],
    ] as const) {
      const u = mat.uniforms;
      u.uTime!.value = t;
      u.uOpen!.value = Math.round(k * 6) / 6;
      u.uSealed!.value = way === "home" && !s.homeOpen ? 1 : way === "deeper" && !s.deeperOpen ? 1 : 0;
      const target = s.facing === way ? 1 : 0;
      u.uHot!.value += (target - u.uHot!.value) * 0.15;
    }
    // Which tear the wizard faces: the one nearer the middle of the view.
    const g = root.current;
    if (g) {
      camera.getWorldDirection(tmp.fwd);
      let best: ForkWay = s.facing;
      let bestDot = -2;
      for (const [way, side] of [
        ["home", -1],
        ["deeper", 1],
      ] as const) {
        tmp.to.set(side * SPREAD, 0, 0).applyQuaternion(g.quaternion).add(g.position).sub(camera.position).normalize();
        const d = tmp.to.dot(tmp.fwd);
        if (d > bestDot) {
          bestDot = d;
          best = way;
        }
      }
      faceFork(best);
    }
    if (input.consume("KeyA") || input.consume("ArrowLeft")) faceFork("home");
    if (input.consume("KeyD") || input.consume("ArrowRight")) faceFork("deeper");
    const facing = useFork.getState().facing;
    if (facing !== lastFacing.current) {
      lastFacing.current = facing;
      playUiHover();
    }
    // Take it: a click, E or Space.
    const down = input.mouseLeft;
    const clicked = down && !wasDown.current;
    wasDown.current = down;
    if (k >= 1 && (clicked || input.consume("KeyE") || input.consume("Space"))) chooseFork(facing);
    const left = Math.max(0, Math.ceil((s.deadline - performance.now()) / 1000));
    if (left !== countdown) setCountdown(left);
  });

  const homeWords = fork.homeOpen
    ? { title: "Home", line: "everything you carry becomes safe", color: ink.gold }
    : { title: "Sealed", line: `the deep wants ${fork.owed} more floor${fork.owed === 1 ? "" : "s"}`, color: ink.faded };
  const deeperWords = fork.deeperOpen
    ? { title: "Deeper", line: `floor ${fork.nextFloor}`, color: ink.arcane }
    : { title: "The Bottom", line: "there is no floor below", color: ink.faded };
  const chosen = fork.facing;

  return (
    <group ref={root} position={placed.centre} rotation={[0, placed.yaw, 0]}>
      <group position={[0, camera.position.y - placed.centre.y + 0.05, 0]}>
        <mesh geometry={planeGeo} material={home} position={[-SPREAD, 0.1, 0]} scale={[TEAR_W, TEAR_H, 1]} />
        <mesh geometry={planeGeo} material={deeper} position={[SPREAD, 0.1, 0]} scale={[TEAR_W, TEAR_H, 1]} />
        {(
          [
            [-SPREAD, homeWords, "home"],
            [SPREAD, deeperWords, "deeper"],
          ] as const
        ).map(([x, w, way]) => (
          <group key={way} position={[x, -1.2, 0.02]}>
            <RuneText text={w.title} font="heading" px={TITLE_PX} color={w.color} glow={chosen === way ? 1.2 : 0.3} position={[0, 0.06, 0]} />
            <RuneText text={w.line} px={LINE_PX} color={chosen === way ? ink.parchment : ink.faded} glow={0.3} position={[0, -0.1, 0]} delay={0.15} />
          </group>
        ))}
        {fork.homeOpen && fork.deeperOpen && (
          <>
            <RuneText
              text={[
                { text: "turn to a way · ", color: ink.faded },
                { text: "click", color: ink.parchment },
                { text: " to take it", color: ink.faded },
              ]}
              font="label"
              px={LINE_PX}
              position={[0, -1.62, 0.02]}
              delay={0.3}
            />
            {/* Its own line, so each tick rewrites one number, not the hint. */}
            <RuneText text={`${countdown}`} font="label" px={LINE_PX} color={ink.arcane} position={[0, -1.8, 0.02]} inDuration={0.15} stagger={0} />
          </>
        )}
      </group>
    </group>
  );
}
