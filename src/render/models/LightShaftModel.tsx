import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  CylinderGeometry,
  FrontSide,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
} from "three";
import { WALL_HEIGHT } from "../../core/config";
import type { LightShaftSpawn } from "../../world/types";
import { shared } from "./shared";

/** Soft volumetric light shafts: light falling from a crack in the vault to
 * the floor (or, in the Ember Forge, heat haze rising from it). Not real
 * volumetrics — an open cone with an additive shader:
 *
 *   brightness = facing term (bright through the middle of the column, soft
 *                at its silhouette — how much "air" the eye looks through)
 *              × vertical falloff (brightest at the crack)
 *              × drifting streaks and dust
 *              × (1 − fog), so a far shaft fades like everything else.
 *
 * Plus a faint pool where it lands and a glint at the crack. The real
 * lighting (a pooled light under each shaft) is the scene's job. */

const shaftGeo = shared(() => new CylinderGeometry(0.42, 1, 1, 20, 1, true));
const poolGeo = shared(() => new CircleGeometry(1, 28));

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vN;
varying vec3 vViewDir;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vViewDir = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const SHAFT_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
uniform float uStrength;
uniform float uTime;
uniform float uRising;
varying vec3 vN;
varying vec3 vViewDir;
varying vec2 vUv;
void main() {
  float h = vUv.y; // 0 floor, 1 vault
  float facing = abs(dot(normalize(vN), normalize(vViewDir)));
  float body = pow(facing, 1.8);
  float fall = uRising > 0.5 ? mix(1.0, 0.1, h) : mix(0.4, 1.0, h);
  float ends = smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.9, 1.0, h));
  float t = uTime * (uRising > 0.5 ? 0.5 : 0.12);
  float a = vUv.x * 6.2831853;
  // God-ray streaks round the column, slowly swaying.
  float streak = 0.62 + 0.38 * sin(a * 5.0 + sin(h * 2.3 + uTime * 0.21) * 1.4);
  // Dust / haze drifting along it (down for light, up for heat).
  float dust = 0.78 + 0.22 * sin(h * 17.0 + (uRising > 0.5 ? -t : t) * 6.0 + a * 3.0);
  float alpha = uStrength * body * fall * ends * streak * dust;
  #ifdef USE_FOG
    alpha *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor = vec4(uColor * alpha, 1.0);
}`;

const POOL_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
uniform float uStrength;
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 d = vUv * 2.0 - 1.0;
  float r = length(d);
  float a = atan(d.y, d.x);
  float edge = 1.0 - smoothstep(0.25 + 0.08 * sin(a * 3.0 + uTime * 0.3), 1.0, r);
  float alpha = uStrength * edge * edge;
  #ifdef USE_FOG
    alpha *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor = vec4(uColor * alpha, 1.0);
}`;

function makeMaterial(frag: string, color: string, strength: number, rising: boolean): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uColor: { value: new Color(color) },
        uStrength: { value: strength },
        uTime: { value: 0 },
        uRising: { value: rising ? 1 : 0 },
      },
    ]),
    vertexShader: VERT,
    fragmentShader: frag,
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: FrontSide,
    toneMapped: false,
  });
}

export interface ShaftLook {
  color: string;
  /** Overall brightness of the column (≈ 0.1–0.4). */
  strength: number;
  /** Heat haze rising from the floor instead of light falling from above. */
  rising?: boolean;
}

export function LightShafts({ shafts, look }: { shafts: LightShaftSpawn[]; look: ShaftLook }) {
  const mats = useMemo(
    () => ({
      shaft: makeMaterial(SHAFT_FRAG, look.color, look.strength, !!look.rising),
      pool: makeMaterial(POOL_FRAG, look.color, look.strength * (look.rising ? 0.5 : 0.8), false),
      crack: makeMaterial(POOL_FRAG, look.color, look.rising ? 0 : look.strength * 3, false),
    }),
    [look],
  );
  useEffect(
    () => () => {
      mats.shaft.dispose();
      mats.pool.dispose();
      mats.crack.dispose();
    },
    [mats],
  );
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    mats.shaft.uniforms.uTime.value = t;
    mats.pool.uniforms.uTime.value = t;
    mats.crack.uniforms.uTime.value = t;
  });

  return (
    <group>
      {shafts.map((s, i) => (
        <group key={i} position={[s.pos[0], 0, s.pos[2]]}>
          <mesh
            geometry={shaftGeo()}
            material={mats.shaft}
            position={[0, WALL_HEIGHT / 2, 0]}
            scale={[s.radius, WALL_HEIGHT, s.radius]}
          />
          <mesh
            geometry={poolGeo()}
            material={mats.pool}
            position={[0, 0.02, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            scale={s.radius * 1.2}
          />
          {!look.rising && (
            <mesh
              geometry={poolGeo()}
              material={mats.crack}
              position={[0, WALL_HEIGHT - 0.02, 0]}
              rotation={[Math.PI / 2, 0, 0]}
              scale={s.radius * 0.42}
            />
          )}
        </group>
      ))}
    </group>
  );
}
