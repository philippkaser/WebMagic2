import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Mesh, ShaderMaterial, Vector3 } from "three";
import { gameEvents } from "../../../core/events";
import { pxFor } from "../../anchors";
import { uiNow } from "../../clock";
import { UiPresence, useUiShow } from "../../presence";
import { Tablet, TABLET_EXIT } from "../../Tablet";
import { RuneText } from "../../text/RuneText";
import { emitUiSparks } from "../../UiSparks";
import { HUD_COLORS } from "./copy";
import { makeGauge, resetGauge, stepGauge } from "./gauge";
import { glowQuad } from "./glow";
import { HudAnchor, hudUnit } from "./HudAnchor";
import { HUD_LAYOUT } from "./layout";

/** A boss's life, as a long bar of dark stone that builds itself across the
 * top of your sight when the boss wakes: its channel is full of fire, and
 * the fire burns down as the boss is hurt — what a blow took flares
 * white-hot and gutters out a moment later, shedding embers. The name is
 * burned into the air above. When the boss dies (bossHp → null) the stones
 * break loose and fall.
 *
 * Driven only by the `bossHp` event, so it works the same whether we
 * simulate the boss or replicate it. */

const L = HUD_LAYOUT.boss;
const U = hudUnit(L.distance);
const W = 0.56 * U;
const H = 0.03 * U;
/** The fire channel inside the tablet's rim. */
const FW = W - H * 0.55;
const FH = H * 0.46;
const NAME_PX = pxFor(L.distance, 0.021);

export function BossBar() {
  const [name, setName] = useState<string | null>(null);
  const frac = useRef(1);
  const lastName = useRef("");
  useEffect(
    () =>
      gameEvents.on("bossHp", (b) => {
        if (b) {
          frac.current = Math.max(0, Math.min(1, b.frac));
          setName(b.name);
        } else setName(null);
      }),
    [],
  );
  if (name) lastName.current = name;

  return (
    <UiPresence show={!!name} exit={TABLET_EXIT}>
      <HudAnchor h={L.h} v={L.v} inset={L.inset} distance={L.distance}>
        <RuneText text={lastName.current} px={NAME_PX} color={HUD_COLORS.boss} position={[0, H * 0.5 + NAME_PX * 7, 0]} glow={1.4} outline={0.6} delay={0.45} />
        <Tablet width={W} height={H} thickness={H * 0.7} tile={H * 1.15} tint="#3b2c2e" accent="#ff5136" float={false} quiet seed={7}>
          <Fire frac={frac} />
        </Tablet>
      </HudAnchor>
    </UiPresence>
  );
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uFrac;
uniform float uGhost;
uniform float uTime;
uniform float uShow;
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
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; }
  return v;
}
void main() {
  float x = vUv.x;
  // Channel space with square cells, so the flames aren't stretched.
  vec2 c = vec2(x * uAspect, vUv.y);
  // The fill reveals itself left to right as the bar kindles.
  float lit = step(x, uFrac * uShow);
  float ghost = step(x, uGhost * uShow) * (1.0 - lit);
  // Flames licking upward and drifting right to left.
  float f = fbm(vec2(c.x * 3.0 + uTime * 0.6, c.y * 2.2 - uTime * 2.4));
  float tongues = smoothstep(0.25, 0.95, f + (1.0 - vUv.y) * 0.45);
  vec3 deep = vec3(0.32, 0.02, 0.01);
  vec3 mid = vec3(1.0, 0.22, 0.05);
  vec3 hot = vec3(1.0, 0.78, 0.38);
  vec3 fire = mix(deep, mid, tongues);
  fire = mix(fire, hot, smoothstep(0.75, 1.0, tongues) * 0.7);
  // The burning edge: white-hot, flickering.
  float edge = exp(-abs(x - uFrac) * uAspect * 9.0) * step(0.001, uFrac) * (0.8 + 0.2 * sin(uTime * 23.0));
  fire += hot * edge * 1.4 * lit;
  // What a blow just took: pale fire, crumbling away.
  float crumble = step(0.35 + 0.5 * hash(floor(c * vec2(10.0, 4.0)) + floor(uTime * 16.0)), 0.85);
  vec3 ghostCol = mix(hot, vec3(1.0), 0.3) * (0.7 + 0.3 * f) * crumble;
  // The empty channel: charred, faintly glowing embers.
  vec3 ash = vec3(0.05, 0.012, 0.01) + vec3(0.25, 0.04, 0.01) * smoothstep(0.62, 0.9, noise(c * 9.0 + uTime * 0.3)) * 0.6;
  vec3 col = fire * lit + ghostCol * ghost + ash * (1.0 - lit - ghost);
  float a = (lit + ghost * crumble + (1.0 - lit - ghost) * 0.85) * uShow;
  gl_FragColor = vec4(col * uShow, a);
  #include <colorspace_fragment>
}
`;

const tmp = new Vector3();

/** The fire in the channel, on the tablet's face (it only shows once the
 * tablet has assembled — Tablet's content visibility). */
function Fire({ frac }: { frac: { current: number } }) {
  const show = useUiShow();
  const mesh = useRef<Mesh>(null);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uFrac: { value: 1 },
          uGhost: { value: 1 },
          uTime: { value: 0 },
          uShow: { value: 0 },
          uAspect: { value: FW / FH },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const gauge = useRef(makeGauge(frac.current));
  const state = useRef({ shown: 0, last: frac.current, embers: 0 });

  useEffect(() => {
    if (show) resetGauge(gauge.current, frac.current);
  }, [show, frac]);

  useFrame((_, dt) => {
    const s = state.current;
    const u = material.uniforms;
    s.shown += ((show ? 1 : 0) - s.shown) * (1 - Math.exp(-dt * (show ? 2.2 : 9)));
    stepGauge(gauge.current, frac.current, dt);
    u.uTime!.value = uiNow();
    u.uFrac!.value = gauge.current.level;
    u.uGhost!.value = gauge.current.ghost;
    u.uShow!.value = s.shown;
    // A blow sheds embers from the burning edge.
    if (frac.current < s.last - 0.001) s.embers = 0.35;
    s.last = frac.current;
    const m = mesh.current;
    if (s.embers > 0 && m) {
      s.embers -= dt;
      tmp.set(-FW / 2 + FW * gauge.current.level, 0, 0.004);
      m.localToWorld(tmp.divide(m.scale));
      emitUiSparks({ position: [tmp.x, tmp.y, tmp.z], color: "#ff8a3a", count: 3, speed: 0.12, up: 0.18, size: 0.012, spread: FH, ttl: 0.9 });
    }
  });

  return <mesh ref={mesh} geometry={glowQuad()} material={material} scale={[FW, FH, 1]} position={[0, 0, 0.004]} renderOrder={6} />;
}
