import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { AdditiveBlending, Color, CylinderGeometry, FrontSide, Quaternion, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from "three";
import { groundHeight } from "./layout";
import { MOON_DIR } from "./Sky";

/** Moonbeams over the valley: long shafts of light slanting down from the
 * moon, through the gaps in the forest crest, across the camp to the
 * ground — so the light is there from every side, not only when you face
 * the moon (where the screen-space god rays take over, render/godRays).
 *
 * Each beam is an open cylinder along the moon's direction with an additive
 * shader: bright through its middle and soft at its silhouette (how much
 * lit air the eye looks through), fading in from the crest and out at the
 * ground, with dust drifting down it and the fog taking the far ones. */

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

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
uniform float uStrength;
uniform float uTime;
uniform float uPhase;
varying vec3 vN;
varying vec3 vViewDir;
varying vec2 vUv;
void main() {
  float h = vUv.y; // 0 at the ground, 1 up toward the moon
  float facing = abs(dot(normalize(vN), normalize(vViewDir)));
  float body = pow(facing, 2.2);
  float ends = smoothstep(0.0, 0.18, h) * (1.0 - smoothstep(0.55, 1.0, h));
  float a = vUv.x * 6.2831853;
  float streak = 0.6 + 0.4 * sin(a * 4.0 + sin(h * 3.1 + uTime * 0.17 + uPhase) * 1.6);
  float dust = 0.75 + 0.25 * sin(h * 40.0 + uTime * 0.9 + a * 2.0 + uPhase);
  // Breathing slowly, as thin cloud crosses the moon.
  float breathe = 0.75 + 0.25 * sin(uTime * 0.13 + uPhase * 2.0);
  float alpha = uStrength * body * ends * streak * dust * breathe;
  #ifdef USE_FOG
    alpha *= 1.0 - smoothstep(fogNear, fogFar * 1.2, vFogDepth);
  #endif
  gl_FragColor = vec4(uColor * alpha, 1.0);
}`;

/** Where the beams land (x, z on the valley floor), how wide, how bright. */
const BEAMS: [number, number, number, number][] = [
  [-15, 2, 3.2, 0.22],
  [-6, -8, 4.5, 0.28],
  [4, 4, 3.6, 0.2],
  [12, -6, 5.0, 0.26],
  [21, 6, 3.0, 0.18],
];
const LENGTH = 95;

export function MoonShafts() {
  const res = useMemo(() => {
    const geo = new CylinderGeometry(1, 1, 1, 18, 1, true).translate(0, 0.5, 0);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), MOON_DIR);
    const beams = BEAMS.map(([x, z, w, strength], i) => {
      const mat = new ShaderMaterial({
        uniforms: UniformsUtils.merge([
          UniformsLib.fog,
          { uColor: { value: new Color("#8fa6ff") }, uStrength: { value: strength }, uTime: { value: 0 }, uPhase: { value: i * 1.9 } },
        ]),
        vertexShader: VERT,
        fragmentShader: FRAG,
        fog: true,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: FrontSide,
        toneMapped: false,
      });
      return { pos: [x, groundHeight(x, z), z] as const, scale: [w, LENGTH, w * 0.6] as const, mat };
    });
    return { geo, q, beams };
  }, []);
  useEffect(
    () => () => {
      res.geo.dispose();
      res.beams.forEach((b) => b.mat.dispose());
    },
    [res],
  );
  useFrame(({ clock }) => {
    for (const b of res.beams) b.mat.uniforms.uTime!.value = clock.elapsedTime;
  });
  return (
    <group>
      {res.beams.map((b, i) => (
        <mesh key={i} geometry={res.geo} material={b.mat} position={b.pos} quaternion={res.q} scale={b.scale} renderOrder={2} frustumCulled={false} />
      ))}
    </group>
  );
}
