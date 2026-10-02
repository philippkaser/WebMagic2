import { useFrame } from "@react-three/fiber";
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
  NearestFilter,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { hash2 } from "../../render/textures/pixelKit";

/** The village night sky, drawn as pixel art on the world's chunky pixels:
 *
 *  - a moonlit gradient dome, banded into a few tones with an ordered
 *    dither between them (no smooth gradient anywhere);
 *  - the Milky Way: a broad band of dithered star-dust with dark lanes of
 *    dust through it, faint at the horizon;
 *  - stars as single pixels (Points: they stay crisp and steady as you
 *    turn) — thousands, denser along the band, in a few temperatures from
 *    blue-white to ember; each twinkles in hard steps, and the brightest
 *    are little crosses;
 *  - long banks of cloud low over the hills, dark against the sky, their
 *    tops lined with moonlight on the moon's side, drifting slowly;
 *  - the moon — a real sphere at the world's pixels, its craters lit by a
 *    sun over your shoulder (moonMaterial) — in a stepped halo;
 *  - now and then a shooting star;
 *  - two ridges of mountain silhouette, the far one faintly moonlit.
 *
 * Unlit, fog-free backdrop meshes drawn behind everything. */

export const MOON_DIR = new Vector3(0.45, 0.42, -0.79).normalize();
/** Horizon colour: the fog and the clear colour match it, so the distance
 * dissolves into sky instead of into black. */
export const HORIZON = "#1a2244";
/** The galaxy's plane (its band is the great circle around this axis). */
const MILKY_N = new Vector3(0.62, 0.35, 0.7).normalize();

/** The moon's radius at its 100 m distance (about 13° across). */
const MOON_R = 11.5;
/** Where its sun shines from: over your shoulder and to the upper right as
 * seen from the village — a gibbous moon, the terminator on its lower left. */
const MOON_SUN = (() => {
  const right = new Vector3().crossVectors(MOON_DIR, new Vector3(0, 1, 0)).normalize();
  const up = new Vector3().crossVectors(right, MOON_DIR).normalize();
  return new Vector3().addScaledVector(MOON_DIR, -0.45).addScaledVector(right, 0.8).addScaledVector(up, 0.35).normalize();
})();

const NOISE = /* glsl */ `
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * noise3(p); p *= 2.07; a *= 0.5; }
  return s;
}
float bayer4(vec2 c) {
  vec2 m = mod(floor(c), 4.0);
  int i = int(m.x) + int(m.y) * 4;
  float b[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (b[i] + 0.5) / 16.0;
}
`;

function skyMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uHorizon: { value: new Color(HORIZON) },
      uZenith: { value: new Color("#03040b") },
      uMoon: { value: MOON_DIR },
      uMoonGlow: { value: new Color("#3a4a80") },
      uBand: { value: new Color("#8f86d8") },
      uMilky: { value: MILKY_N },
      uTime: { value: 0 },
      uMeteorA: { value: new Vector3(0, 1, 0) },
      uMeteorB: { value: new Vector3(0, 1, 0) },
      uMeteorK: { value: 0 },
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
      uniform vec3 uBand;
      uniform vec3 uMilky;
      uniform float uTime;
      uniform vec3 uMeteorA;
      uniform vec3 uMeteorB;
      uniform float uMeteorK;
      varying vec3 vDir;
      ${NOISE}
      void main() {
        vec3 d = normalize(vDir);
        float dith = bayer4(gl_FragCoord.xy);
        float h = clamp(d.y, 0.0, 1.0);
        // The dome in seven dithered bands, horizon to zenith.
        float t = pow(h, 0.45);
        float q = floor(t * 7.0 + dith) / 7.0;
        vec3 c = mix(uHorizon, uZenith, clamp(q, 0.0, 1.0));
        // The moon's glow in stepped rings.
        float mg = pow(max(dot(d, uMoon), 0.0), 14.0);
        c += uMoonGlow * floor(mg * 5.0 + dith) / 5.0 * 0.7;

        // The Milky Way: star-dust in a band, cut by dark lanes.
        float off = dot(d, uMilky);
        float band = exp(-off * off / 0.03);
        float dust = band * smoothstep(0.35, 0.85, fbm(d * 5.0 + 1.7));
        float lane = band * smoothstep(0.52, 0.66, fbm(d * 11.0 + 7.3)) * smoothstep(0.08, 0.0, abs(off - 0.02));
        float mw = clamp(dust - lane * 0.9, 0.0, 1.0) * smoothstep(0.02, 0.3, h);
        c += uBand * floor(mw * 4.0 + dith) / 4.0 * 0.22;

        // Banks of stratus low over the hills: long and thin, darker than the
        // sky behind them, their upper edges lined with moonlight on the
        // moon's side. They drift.
        vec3 cp = vec3(d.x * 1.7 + uTime * 0.006, d.y * 15.0, d.z * 1.7 - uTime * 0.004);
        float bank = smoothstep(0.34, 0.54, fbm(vec3(d.x * 1.1, 0.0, d.z * 1.1) + 3.1));
        float low = smoothstep(0.08, 0.13, h) * (1.0 - smoothstep(0.22, 0.36, h));
        float cl = fbm(cp) * bank * low;
        float cloud = smoothstep(0.26, 0.42, cl);
        if (cloud > 0.6 || (cloud > 0.1 && dith < cloud * 1.6)) {
          vec3 mh = normalize(vec3(uMoon.x, 0.0, uMoon.z));
          float toward = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), mh), 0.0), 4.0);
          // Thinner just above → this pixel is on the cloud's lit top.
          float above = fbm(cp + vec3(0.0, 0.5, 0.0)) * bank * low;
          float lit = clamp((cl - above) * 7.0, 0.0, 1.0);
          vec3 body = c * 0.42 + vec3(0.008, 0.01, 0.024);
          vec3 rim = mix(vec3(0.1, 0.11, 0.2), vec3(0.4, 0.44, 0.66), toward);
          float lv = floor(lit * 3.0 + dith) / 3.0;
          c = mix(body, rim, lv);
        }

        // A shooting star: a bright head and a tail that fades, in pixels.
        if (uMeteorK > 0.0) {
          vec3 ab = uMeteorB - uMeteorA;
          float k = clamp(dot(d - uMeteorA, ab) / dot(ab, ab), 0.0, 1.0);
          float dist = length(d - (uMeteorA + ab * k));
          if (dist < 0.0035) c += vec3(0.9, 0.95, 1.0) * uMeteorK * pow(1.0 - k, 1.5);
        }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/** Stars as single pixels: thousands of points on the dome, more of them
 * along the Milky Way, sized 1 (most), 2, or 3 (a cross, the brightest). */
