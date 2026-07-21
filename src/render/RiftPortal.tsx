import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Color, DoubleSide, Group, ShaderMaterial } from "three";

/** The portal proper: a ragged tear in space and time. A displaced plane runs
 * a fully procedural fragment shader — domain-warped void swirl, starfield
 * deep inside, a hot rim where reality frays — with every coordinate snapped
 * to a coarse pixel grid so the rift is exactly as chunky as the rest of the
 * game. Broken shards of the world orbit the wound. */

const VERT = /* glsl */ `
uniform float uTime;
uniform float uActivity;
varying vec2 vUv;

void main() {
  vUv = uv;
  vec3 p = position;
  // The tear breathes: ripples travel along it, strongest in the middle,
  // pinned at the tips so the silhouette stays a tear.
  float pin = smoothstep(0.0, 0.25, uv.y) * smoothstep(1.0, 0.75, uv.y);
  float w = sin(p.y * 6.0 + uTime * 3.1) * cos(p.x * 4.0 - uTime * 2.3);
  p.z += w * 0.09 * (0.25 + uActivity) * pin;
  p.x += sin(uTime * 1.6 + p.y * 3.0) * 0.03 * pin;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uActivity;
uniform float uSeed;
uniform vec3 uColor;
varying vec2 vUv;

float hash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.13 + vec2(17.0, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  // Snap everything to a coarse grid first — the whole effect is computed
  // per fat pixel, edges included.
  vec2 uv = floor(vUv * 44.0) / 44.0;
  vec2 c = (uv - 0.5) * 2.0;
  float t = uTime * (0.3 + uActivity * 0.8);

  // Silhouette: a vertical slit whose lips rip open and shut with noise.
  float rip = fbm(vec2(uv.y * 5.0 + uSeed, t * 0.8)) - 0.5;
  float lip = 1.0 - smoothstep(0.0, 1.05, abs(c.y));
  float halfWidth = max(lip * (0.42 + rip * 0.3) * (0.35 + uActivity * 0.65), 0.0);
  float d = abs(c.x) / max(halfWidth, 1e-4);

  // Interior: coordinates dragged around the wound, warped twice.
  float ang = atan(c.y, c.x);
  float r = length(c);
  vec2 sw = vec2(cos(ang + r * 5.0 - t * 2.4), sin(ang + r * 5.0 - t * 2.4)) * r;
  float m = fbm(sw * 2.6 + fbm(sw * 5.2 + t) * 1.5 - t * 0.4);

  // Dead stars on the far side of the tear.
  float star = step(0.982, hash(uv * vec2(93.0, 97.0) + uSeed + floor(t * 3.0) * 0.31));

  vec3 deep = vec3(0.012, 0.004, 0.028);
  vec3 col = mix(deep, uColor * 0.55, smoothstep(0.2, 0.85, m));
  col += uColor * pow(m, 3.0) * 2.2;
  col += star * vec3(1.0) * (0.35 + uActivity * 0.65);

  // The frayed rim burns white-hot.
  float rim = smoothstep(0.55, 1.0, d);
  col += (uColor * 1.6 + vec3(0.85)) * pow(rim, 3.0) * (0.5 + uActivity);

  // Posterize — chunky pixels deserve chunky colors.
  col = floor(col * 8.0) / 8.0;

  float alpha = step(d, 1.0) * step(abs(c.y), 1.0);
  gl_FragColor = vec4(col * (0.3 + uActivity * 0.7), alpha);
}
`;

const SHARD_ORBITS = [
  { r: 1.05, y: 0.3, speed: 0.55, size: 0.16, phase: 0.0 },
  { r: 1.25, y: -0.5, speed: -0.4, size: 0.11, phase: 1.7 },
  { r: 0.95, y: 0.95, speed: 0.7, size: 0.09, phase: 3.1 },
  { r: 1.35, y: 0.1, speed: -0.62, size: 0.13, phase: 4.2 },
  { r: 1.1, y: -1.0, speed: 0.48, size: 0.1, phase: 5.3 },
  { r: 1.5, y: 0.65, speed: 0.35, size: 0.07, phase: 2.4 },
];

/** Visuals only — interaction, prompts and light sources stay with the owner
 * (world/props.tsx#Portal). `activity` runs 0 (sealed) to 1 (open). */
export function RiftPortal({ color, activity }: { color: string; activity: number }) {
  const shards = useRef<Group>(null);
  const activitySmooth = useRef(activity);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uTime: { value: 0 },
          uActivity: { value: activity },
          uSeed: { value: Math.random() * 37 },
          uColor: { value: new Color(color) },
        },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useFrame(({ clock }, dt) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uColor.value.set(color);
    activitySmooth.current += (activity - activitySmooth.current) * Math.min(1, dt * 3);
    material.uniforms.uActivity.value = activitySmooth.current;
    const g = shards.current;
    if (g) {
      const t = clock.elapsedTime * (0.3 + activitySmooth.current * 0.7);
      g.children.forEach((shard, i) => {
        const o = SHARD_ORBITS[i];
        const a = t * o.speed + o.phase;
        shard.position.set(Math.cos(a) * o.r, o.y + Math.sin(a * 1.7) * 0.12, Math.sin(a) * 0.35);
        shard.rotation.set(a * 1.3, a * 0.9, a * 0.7);
      });
    }
  });

  return (
    <group>
      {/* The tear itself — high segment count so the vertex wobble reads. */}
      <mesh material={material}>
        <planeGeometry args={[2.2, 3.2, 20, 28]} />
      </mesh>
      {/* Splinters of reality caught in the wound's pull. */}
      <group ref={shards}>
        {SHARD_ORBITS.map((o, i) => (
          <mesh key={i} scale={o.size}>
            <tetrahedronGeometry args={[1, 0]} />
            <meshStandardMaterial
              color="#100c18"
              emissive={color}
              emissiveIntensity={0.7}
              flatShading
              roughness={0.4}
              metalness={0.3}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}
