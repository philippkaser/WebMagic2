import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Color, ShaderMaterial, type Group } from "three";
import { useEncounters } from "../../../encounters/encounterStore";
import { useGame } from "../../../state/gameStore";
import { uiNow } from "../../clock";
import { UiPresence } from "../../presence";
import { RuneText } from "../../text/RuneText";
import { ink, shade } from "../../theme";
import { apx, fontPx } from "./ap";
import { heartbeat, heartRate, presenceMood } from "./copy";
import { devOverrides, subscribeDevOverrides } from "./devHooks";
import { useStepFade } from "./fade";
import { glowQuad, makeGlowMaterial } from "./glow";
import { HudAnchor } from "./HudAnchor";
import { HUD_LAYOUT } from "./layout";
import { unitQuad } from "./PixelSprite";
import { useSteady } from "./useSettled";

/** The presence sense (artpass hud/Presence): a pixel eye under the top
 * edge of sight. While you're alone on a floor it sleeps — a brass lid with
 * hanging lashes. When another wizard walks your floor it wakes: it opens,
 * violet for a stranger far off, redder and wider the closer a HOSTILE one
 * comes, its slit pupil narrowing; it beats with your heart, faster as they
 * close in, and whispers one line under it. It never says who, where or
 * how many — only how uneasy to be. A sworn ally is a calm green eye. */

const L = HUD_LAYOUT.presence;
const A = apx(L.distance);
/** Sprite pixels (artpass eyeSprite) drawn at 3× (63 × 39 ap px). */
const EW = 21;
const EH = 13;
const LINE_PX = fontPx(12, "body", L.distance);

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** artpass's eyeSprite, evaluated per sprite pixel so the lids can move:
 * an almond whose half-height is the openness, iris rings in the tint, a
 * slit pupil, a brass rim — or, shut, a sleeping lid with lashes. */
const FRAG = /* glsl */ `
uniform float uOpen;
uniform float uSlit;
uniform float uShow;
uniform vec3 uTint;
uniform vec3 uLight;
uniform vec3 uDark;
uniform vec3 uRim;
varying vec2 vUv;

float lidY(float x) {
  float dx = (x - 10.0) / 9.5;
  return 5.0 + floor(2.4 * (1.0 - dx * dx) + 0.5);
}

void main() {
  vec2 g = floor(vUv * vec2(${EW}.0, ${EH}.0));
  float x = g.x;
  float y = ${EH - 1}.0 - g.y; // rows from the top, as the canvas painted them
  vec3 col = vec3(0.0);
  float a = 0.0;
  if (uOpen > 0.04) {
    float lid = 5.6 * uOpen;
    float dx = (x - 10.0) / 10.2;
    float half_ = lid * (1.0 - dx * dx);
    float dy = y - 6.0;
    bool inside = abs(dy) <= half_ && abs(dx) <= 1.0;
    bool edge = abs(dy) <= half_ + 1.0 && abs(dx) <= 1.05;
    if (inside) {
      float r = length(vec2(x - 10.0, dy * 1.1));
      a = 1.0;
      if (abs(x - 10.0) <= uSlit && abs(dy) <= 3.0) col = vec3(0.027, 0.024, 0.04);
      else if (r < 3.2) col = uLight;
      else if (r < 4.4) col = uTint;
      else col = uDark;
    } else if (edge) {
      col = uRim;
      a = 1.0;
    }
  } else if (x >= 1.0 && x <= 19.0) {
    // Asleep: the lid's curve, inked above and below, lashes hanging.
    float ly = lidY(x);
    if (y == ly) { col = uTint; a = 1.0; }
    else if (y == ly - 1.0 || y == ly + 1.0) { col = vec3(0.027, 0.024, 0.04); a = 1.0; }
    else if (mod(x, 3.0) == 1.0 && x > 2.0 && x < 18.0 && y == ly + 2.0) { col = uTint; a = 1.0; }
    else {
      for (int k = -1; k <= 1; k++) {
        float xl = x - float(k);
        float s = xl < 10.0 ? -1.0 : xl > 10.0 ? 1.0 : 0.0;
        if (s == float(k) && mod(xl, 3.0) == 1.0 && xl > 2.0 && xl < 18.0 && y == lidY(xl) + 3.0) { col = uDark; a = 1.0; }
      }
    }
  }
  if (a < 0.5) discard;
  gl_FragColor = vec4(col * uShow, uShow);
  #include <colorspace_fragment>
}
`;