function starField(count: number): { geometry: BufferGeometry; material: ShaderMaterial } {
  const pos: number[] = [];
  const size: number[] = [];
  const color: number[] = [];
  const phase: number[] = [];
  const temps = [
    [0.75, 0.85, 1.0],
    [1.0, 1.0, 1.0],
    [1.0, 0.95, 0.8],
    [1.0, 0.8, 0.6],
  ];
  const v = new Vector3();
  let i = 0;
  let tries = 0;
  while (i < count && tries < count * 20) {
    tries++;
    const u = hash2(tries, 1, 7) * 2 - 1;
    const a = hash2(tries, 2, 7) * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    v.set(r * Math.cos(a), u, r * Math.sin(a));
    if (v.y < 0.02) continue;
    // Twice as likely along the band of the galaxy.
    const off = v.dot(MILKY_N);
    const keep = 0.35 + 0.65 * Math.exp((-off * off) / 0.02);
    if (hash2(tries, 3, 7) > keep) continue;
    pos.push(v.x * 110, v.y * 110, v.z * 110);
    const b = hash2(tries, 4, 7);
    size.push(b > 0.985 ? 3 : b > 0.9 ? 2 : 1);
    const t = temps[Math.floor(hash2(tries, 5, 7) * temps.length)]!;
    const k = 0.45 + 0.55 * hash2(tries, 6, 7);
    color.push(t[0]! * k, t[1]! * k, t[2]! * k);
    phase.push(hash2(tries, 8, 7) * 100);
    i++;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geometry.setAttribute("aSize", new BufferAttribute(new Float32Array(size), 1));
  geometry.setAttribute("aColor", new BufferAttribute(new Float32Array(color), 3));
  geometry.setAttribute("aPhase", new BufferAttribute(new Float32Array(phase), 1));
  const material = new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute vec3 aColor;
      attribute float aPhase;
      uniform float uTime;
      varying vec3 vColor;
      varying float vSize;
      void main() {
        vec3 dir = normalize(position);
        // Dimmer toward the horizon (more air between), twinkling in steps.
        float air = smoothstep(0.0, 0.35, dir.y);
        float tw = 0.75 + 0.25 * sin(uTime * (1.3 + fract(aPhase) * 2.5) + aPhase);
        tw = floor(tw * 4.0 + 0.5) / 4.0;
        vColor = aColor * tw * (0.35 + 0.65 * air);
        vSize = aSize;
        gl_PointSize = aSize;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vSize;
      void main() {
        if (vSize > 2.5) {
          // The brightest: a cross, its heart hot.
          vec2 p = floor(gl_PointCoord * 3.0);
          if (p.x != 1.0 && p.y != 1.0) discard;
          gl_FragColor = vec4(vColor * (p.x == 1.0 && p.y == 1.0 ? 1.6 : 0.7), 1.0);
        } else {
          gl_FragColor = vec4(vColor * (vSize > 1.5 ? 1.2 : 1.0), 1.0);
        }
        #include <colorspace_fragment>
      }`,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  return { geometry, material };
}

/** The moon: a real sphere, drawn at the world's own pixels — a clean round
 * edge, and a surface worth looking at. Its relief is a crater field in
 * two sizes (bowls with raised rims; the dark seas smooth them out) whose
 * normals the sun picks out (no finer than a pixel — finer only speckles),
 * so the craters along the terminator throw
 * long shadows and their far rims catch the light; the lit face is flat
 * and bright the way the real moon is (Lommel–Seeliger, not Lambert); the
 * surface is broken into tiny facets, each tilted at random, so single
 * pixels glint; one young crater sprays bright rays; the dark side keeps a
 * faint blue earthshine. Tones step in a few dithered levels. */
function moonMaterial(sun: Vector3): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uSun: { value: sun } },
    vertexShader: /* glsl */ `
      uniform vec3 uSun;
      varying vec3 vObj;
      varying vec3 vView;
      varying vec3 vSun;
      void main() {
        vObj = normalize(position);
        vec4 w = modelMatrix * vec4(position, 1.0);
        // Light and eye into the sphere's own space (its transform is a
        // rotation: v * M is the inverse rotation).
        mat3 r = mat3(modelMatrix);
        vView = normalize((cameraPosition - w.xyz) * r);
        vSun = normalize(uSun * r);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vObj;
      varying vec3 vView;
      varying vec3 vSun;
      ${NOISE}
      vec3 hash33(vec3 p) {
        return fract(sin(vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
      }
      // One octave of craters: a feature point per cell, a bowl inside its
      // radius, a rim just outside it.
      float craters(vec3 p, float scale, float depth) {
        vec3 q = p * scale;
        vec3 c = floor(q);
        float h = 0.0;
        for (int z = -1; z <= 1; z++)
          for (int y = -1; y <= 1; y++)
            for (int x = -1; x <= 1; x++) {
              vec3 cell = c + vec3(x, y, z);
              vec3 r = hash33(cell);
              if (r.z < 0.35) continue; // not every cell has one
              vec3 center = cell + 0.2 + r * 0.6;
              float rad = 0.22 + 0.25 * r.y;
              float d = length(q - center) / rad;
              if (d < 1.0) h -= (1.0 - d * d) * depth;
              h += exp(-pow((d - 1.0) / 0.22, 2.0)) * depth * 0.45;
            }
        return h;
      }
      float maria(vec3 p) { return smoothstep(0.5, 0.62, fbm(p * 1.6 + 3.1)); }
      float height(vec3 p) {
        float soft = 1.0 - 0.75 * maria(p);
        return craters(p, 3.0, 0.07) + craters(p, 6.5, 0.035) * soft + fbm(p * 9.0) * 0.01;
      }
      void main() {
        vec3 n = normalize(vObj);
        // Bumped normal from the height field (object space).
        vec3 t1 = normalize(cross(n, abs(n.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
        vec3 t2 = cross(n, t1);
        // About a pixel across: finer relief would only alias into speckle.
        float e = 0.03;
        float h0 = height(n);
        float h1 = height(normalize(n + t1 * e));
        float h2 = height(normalize(n + t2 * e));
        vec3 nb = normalize(n - t1 * (h1 - h0) / e * 1.2 - t2 * (h2 - h0) / e * 1.2);
        // Tiny facets, each tilted at random: single pixels catch the sun.
        vec3 cell = floor(n * 40.0);
        vec3 jit = hash33(cell) - 0.5;
        vec3 nf = normalize(nb + jit * 0.1);
        vec3 V = normalize(vView);
        vec3 S = normalize(vSun);
        float ci = max(dot(nf, S), 0.0);
        float ce = max(dot(n, V), 0.05);
        // Flat and bright across the lit face, falling away at the terminator.
        float ls = ci / (ci + ce);
        float lit = mix(ci, ls * 2.0, 0.4);
        // Only the sunward half is lit: the relief shades within it, never
        // speckles the night side.
        lit *= smoothstep(-0.03, 0.1, dot(n, S));
        // Albedo: bright highlands, dark seas, bright crater rims.
        float m = maria(n);
        float alb = mix(0.84, 0.42, m) + clamp(h0 * 3.0, -0.14, 0.12);
        // One young crater with bright rays.
        vec3 ty = normalize(vec3(-0.25, -0.55, 0.8));
        float dt = acos(clamp(dot(n, ty), -1.0, 1.0));
        float ang = atan(dot(n - ty, cross(ty, vec3(0.0, 1.0, 0.0))), dot(n - ty, vec3(0.0, 1.0, 0.0)));
        float rays = step(0.86, noise3(vec3(ang * 7.0, 0.0, 1.0))) * smoothstep(0.9, 0.08, dt);
        alb += rays * 0.18 + (dt < 0.05 ? 0.2 : 0.0);
        float k = alb * lit;
        // A facet turned just so: a glint.
        vec3 hv = normalize(S + V);
        k += pow(max(dot(nf, hv), 0.0), 220.0) * 0.5 * step(0.25, dot(n, S));
        // A few dithered tones of brightness, like the rest of the world —
        // stepped as one value, so shadows stay grey rather than speckling
        // into colour — over a faint earthshine on the dark side.
        float lv = 8.0;
        float kq = floor(clamp(k, 0.0, 1.2) * lv + bayer4(gl_FragCoord.xy) * 0.7) / lv;
        vec3 col = vec3(0.035, 0.04, 0.055) + vec3(1.0, 0.97, 0.9) * kq;
        gl_FragColor = vec4(col * 0.78, 1.0);
        #include <colorspace_fragment>
      }`,
    fog: false,
    toneMapped: false,
  });
}

/** Jagged ring of peaks: a triangle strip from y = −2 up to a noisy crest. */
function ridge(radius: number, base: number, amp: number, seed: number): BufferGeometry {
  const n = 160;
  const pos = new Float32Array((n + 1) * 2 * 3);
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = i % n;
    const crest =
      base +
      amp * (0.55 * Math.abs(Math.sin(a * 3 + seed)) + 0.3 * Math.abs(Math.sin(a * 7.3 + seed * 2)) + 0.15 * hash2(k, 0, seed));
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

/** A ridge's material: dark, and — for the far one — a moonlit band along
 * its crest where it faces the moon. */
function ridgeMaterial(color: string, moonlit: number): ShaderMaterial {
  return new ShaderMaterial({
    side: DoubleSide,
    fog: false,
    uniforms: { uColor: { value: new Color(color) }, uMoon: { value: MOON_DIR }, uLit: { value: moonlit } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vWorld = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uMoon;
      uniform float uLit;
      varying vec3 vWorld;
      void main() {
        float toward = max(dot(normalize(vec3(vWorld.x, 0.0, vWorld.z)), normalize(vec3(uMoon.x, 0.0, uMoon.z))), 0.0);
        float hgt = clamp((vWorld.y + 2.0) / 22.0, 0.0, 1.0);
        float k = floor(hgt * toward * toward * 3.0) / 3.0;
        gl_FragColor = vec4(uColor * (1.0 + k * uLit), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/** The moon's halo: concentric bands of pale blue, painted as pixels. */
function haloTexture(): CanvasTexture {
  const S = 32;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const r = Math.hypot(x - S / 2 + 0.5, y - S / 2 + 0.5) / (S / 2);
      const v = Math.floor(Math.max(0, 1 - r) ** 2.2 * 6) / 6;
      const i = (y * S + x) * 4;
      img.data[i] = 150 * v;
      img.data[i + 1] = 170 * v;
      img.data[i + 2] = 255 * v;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  return t;
}

const tmpA = new Vector3();
const tmpB = new Vector3();

export function Sky() {
  const res = useMemo(() => {
    const stars = starField(2600);
    return {
      dome: new SphereGeometry(120, 32, 16),
      domeMat: skyMaterial(),
      starGeo: stars.geometry,
      starMat: stars.material,
      far: ridge(95, 6, 16, 1.7),
      farMat: ridgeMaterial("#0b0f22", 1.4),
      near: ridge(72, 1, 9, 4.2),
      nearMat: ridgeMaterial("#05070f", 0.5),
      moon: new SphereGeometry(MOON_R, 64, 48),
      moonMat: moonMaterial(MOON_SUN),
      halo: new PlaneGeometry(MOON_R * 4.4, MOON_R * 4.4),
      haloMat: new MeshBasicMaterial({
        map: haloTexture(),
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    };
  }, []);
  const points = useMemo(() => {
    const p = new Points(res.starGeo, res.starMat);
    p.frustumCulled = false;
    p.renderOrder = -1.5;
    return p;
  }, [res]);
  useEffect(
    () => () => {
      for (const r of Object.values(res)) r.dispose();
      res.haloMat.map?.dispose();
    },
    [res],
  );
  const moonPos = useMemo(() => MOON_DIR.clone().multiplyScalar(100), []);
  // Shooting stars: one every 7–18 s, across 0.7 s.
  const meteor = useMemo(() => ({ next: 4, start: -10, a: new Vector3(), b: new Vector3() }), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const u = res.domeMat.uniforms;
    u.uTime!.value = t;
    res.starMat.uniforms.uTime!.value = t;
    if (t > meteor.next) {
      meteor.start = t;
      meteor.next = t + 7 + Math.random() * 11;
      const az = Math.random() * Math.PI * 2;
      const el = 0.45 + Math.random() * 0.5;
      meteor.a.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
      const dir = tmpA.set(Math.cos(az + 1.4), -0.55, Math.sin(az + 1.4)).normalize();
      meteor.b.copy(meteor.a).addScaledVector(dir, 0.35).normalize();
    }
    const k = (t - meteor.start) / 0.7;
    if (k >= 0 && k <= 1) {
      // The head runs from a toward b; the tail trails behind it.
      tmpB.copy(meteor.a).lerp(meteor.b, k).normalize();
      tmpA.copy(meteor.a).lerp(meteor.b, Math.max(0, k - 0.35)).normalize();
      (u.uMeteorA!.value as Vector3).copy(tmpB);
      (u.uMeteorB!.value as Vector3).copy(tmpA);
      u.uMeteorK!.value = Math.sin(k * Math.PI);
    } else {
      u.uMeteorK!.value = 0;
    }
  });
  return (
    <group>
      <mesh geometry={res.dome} material={res.domeMat} renderOrder={-2} frustumCulled={false} />
      <primitive object={points} />
      <mesh geometry={res.far} material={res.farMat} renderOrder={-1} />
      <mesh geometry={res.near} material={res.nearMat} renderOrder={-1} />
      <group position={moonPos} onUpdate={(g) => g.lookAt(0, 0, 0)}>
        <mesh geometry={res.halo} material={res.haloMat} position={[0, 0, -MOON_R - 0.5]} />
        <mesh geometry={res.moon} material={res.moonMat} />
      </group>
    </group>
  );
}
