import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Color, CylinderGeometry, ShaderMaterial, TorusGeometry, type Group } from "three";
import { useEncounters } from "../../../encounters/encounterStore";
import { useGame } from "../../../state/gameStore";
import { palette } from "../../../ui/theme";
import { pxFor } from "../../anchors";
import { uiNow } from "../../clock";
import { metalMaterial, stoneMaterial } from "../../materials";
import { UiPresence } from "../../presence";
import { RuneText } from "../../text/RuneText";
import { heartbeat, heartRate, presenceMood } from "./copy";
import { devOverrides, subscribeDevOverrides } from "./devHooks";
import { glowQuad, makeGlowMaterial } from "./glow";
import { HudAnchor, hudUnit, Undistort } from "./HudAnchor";
import { HUD_LAYOUT } from "./layout";
import { Materialize } from "./Materialize";
import { useSteady } from "./useSettled";

/** The presence sense: a small stone medallion under the top edge of sight
 * with an eye cut into it. While you're alone on a floor it isn't there.
 * When another wizard walks your floor it rises, and the eye opens — wider
 * and redder, its pupil narrowing to a slit, the closer a HOSTILE one comes;
 * it beats with your heart, faster as they close in. It never says who,
 * where or how many — only how uneasy to be. A sworn ally is a calm green
 * glint, half-lidded. */

const L = HUD_LAYOUT.presence;
const U = hudUnit(L.distance);
const R = 0.024 * U;
const LINE_PX = pxFor(L.distance, 0.016);

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uOpen;
uniform float uThreat;
uniform float uPulse;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  // Almond: the lids are two arcs whose height is the openness.
  float lid = uOpen * 0.52 * pow(max(0.0, 1.0 - p.x * p.x), 0.85);
  float d = abs(p.y) - lid;
  float inside = smoothstep(0.03, -0.03, d) * step(abs(p.x), 1.0);
  float lash = smoothstep(0.07, 0.0, abs(d)) * smoothstep(1.0, 0.8, abs(p.x));
  // Iris, glowing, with a slit pupil that narrows with the threat.
  float r = length(p * vec2(1.0, 1.1));
  float iris = smoothstep(0.46, 0.38, r) * inside;
  float ring = smoothstep(0.05, 0.0, abs(r - 0.42)) * inside;
  float slit = mix(0.16, 0.035, uThreat);
  float pupil = smoothstep(slit + 0.03, slit, abs(p.x)) * smoothstep(0.42, 0.3, abs(p.y)) * inside;
  float veins = 0.85 + 0.15 * sin(atan(p.y, p.x) * 14.0 + uTime * 0.7);
  vec3 col = uColor * (lash * (1.1 + uPulse * 0.8) + iris * veins * (0.9 + uPulse * 0.9) + ring * 0.8);
  col *= 1.0 - pupil * 0.92;
  // The white of the eye: a faint pale glow inside the lids.
  col += vec3(0.55, 0.5, 0.48) * inside * (1.0 - iris) * 0.18;
  float a = max(max(lash, inside * 0.95), iris);
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

let geo: { disc: CylinderGeometry; rim: TorusGeometry } | null = null;

export function PresenceEye() {
  const phase = useGame((s) => s.phase);
  const others = useEncounters((s) => s.others);
  const nearestHostile = useEncounters((s) => s.nearestHostile);
  const dev = useSyncExternalStore(subscribeDevOverrides, () => devOverrides.presence);
  const mood = presenceMood(dev?.others ?? others, dev ? dev.nearestHostile : nearestHostile);
  const shown = phase === "dungeon" && mood.open > 0;
  const line = useSteady(mood.line);
  const lastLine = useRef(line);
  if (line) lastLine.current = line;

  return (
    <UiPresence show={shown} exit={0.9}>
      <HudAnchor h={L.h} v={L.v} inset={L.inset} distance={L.distance}>
        <Medallion open={mood.open} threat={mood.threat} color={mood.color} />
        <RuneText text={lastLine.current} px={LINE_PX} color={palette.dim} position={[0, -R * 1.75, 0]} glow={0.5} outline={0.5} delay={0.6} />
      </HudAnchor>
    </UiPresence>
  );
}

function Medallion({ open, threat, color }: { open: number; threat: number; color: string }) {
  geo ??= { disc: new CylinderGeometry(1, 1, 0.22, 28), rim: new TorusGeometry(1, 0.06, 6, 36) };
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uOpen: { value: 0 },
          uThreat: { value: 0 },
          uPulse: { value: 0 },
          uTime: { value: 0 },
          uColor: { value: new Color(color) },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
      }),
    // The colour is eased below, not rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const halo = useMemo(() => makeGlowMaterial(color, 0.3), [color]);
  useEffect(
    () => () => {
      material.dispose();
      halo.dispose();
    },
    [material, halo],
  );
  const target = useRef({ open, threat, color: new Color(color) });
  target.current.open = open;
  target.current.threat = threat;
  target.current.color.set(color);
  const eased = useRef({ open: 0, threat: threat });
  const beat = useRef<Group>(null);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const t = target.current;
    const e = eased.current;
    const k = 1 - Math.exp(-dt * 2.5);
    // The eye opens slowly, as if waking; it blinks now and then.
    e.open += (t.open - e.open) * k;
    e.threat += (t.threat - e.threat) * k;
    const now = uiNow();
    const blinkPhase = (now % 5.3) / 5.3;
    const blink = blinkPhase > 0.97 ? Math.sin(((blinkPhase - 0.97) / 0.03) * Math.PI) : 0;
    const pulse = heartbeat(now, heartRate(e.threat));
    const u = material.uniforms;
    u.uOpen!.value = e.open * (1 - blink * 0.9);
    u.uThreat!.value = e.threat;
    u.uPulse!.value = pulse;
    u.uTime!.value = now;
    (u.uColor!.value as Color).lerp(t.color, k);
    halo.uniforms.uIntensity.value = 0.2 + e.open * 0.3 + pulse * (0.2 + e.threat * 0.5);
    const b = beat.current;
    if (b) b.scale.setScalar(1 + pulse * (0.03 + e.threat * 0.05));
  });

  return (
    <Undistort>
      <Materialize color={color} size={R * 1.6} from={[0, R * 1.5, -R * 5]} spin={1}>
        <group ref={beat}>
          <mesh geometry={glowQuad()} material={halo} position={[0, 0, -R * 0.4]} scale={R * 4.2} renderOrder={2} />
          <mesh geometry={geo.disc} material={stoneMaterial("#3e3947")} rotation={[Math.PI / 2, 0, 0]} scale={R} />
          <mesh geometry={geo.rim} material={metalMaterial("#8a7040")} position={[0, 0, R * 0.1]} scale={R} />
          <mesh geometry={glowQuad()} material={material} position={[0, 0, R * 0.13]} scale={[R * 1.75, R * 1.75, 1]} renderOrder={8} />
        </group>
      </Materialize>
    </Undistort>
  );
}
