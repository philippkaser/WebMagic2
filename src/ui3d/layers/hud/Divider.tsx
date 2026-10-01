import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { Color, ShaderMaterial } from "three";
import { uiNow } from "../../clock";
import { useUiShow } from "../../presence";
import { ink } from "../../theme";
import { useStepFade } from "./fade";
import { unitQuad } from "./PixelSprite";

/** The grimoire's brass rule (artpass `.wm-rule`, and with `diamond` its
 * banner flourish `—— ◆ ——`): a 2 px line, lit on top and shadowed below,
 * that fades out toward both ends in hard bands. It draws itself outward
 * from the centre in whole pixels as it appears. */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec2 uPx;
uniform float uReveal;
uniform float uShow;
uniform float uDiamond;
uniform vec3 uLine;
uniform vec3 uLight;
uniform vec3 uDark;
varying vec2 vUv;
void main() {
  vec2 p = floor(vUv * uPx);
  vec2 c = floor(uPx * 0.5);
  float dx = abs(p.x - c.x);
  float dy = abs(p.y - c.y);
  if (dx > floor(uReveal * c.x)) discard;
  vec3 col;
  float a;
  if (uDiamond > 0.5 && dx + dy <= 3.0) {
    // The centre diamond: a bright core in a brass rhombus.
    col = dx + dy <= 1.0 ? vec3(1.0, 0.965, 0.85) : uLight;
    a = 1.0;
  } else if ((p.y == c.y || p.y == c.y - 1.0) && (uDiamond < 0.5 || dx > 6.0)) {
    // Fades toward the ends in five hard bands.
    float t = uDiamond > 0.5 ? (dx - 6.0) / max(1.0, c.x - 6.0) : dx / max(1.0, c.x);
    a = 1.0 - floor(t * 5.0) / 5.0;
    col = p.y == c.y ? mix(uDark, uLine, a) : uDark * 0.8;
  } else {
    discard;
  }
  gl_FragColor = vec4(col * a * uShow, a * uShow);
  #include <colorspace_fragment>
}
`;

export function Divider({
  width,
  unit,
  diamond = false,
  delay = 0,
  drawTime = 0.45,
  position,
}: {
  /** Length in artpass pixels. */
  width: number;
  unit: number;
  diamond?: boolean;
  delay?: number;
  drawTime?: number;
  position?: readonly [number, number, number];
}) {
  const W = Math.round(width) | 1;
  const H = 7;
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uPx: { value: [W, H] },
          uReveal: { value: 0 },
          uShow: { value: 0 },
          uDiamond: { value: diamond ? 1 : 0 },
          uLine: { value: new Color(ink.brass) },
          uLight: { value: new Color(ink.brassLight) },
          uDark: { value: new Color(ink.brassDark) },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
      }),
    [W, diamond],
  );
  useEffect(() => () => material.dispose(), [material]);
  const show = useUiShow();
  const fade = useStepFade({ delay, inTime: 0.15, outTime: 0.3, steps: 3 });
  const clock = useMemo(() => ({ at: 0, shown: false }), []);

  useFrame(() => {
    const now = uiNow();
    if (show && !clock.shown) clock.at = now + delay;
    clock.shown = show;
    const t = Math.max(0, now - clock.at);
    // Out from the centre in a dozen pixel-steps.
    material.uniforms.uReveal!.value = show ? Math.ceil(Math.min(1, t / drawTime) * 12) / 12 : 1;
    material.uniforms.uShow!.value = fade.current;
  });

  return <mesh geometry={unitQuad()} material={material} scale={[W * unit, H * unit, 1]} position={position as [number, number, number] | undefined} renderOrder={7} />;
}
