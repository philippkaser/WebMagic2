import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  type Points,
  ShaderMaterial,
} from "three";

/** A pixel starfield for the village night sky.
 *
 * drei's <Stars> sizes each point by its view-space depth
 * (`gl_PointSize = size * 30/-mvPosition.z`), so the stars you look straight
 * at — the ones deepest along the view axis — shrink below a pixel and vanish,
 * while stars at grazing angles near the screen edge stay fat. At this game's
 * `dpr 0.35` that reads as a hole in the middle of the sky. This field gives
 * every star the same chunky, depth-independent size, so the sky is even from
 * the zenith to the horizon and looks hand-placed pixel by pixel like the rest
 * of the game. Unlit and un-fogged; it just adds its light onto the dark. */

const VERT = /* glsl */ `
uniform float uTime;
uniform float uPixel;
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;
varying vec3 vColor;
void main() {
  // Twinkle: each star breathes on its own phase.
  float tw = 0.55 + 0.45 * sin(uTime * 1.6 + aPhase);
  vColor = aColor * tw;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Constant size in framebuffer pixels — no depth falloff — so the centre of
  // the sky is as dense as the edges.
  gl_PointSize = aSize * uPixel;
}
`;

const FRAG = /* glsl */ `
precision mediump float;
varying vec3 vColor;
void main() {
  // Square pixels, no soft falloff — chunky stars to match the art.
  gl_FragColor = vec4(vColor, 1.0);
}
`;

function buildGeometry(count: number, radius: number): BufferGeometry {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // Uniform over the sphere.
    const theta = 2 * Math.PI * Math.random();
    const phi = Math.acos(2 * Math.random() - 1);
    const r = radius * (0.82 + 0.18 * Math.random());
    const sinPhi = Math.sin(phi);
    pos[i * 3] = r * sinPhi * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi);
    pos[i * 3 + 2] = r * sinPhi * Math.sin(theta);

    // Mostly cool white, with the odd arcane-tinted star.
    let cr = 0.82;
    let cg = 0.86;
    let cb = 1.0;
    const t = Math.random();
    if (t > 0.93) {
      cr = 0.5;
      cg = 1.0;
      cb = 0.85; // teal
    } else if (t > 0.86) {
      cr = 0.82;
      cg = 0.55;
      cb = 1.0; // violet
    } else if (t > 0.8) {
      cr = 1.0;
      cg = 0.86;
      cb = 0.6; // amber
    }
    const b = 0.45 + Math.random() * 0.55;
    col[i * 3] = cr * b;
    col[i * 3 + 1] = cg * b;
    col[i * 3 + 2] = cb * b;

    // A few fat stars among many small ones.
    size[i] = Math.random() < 0.86 ? 1 : Math.random() < 0.7 ? 2 : 3;
    phase[i] = Math.random() * Math.PI * 2;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("aColor", new Float32BufferAttribute(col, 3));
  g.setAttribute("aSize", new Float32BufferAttribute(size, 1));
  g.setAttribute("aPhase", new Float32BufferAttribute(phase, 1));
  return g;
}

export function NightSky({
  count = 1600,
  radius = 120,
  pixel = 1.6,
}: {
  count?: number;
  radius?: number;
  pixel?: number;
}) {
  const ref = useRef<Points>(null);
  const geometry = useMemo(() => buildGeometry(count, radius), [count, radius]);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uTime: { value: 0 },
          uPixel: { value: pixel },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [pixel],
  );

  useFrame(({ clock, camera }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    // The sky rides with the eye, so it reads as infinitely far — you can walk
    // the village without the stars sliding past.
    if (ref.current) ref.current.position.copy(camera.position);
  });

  return <points ref={ref} geometry={geometry} material={material} frustumCulled={false} />;
}
