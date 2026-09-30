import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial } from "three";
import { Rng } from "../../core/rng";

/** Air you can see: a few hundred particles animated entirely on the GPU
 * (one draw call, zero per-frame CPU beyond two uniforms). Positions wrap in
 * a box that follows the camera, so the field is endless and constant-cost. */

export type MoteKind = "dust" | "spore" | "ember" | "glint" | "ash" | "firefly";

interface MoteStyle {
  /** Drift velocity (units/s). */
  vel: [number, number, number];
  /** Sway amplitude. */
  sway: number;
  size: number;
  alpha: number;
  /** 0 = steady, 1 = full blink. */
  twinkle: number;
  count: number;
}

const STYLES: Record<MoteKind, MoteStyle> = {
  dust: { vel: [0.04, -0.03, 0.02], sway: 0.25, size: 1.2, alpha: 0.25, twinkle: 0.2, count: 260 },
  spore: { vel: [0.02, 0.08, 0], sway: 0.35, size: 1.6, alpha: 0.8, twinkle: 0.6, count: 140 },
  ember: { vel: [0.05, 0.7, 0.02], sway: 0.3, size: 1.6, alpha: 1, twinkle: 0.5, count: 200 },
  glint: { vel: [0, 0.03, 0], sway: 0.12, size: 1.6, alpha: 0.9, twinkle: 1, count: 110 },
  ash: { vel: [0.08, 0.28, 0.03], sway: 0.45, size: 1.5, alpha: 0.6, twinkle: 0.3, count: 120 },
  firefly: { vel: [0, 0.02, 0], sway: 0.9, size: 2, alpha: 1, twinkle: 0.9, count: 90 },
};

const BOX_XZ = 22;

const vertex = /* glsl */ `
uniform float uTime;
uniform vec3 uCam;
uniform vec3 uVel;
uniform float uSway;
uniform float uSize;
uniform float uHeight;
uniform float uTwinkle;
attribute float aPhase;
varying float vAlpha;
void main() {
  vec3 box = vec3(${BOX_XZ.toFixed(1)}, uHeight, ${BOX_XZ.toFixed(1)});
  vec3 p = position * box + uVel * uTime;
  p += uSway * vec3(sin(uTime * 0.7 + aPhase * 6.3), sin(uTime * 0.9 + aPhase * 4.1) * 0.5, cos(uTime * 0.6 + aPhase * 5.7));
  // Wrap horizontally around the camera, vertically between floor and ceiling.
  p.xz = mod(p.xz - uCam.xz + box.xz * 0.5, box.xz) - box.xz * 0.5 + uCam.xz;
  p.y = mod(p.y, uHeight);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  vAlpha = (1.0 - smoothstep(6.0, 11.0, length(p.xz - uCam.xz)))
         * mix(1.0, 0.5 + 0.5 * sin(uTime * (2.0 + aPhase * 3.0) + aPhase * 40.0), uTwinkle)
         * smoothstep(0.0, 0.4, p.y) * (1.0 - smoothstep(uHeight - 0.4, uHeight, p.y));
  gl_PointSize = clamp(uSize * 6.0 / max(dist, 0.1), 1.0, 2.0);
  gl_Position = projectionMatrix * mv;
}`;

const fragment = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(uColor * 1.6, vAlpha * uAlpha);
}`;

export function Motes({ kind, color, height }: { kind: MoteKind; color: string; height: number }) {
  const style = STYLES[kind];
  const geo = useMemo(() => {
    const rng = new Rng(kind.length * 97 + 3);
    const pos = new Float32Array(style.count * 3);
    const phase = new Float32Array(style.count);
    for (let i = 0; i < style.count; i++) {
      pos[i * 3] = rng.next();
      pos[i * 3 + 1] = rng.next();
      pos[i * 3 + 2] = rng.next();
      phase[i] = rng.next();
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("aPhase", new BufferAttribute(phase, 1));
    return g;
  }, [kind, style.count]);

  const mat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uCam: { value: [0, 0, 0] },
          uVel: { value: style.vel },
          uSway: { value: style.sway },
          uSize: { value: style.size },
          uHeight: { value: height },
          uTwinkle: { value: style.twinkle },
          uColor: { value: new Color(color) },
          uAlpha: { value: style.alpha },
        },
      }),
    [style, color, height],
  );

  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );

  useFrame(({ clock, camera }) => {
    mat.uniforms.uTime.value = clock.elapsedTime;
    mat.uniforms.uCam.value = camera.position;
  });

  return <points geometry={geo} material={mat} frustumCulled={false} />;
}
