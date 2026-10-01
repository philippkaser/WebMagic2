import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { LIGHT_BLENDING } from "./holoMaterial";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from "three";

/** Where a cast pane comes from: a sigil burning on the floor and a beam of
 * light rising from it into the pane's lower edge — the hologram's
 * projector, in world space whatever the pane does.
 *
 * `paneRef` is the pane's group (its local origin at the pane centre,
 * x along its width, y along its height); `width`/`height` its size. The
 * sigil lies flat on the floor under the pane's foot (the floor is taken
 * 1.6 m below the eye), nudged toward the caster; the beam is a ribbon from
 * the sigil to the pane's bottom edge. `progress` (0…1) ignites the sigil,
 * then raises the beam; `alpha` fades both. */

const SIGIL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** A rune circle on a polar grid of chunky cells: two rings, a band of
 * blocky glyphs turning slowly, ticks turning the other way, an inner
 * star. It draws itself around as `uIgnite` rises. */
const SIGIL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIgnite;
uniform float uAlpha;
uniform float uTime;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 q = floor((vUv - 0.5) * 96.0) + 0.5;
  float r = length(q) / 48.0;
  float ang = atan(q.y, q.x);
  float a01 = fract(ang / 6.2831853 + 0.25);
  if (a01 > uIgnite) discard;
  float b = 0.0;
  // Rings.
  if (abs(r - 0.93) < 0.018) b = 0.9;
  if (abs(r - 0.70) < 0.015) b = 0.7;
  // A band of glyphs between them, turning.
  if (r > 0.75 && r < 0.88) {
    float seg = floor(fract(ang / 6.2831853 + uTime * 0.02) * 36.0);
    float rr = floor((r - 0.75) / 0.13 * 4.0);
    float aa = floor(fract(fract(ang / 6.2831853 + uTime * 0.02) * 36.0) * 4.0);
    b = max(b, hash(vec2(seg * 4.0 + aa, rr + seg)) > 0.55 ? 0.6 : 0.0);
    if (aa > 2.5) b = 0.0; // the gap between glyphs
  }
  // Ticks inside, turning the other way.
  if (r > 0.6 && r < 0.68 && mod(floor(fract(ang / 6.2831853 - uTime * 0.04) * 48.0), 2.0) < 1.0) b = max(b, 0.45);
  // A six-pointed star.
  for (int i = 0; i < 6; i++) {
    float th = float(i) * 1.0471976 + uTime * 0.05;
    vec2 p0 = vec2(cos(th), sin(th)) * 0.6;
    vec2 p1 = vec2(cos(th + 2.0943951), sin(th + 2.0943951)) * 0.6;
    vec2 pa = q / 48.0 - p0;
    vec2 ba = p1 - p0;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    if (length(pa - ba * h) < 0.014) b = max(b, 0.5);
  }
  // The core glow.
  b += r < 0.25 ? 0.2 * (1.0 - r / 0.25) : 0.0;
  b *= 0.85 + 0.15 * sin(uTime * 3.0 + r * 9.0);
  if (b <= 0.01) discard;
  gl_FragColor = vec4(pow(uColor, vec3(1.0 / 2.2)) * b * uAlpha * 0.7, 0.0);
}
`;

const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

/** The beam: brightest at the sigil and where it feeds the pane, streaked
 * along its length, motes climbing it, its sides dithered away. */
const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uGrow;
uniform float uAlpha;
uniform float uTime;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 c = floor(vUv * vec2(40.0, 90.0));
  float v = (c.y + 0.5) / 90.0;
  if (v > uGrow) discard;
  float side = abs((c.x + 0.5) / 40.0 - 0.5) * 2.0;
  float b = 0.12 + 0.35 * pow(1.0 - v, 3.0) + 0.25 * pow(v, 8.0);
  // Streaks along the beam, crawling up.
  float lane = hash(vec2(c.x, 3.0));
  b += lane > 0.75 ? 0.12 * (0.5 + 0.5 * sin(v * 20.0 - uTime * 6.0 + lane * 30.0)) : 0.0;
  // Motes climbing.
  float mote = hash(vec2(c.x, floor(v * 90.0 - uTime * 30.0 * (0.5 + lane))));
  b += mote > 0.985 ? 0.6 : 0.0;
  // The leading edge while it rises.
  b += (uGrow < 0.999 && v > uGrow - 0.04) ? 0.8 : 0.0;
  // Soft sides, in pixels.
  float m = mod(c.x + c.y, 2.0);
  b *= side < 0.6 ? 1.0 : side < 0.85 ? (m < 1.0 ? 0.7 : 0.25) : (m < 1.0 ? 0.2 : 0.0);
  if (b <= 0.01) discard;
  gl_FragColor = vec4(pow(uColor, vec3(1.0 / 2.2)) * b * uAlpha * 0.4, 0.0);
}
`;

let sigilQuad: PlaneGeometry | null = null;

/** The floor sigil's light (a unit quad; lay it flat). Uniforms: uIgnite
 * (0…1, draws itself around), uAlpha, uTime. */
