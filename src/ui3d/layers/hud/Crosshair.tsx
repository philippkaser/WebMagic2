import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, ShaderMaterial, type Mesh } from "three";
import { gameEvents } from "../../../core/events";
import { ViewAnchor } from "../../anchors";
import { ink } from "../../theme";
import { apx } from "./ap";
import { useStepFade } from "./fade";
import { unitQuad } from "./PixelSprite";

/** The aim (artpass hud/Crosshair): a 2 px bone-white dot and four short
 * arms with a hard ink shadow, every pixel square. Spells fly along the
 * camera ray, so its centre is exactly where they go. Every cast (the
 * staff's kick) snaps the arms outward a few whole pixels and lights them
 * arcane, and they step back in.
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
uniform vec3 uBone;
uniform vec3 uArc;
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

void main() {
  vec2 p = floor(vUv * ${N}.0) - ${N / 2}.0;
  vec3 col;
  float a;
  vec3 armCol = mix(uBone, uArc, uHot);
  if (dot_(p)) { col = uBone; a = 1.0; }
  else if (arm(p)) { col = armCol; a = 0.88; }
  // The dot's ink ring, and the arms' hard 1 px shadow (down-right).
  else if (abs(p.x + 0.5) <= 1.5 && abs(p.y + 0.5) <= 1.5) { col = vec3(0.0); a = 0.7; }
  else if (arm(p + vec2(-1.0, 1.0))) { col = vec3(0.0); a = 0.7; }
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
          uBone: { value: new Color("#f4ecd8") },
          uArc: { value: new Color(ink.arcane) },
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

  useEffect(
    () =>
      gameEvents.on("staffKick", (v) => {
        kick.current = Math.min(1, Math.max(kick.current, v));
      }),
    [],
  );

  useFrame((_, rawDt) => {
    // Clamped so a hitch doesn't swallow the cast's pulse.
    const dt = Math.min(rawDt, 1 / 20);
    kick.current *= Math.exp(-dt * 7);
    const u = material.uniforms;
    // Whole pixels only: the arms jump out and step back in.
    u.uSpread!.value = Math.round(kick.current * 3);
    u.uHot!.value = kick.current > 0.25 ? 1 : 0;
    u.uShow!.value = fade.current;
    if (mesh.current) mesh.current.visible = fade.current > 0;
  });

  return (
    <ViewAnchor offset={[0, 0, -D]} follow={Infinity}>
      <mesh ref={mesh} geometry={unitQuad()} material={material} scale={[N * A, N * A, 1]} renderOrder={60} />
    </ViewAnchor>
  );
}