export function PresenceEye() {
  const phase = useGame((s) => s.phase);
  const others = useEncounters((s) => s.others);
  const nearestHostile = useEncounters((s) => s.nearestHostile);
  const dev = useSyncExternalStore(subscribeDevOverrides, () => devOverrides.presence);
  const mood = presenceMood(dev?.others ?? others, dev ? dev.nearestHostile : nearestHostile);
  const line = useSteady(mood.line);
  const lastLine = useRef(line);
  if (line) lastLine.current = line;

  return (
    <UiPresence show={phase === "dungeon"} exit={0.6}>
      <HudAnchor h={L.h} v={L.v} inset={L.inset} distance={L.distance}>
        <Eye open={mood.open} threat={mood.threat} color={mood.color} />
        <RuneText text={lastLine.current} show={!!line} font="body" px={LINE_PX} color={mood.color} position={[0, -(EH * 3 + 8) * A, 0]} glow={0.7} outline={0.6} delay={0.4} />
      </HudAnchor>
    </UiPresence>
  );
}

function Eye({ open, threat, color }: { open: number; threat: number; color: string }) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uOpen: { value: 0 },
          uSlit: { value: 0 },
          uShow: { value: 0 },
          uTint: { value: new Color(color) },
          uLight: { value: new Color(shade(color, 0.35)) },
          uDark: { value: new Color(shade(color, -0.72)) },
          uRim: { value: new Color(ink.brass) },
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
  const halo = useMemo(() => makeGlowMaterial(color, 0), [color]);
  useEffect(
    () => () => {
      material.dispose();
      halo.dispose();
    },
    [material, halo],
  );
  const target = useRef({ open, threat, color: new Color(color), light: new Color(), dark: new Color() });
  const t0 = target.current;
  t0.open = open;
  t0.threat = threat;
  t0.color.set(color);
  t0.light.set(shade(color, 0.35));
  t0.dark.set(shade(color, -0.72));
  const eased = useRef({ open: 0, threat });
  const beat = useRef<Group>(null);
  const fade = useStepFade({ delay: 0.1, inTime: 0.3, steps: 4 });

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const t = target.current;
    const e = eased.current;
    const k = 1 - Math.exp(-dt * 2.5);
    // It wakes slowly, lid by lid; it blinks now and then.
    e.open += (t.open - e.open) * k;
    e.threat += (t.threat - e.threat) * k;
    const now = uiNow();
    const blinkPhase = (now % 5.3) / 5.3;
    const blink = e.open > 0.05 && blinkPhase > 0.97 ? 1 : 0;
    // The lids move in whole sprite pixels: openness snaps to the rows.
    const lid = blink ? 0.2 : Math.round(e.open * 5.6) / 5.6;
    const awake = t.open > 0;
    // The heart, in five hard steps (artpass's steps(5) pulse).
    const pulse = awake ? Math.round(heartbeat(now, heartRate(e.threat)) * 5) / 5 : 0;
    const u = material.uniforms;
    u.uOpen!.value = lid;
    // The pupil narrows to a one-pixel slit as a hostile one closes in.
    u.uSlit!.value = e.threat > 0.5 ? 0 : 1;
    u.uShow!.value = fade.current * (awake ? 1 : 0.6);
    (u.uTint!.value as Color).lerp(t.color, k);
    (u.uLight!.value as Color).lerp(t.light, k);
    (u.uDark!.value as Color).lerp(t.dark, k);
    halo.uniforms.uIntensity.value = fade.current * pulse * (0.25 + e.threat * 0.45);
    const b = beat.current;
    if (b) b.scale.setScalar(1 + pulse * 0.12);
  });

  return (
    <group ref={beat} position={[0, -((EH * 3) / 2) * A, 0]}>
      <mesh geometry={glowQuad()} material={halo} position={[0, 0, -0.01]} scale={EW * 3 * A * 1.6} renderOrder={2} />
      <mesh geometry={unitQuad()} material={material} scale={[EW * 3 * A, EH * 3 * A, 1]} renderOrder={8} />
    </group>
  );
}
