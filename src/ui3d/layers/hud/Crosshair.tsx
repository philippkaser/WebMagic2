import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, ShaderMaterial, type Mesh } from "three";
import { gameEvents } from "../../../core/events";
import { palette } from "../../../ui/theme";
import { ViewAnchor } from "../../anchors";
import { uiNow } from "../../clock";
import { useUiShow } from "../../presence";
import { glowQuad } from "./glow";
import { hudUnit } from "./HudAnchor";

/** The aim: a tiny rune reticle burning in the air dead ahead — four arcs
 * of a ring turning slowly round a point of light. Spells fly along the
 * camera ray, so its centre is exactly where they go. Every cast (the
 * staff's kick) makes it flare: the arcs spin and spread, and a ring of
 * light ripples outward.
 *
 * Rigidly carried (no lag): an aim that trails the view would lie. */

const D = 1;
/** Quad size: the reticle plus its glow, ~3.4% of the screen tall. */
const SIZE = 0.034 * hudUnit(D);

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uKick;
uniform float uShow;
uniform float uSpin;
uniform vec3 uColor;
uniform vec3 uAccent;
varying vec2 vUv;
const float QUARTER = 1.5707963;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float a = atan(p.y, p.x) + uSpin;
  // Four arcs, centred on the diagonals, spreading on a cast.
  float ringR = 0.5 + uKick * 0.2;
  float seg = abs(fract(a / QUARTER) - 0.5);
  float d = abs(r - ringR);
  float arc = smoothstep(0.3 - uKick * 0.08, 0.2 - uKick * 0.08, seg);
  float ink = arc * smoothstep(0.075, 0.04, d);
  float dotInk = smoothstep(0.12, 0.07, r);
  float core = max(ink, dotInk);
  // A dark rim keeps it legible over torchlight and pale bone alike.
  float rim = max(smoothstep(0.34, 0.24, seg) * smoothstep(0.15, 0.09, d), smoothstep(0.21, 0.13, r));
  float glow = arc * exp(-d * d * 90.0) * 0.45 + exp(-r * r * 22.0) * 0.35;
  // The cast's ripple: a ring racing outward as the kick decays.
  float pr = 0.35 + (1.0 - uKick) * 0.6;
  float ripple = uKick * smoothstep(0.07, 0.0, abs(r - pr));
  vec3 col = uColor * core * (1.0 + uKick * 0.8) + uAccent * (glow * (0.6 + uKick * 1.4) + ripple * 1.6);
  float alpha = max(core, rim * 0.55);
  gl_FragColor = vec4(col, alpha) * uShow;
  #include <colorspace_fragment>
}
`;

export function Crosshair() {
  const show = useUiShow();
  const mesh = useRef<Mesh>(null);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uKick: { value: 0 },
          uShow: { value: 0 },
          uSpin: { value: 0 },
          uColor: { value: new Color("#f4ead2") },
          uAccent: { value: new Color(palette.accent) },
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
  const state = useRef({ kick: 0, spin: 0, shown: 0 });

  useEffect(
    () =>
      gameEvents.on("staffKick", (v) => {
        state.current.kick = Math.min(1, Math.max(state.current.kick, v));
      }),
    [],
  );

  useFrame((_, rawDt) => {
    // Clamped so a hitch doesn't swallow the cast's pulse.
    const dt = Math.min(rawDt, 1 / 20);
    const s = state.current;
    const u = material.uniforms;
    s.kick *= Math.exp(-dt * 5.5);
    s.spin += dt * (0.35 + s.kick * 9);
    s.shown += ((show ? 1 : 0) - s.shown) * (1 - Math.exp(-dt * (show ? 5 : 8)));
    u.uTime!.value = uiNow();
    u.uKick!.value = s.kick;
    u.uSpin!.value = s.spin;
    u.uShow!.value = s.shown;
    const m = mesh.current;
    if (m) {
      m.visible = s.shown > 0.01;
      // Arrives from a larger, looser ring, as if focusing.
      m.scale.setScalar(SIZE * (1 + (1 - s.shown) * 1.2 + s.kick * 0.25));
    }
  });

  return (
    <ViewAnchor offset={[0, 0, -D]} follow={Infinity}>
      <mesh ref={mesh} geometry={glowQuad()} material={material} renderOrder={60} />
    </ViewAnchor>
  );
}
