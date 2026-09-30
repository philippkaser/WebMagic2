import { useEffect, useMemo } from "react";
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { hash2 } from "../../../render/textures/noise";

/** The village night sky: a gradient dome, two ridges of mountain
 * silhouette, and a haloed moon — all unlit, fog-free backdrop meshes. */

export const MOON_DIR = new Vector3(0.45, 0.42, -0.79).normalize();
export const HORIZON = "#1a2244";

const skyMaterial = () =>
  new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uHorizon: { value: new Color(HORIZON) },
      uZenith: { value: new Color("#03040b") },
      uMoon: { value: MOON_DIR },
      uMoonGlow: { value: new Color("#3a4a80") },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      uniform vec3 uMoon;
      uniform vec3 uMoonGlow;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(uHorizon, uZenith, pow(h, 0.45));
        c += uMoonGlow * pow(max(dot(vDir, uMoon), 0.0), 12.0) * 0.8;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });

/** Jagged ring of peaks: a triangle strip from y=-2 up to a noisy crest. */
function ridge(radius: number, base: number, amp: number, seed: number): BufferGeometry {
  const n = 160;
  const pos = new Float32Array((n + 1) * 2 * 3);
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = i % n;
    const crest =
      base +
      amp *
        (0.55 * Math.abs(Math.sin(a * 3 + seed)) +
          0.3 * Math.abs(Math.sin(a * 7.3 + seed * 2)) +
          0.15 * hash2(k, 0, seed));
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    pos.set([x, -2, z, x, crest, z], i * 6);
    if (i < n) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function haloTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, "rgba(200,215,255,0.9)");
  g.addColorStop(0.35, "rgba(120,140,220,0.25)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

export function Sky() {
  const res = useMemo(() => {
    const flat = (color: string) => new MeshBasicMaterial({ color, fog: false, side: DoubleSide });
    return {
      dome: new SphereGeometry(120, 24, 12),
      domeMat: skyMaterial(),
      far: ridge(95, 6, 16, 1.7),
      farMat: flat("#0b0f22"),
      near: ridge(72, 1, 9, 4.2),
      nearMat: flat("#05070f"),
      moonMat: new MeshBasicMaterial({ color: new Color("#eef2ff").multiplyScalar(1.6), fog: false, toneMapped: false }),
      haloMat: new MeshBasicMaterial({
        map: haloTexture(),
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    };
  }, []);
  useEffect(
    () => () => {
      for (const r of Object.values(res)) r.dispose();
      res.haloMat.map?.dispose();
    },
    [res],
  );
  const moonPos = MOON_DIR.clone().multiplyScalar(100);
  return (
    <group>
      <mesh geometry={res.dome} material={res.domeMat} renderOrder={-2} frustumCulled={false} />
      <mesh geometry={res.far} material={res.farMat} renderOrder={-1} />
      <mesh geometry={res.near} material={res.nearMat} renderOrder={-1} />
      <group position={moonPos} onUpdate={(g) => g.lookAt(0, 0, 0)}>
        <mesh material={res.moonMat}>
          <circleGeometry args={[4.2, 20]} />
        </mesh>
        <mesh material={res.haloMat} position={[0, 0, -0.5]}>
          <planeGeometry args={[34, 34]} />
        </mesh>
      </group>
    </group>
  );
}