export function makeSigilMaterial(color: string): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uIgnite: { value: 0 }, uAlpha: { value: 0 }, uTime: { value: 0 } },
    vertexShader: SIGIL_VERT,
    fragmentShader: SIGIL_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    ...LIGHT_BLENDING,
    toneMapped: false,
  });
}

/** A beam's light: uv.y runs from its source (0) to its target (1).
 * `worldSpace`: the geometry's positions are already in the world (the
 * pane beam, rebuilt every frame); otherwise the mesh's transform applies.
 * Uniforms: uGrow (0…1, rises), uAlpha, uTime. */
export function makeBeamMaterial(color: string, worldSpace: boolean): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uGrow: { value: 0 }, uAlpha: { value: 0 }, uTime: { value: 0 } },
    vertexShader: worldSpace
      ? BEAM_VERT
      : BEAM_VERT.replace("projectionMatrix * viewMatrix * vec4(position, 1.0)", "projectionMatrix * modelViewMatrix * vec4(position, 1.0)"),
    fragmentShader: BEAM_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    ...LIGHT_BLENDING,
    toneMapped: false,
    side: 2,
  });
}

export function Projector({
  paneRef,
  width,
  height,
  color,
  progress,
  alpha,
}: {
  paneRef: MutableRefObject<Group | null>;
  width: number;
  height: number;
  color: string;
  progress: MutableRefObject<number>;
  alpha: MutableRefObject<number>;
}) {
  const sigilMat = useMemo(() => makeSigilMaterial(color), [color]);
  const beamMat = useMemo(() => makeBeamMaterial(color, true), [color]);
  const beamGeo = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(12), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    return g;
  }, []);
  useEffect(
    () => () => {
      sigilMat.dispose();
      beamMat.dispose();
      beamGeo.dispose();
    },
    [sigilMat, beamMat, beamGeo],
  );
  const sigil = useRef<Mesh>(null);
  const beam = useRef<Mesh>(null);

  useFrame(({ camera, clock }) => {
    const pane = paneRef.current;
    const s = sigil.current;
    const b = beam.current;
    if (!pane || !s || !b) return;
    const p = progress.current;
    const a = alpha.current;
    const t = clock.elapsedTime;
    pane.updateWorldMatrix(true, false);
    // The pane's bottom edge, in the world.
    bl.set(-width / 2, -height / 2, 0).applyMatrix4(pane.matrixWorld);
    br.set(width / 2, -height / 2, 0).applyMatrix4(pane.matrixWorld);
    mid.addVectors(bl, br).multiplyScalar(0.5);
    // The sigil: on the floor under the pane's foot, a little toward you.
    const floorY = camera.position.y - 1.6;
    toward.set(camera.position.x - mid.x, 0, camera.position.z - mid.z);
    const dist = toward.length();
    if (dist > 1e-3) toward.multiplyScalar(Math.min(0.35, dist * 0.3) / dist);
    origin.set(mid.x + toward.x, floorY + 0.01, mid.z + toward.z);
    const radius = Math.max(0.28, Math.min(0.6, width * 0.32));
    s.matrixWorld.makeRotationX(-Math.PI / 2).scale(scaleV.set(radius * 2, radius * 2, 1)).setPosition(origin);
    sigilMat.uniforms.uIgnite.value = Math.min(1, p / 0.45);
    sigilMat.uniforms.uAlpha.value = a;
    sigilMat.uniforms.uTime.value = t;
    // The beam: a ribbon from the sigil (narrow) to the pane's edge (wide).
    side.subVectors(br, bl).normalize().multiplyScalar(radius * 0.35);
    const pos = beamGeo.attributes.position as BufferAttribute;
    pos.setXYZ(0, origin.x - side.x, origin.y, origin.z - side.z);
    pos.setXYZ(1, origin.x + side.x, origin.y, origin.z + side.z);
    pos.setXYZ(2, bl.x, bl.y, bl.z);
    pos.setXYZ(3, br.x, br.y, br.z);
    pos.needsUpdate = true;
    beamGeo.computeBoundingSphere();
    beamMat.uniforms.uGrow.value = Math.min(1, Math.max(0, (p - 0.2) / 0.45));
    beamMat.uniforms.uAlpha.value = a;
    beamMat.uniforms.uTime.value = t;
  });

  return (
    <>
      <mesh ref={sigil} geometry={(sigilQuad ??= new PlaneGeometry(1, 1))} material={sigilMat} matrixAutoUpdate={false} matrixWorldAutoUpdate={false} frustumCulled={false} renderOrder={1} />
      <mesh ref={beam} geometry={beamGeo} material={beamMat} matrixAutoUpdate={false} matrixWorldAutoUpdate={false} frustumCulled={false} renderOrder={1} />
    </>
  );
}

const bl = new Vector3();
const br = new Vector3();
const mid = new Vector3();
const toward = new Vector3();
const origin = new Vector3();
const side = new Vector3();
const scaleV = new Vector3();
