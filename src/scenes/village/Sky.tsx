import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { AdditiveBlending, DoubleSide, type Group, PlaneGeometry, Quaternion } from "three";
import { hash2 } from "../../render/textures/pixelKit";
import { hillsCrest, MOON_ANGULAR_RADIUS, MOON_ELEVATION, NORTH, RANGE_INNER, RANGE_OUTER, rangeHeight } from "./skyline";

/** The valley's night sky, drawn as pixel art on the world's chunky pixels,
 * and drawn at INFINITY: the whole backdrop rides along with the eye (it
 * moves with the camera, never turns with it), so however far you walk the
 * sky never comes closer, never clips, and the mountains stay as huge as
 * mountains are.
 *
 *  - a gradient dome, banded into a few tones with an ordered dither, glowing
 *    toward the moon and along the horizon beneath it;
 *  - the Milky Way: a broad band of dithered star-dust with dark lanes;
 *  - stars as single pixels, in a few temperatures, twinkling in hard steps
 *    (the brightest little crosses), drowned out near the moon;
 *  - long banks of cloud low over the hills, their tops lined with moonlight;
 *  - a great full moon, low in the north — right behind the gate as you come
 *    up the lane — rising out of the saddle between two titan peaks, bright
 *    enough to bloom, in a wide soft glow;
 *  - three ranges of mountains (skyline.ts): the far one snow-capped and
 *    hazed blue, its crests rimmed with moonlight; the mid one darker; the
 *    near hills black and fringed with pines; all dissolving at their feet
 *    into the valley's mist;
 *  - now and then a shooting star.
 *
 * Unlit, fog-free meshes that write no depth, drawn first: everything in
 * the world draws over them. */

export const MOON_DIR = new Vector3(
  Math.cos(MOON_ELEVATION) * Math.cos(NORTH),
  Math.sin(MOON_ELEVATION),
  Math.cos(MOON_ELEVATION) * Math.sin(NORTH),
).normalize();
/** Horizon colour: the fog and the clear colour match it, so the distance
 * dissolves into sky instead of into black. */
export const HORIZON = "#1a2244";
/** The galaxy's plane (its band is the great circle around this axis). */
const MILKY_N = new Vector3(0.62, 0.35, 0.7).normalize();

/** Backdrop distances from the eye (all well inside the camera's far
 * plane; their draw order, not their depth, layers them). */
const DOME_R = 100;
const STAR_R = 96;
const MOON_D = 90;
const MOON_R = MOON_D * Math.tan(MOON_ANGULAR_RADIUS);
const RIDGE_R = 85;
/** The halo square's half-width, in moon radii. */
const HALO_SPAN = 7;
/** The light the great range is modelled by: the moon's, from behind it,
 * swung round to the side and up so it rakes across the faces. */
const RANGE_KEY = (() => {
  const east = new Vector3().crossVectors(MOON_DIR, new Vector3(0, 1, 0)).normalize();
  return new Vector3().addScaledVector(MOON_DIR, 0.5).addScaledVector(east, 1.0).add(new Vector3(0, 0.55, 0)).normalize();
})();
/** Where its sun shines from: almost straight from behind you — a full
 * moon, a sliver of shade along its lower left. */
const MOON_SUN = (() => {
  const right = new Vector3().crossVectors(MOON_DIR, new Vector3(0, 1, 0)).normalize();
  const up = new Vector3().crossVectors(right, MOON_DIR).normalize();
  return new Vector3().addScaledVector(MOON_DIR, -1).addScaledVector(right, 0.22).addScaledVector(up, 0.18).normalize();
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
    depthTest: false,
    fog: false,
    uniforms: {
      uHorizon: { value: new Color(HORIZON) },
      uZenith: { value: new Color("#03040b") },
      uMoon: { value: MOON_DIR },
      uMoonGlow: { value: new Color("#5a6cb8") },
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
        // The moon's glow: wide and smooth (any ring around it reads as an
        // outline) — a broad wash, a brighter heart, the air right round it
        // white — and a band of lit haze along the horizon beneath it.
        float md = max(dot(d, uMoon), 0.0);
        float mg = 0.5 * pow(md, 6.0) + 0.45 * pow(md, 36.0) + 0.3 * pow(md, 600.0);
        vec3 mflat = normalize(vec3(uMoon.x, 0.0, uMoon.z));
        float under = pow(max(dot(normalize(vec3(d.x, 0.0, d.z) + 1e-5), mflat), 0.0), 3.0);
        mg += 0.12 * under * exp(-h * 14.0);
        c += uMoonGlow * mg + (dith - 0.5) / 255.0 * 3.0;

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
    pos.push(v.x * STAR_R, v.y * STAR_R, v.z * STAR_R);
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
    uniforms: { uTime: { value: 0 }, uMoon: { value: MOON_DIR } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute vec3 aColor;
      attribute float aPhase;
      uniform float uTime;
      uniform vec3 uMoon;
      varying vec3 vColor;
      varying float vSize;
      void main() {
        vec3 dir = normalize(position);
        // Dimmer toward the horizon (more air between), twinkling in steps.
        float air = smoothstep(0.0, 0.35, dir.y);
        float tw = 0.75 + 0.25 * sin(uTime * (1.3 + fract(aPhase) * 2.5) + aPhase);
        tw = floor(tw * 4.0 + 0.5) / 4.0;
        // The moon's glare drowns the stars around it.
        float glare = smoothstep(0.985, 0.93, dot(dir, uMoon));
        vColor = aColor * tw * (0.35 + 0.65 * air) * glare;
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
    depthTest: false,
    fog: false,
    toneMapped: false,
  });
  return { geometry, material };
}

/** The moon: a real sphere, drawn at the world's own pixels — a clean round
 * edge and a simple face in a few tones, like the rest of the world: broad
 * dark seas, a handful of big craters (bowls with raised rims, their relief
 * picked out by a sun over your shoulder so the ones along the terminator
 * read), a flat bright lit face (Lommel–Seeliger, not Lambert) and a faint
 * earthshine on the dark side. */
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
              if (r.z < 0.6) continue; // most cells have none
              vec3 center = cell + 0.2 + r * 0.6;
              float rad = 0.22 + 0.25 * r.y;
              float d = length(q - center) / rad;
              if (d < 1.0) h -= (1.0 - d * d) * depth;
              h += exp(-pow((d - 1.0) / 0.22, 2.0)) * depth * 0.45;
            }
        return h;
      }
      float maria(vec3 p) { return smoothstep(0.48, 0.58, fbm(p * 1.2 + 3.1)); }
      float height(vec3 p) {
        return craters(p, 2.4, 0.05) * (1.0 - 0.6 * maria(p));
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
        vec3 nf = normalize(n - t1 * (h1 - h0) / e * 0.7 - t2 * (h2 - h0) / e * 0.7);
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
        // Albedo: bright highlands, dark seas, darker crater floors.
        float alb = mix(0.86, 0.62, maria(n)) + clamp(h0 * 1.5, -0.08, 0.05);
        float k = alb * lit;
        // A few dithered tones of brightness, like the rest of the world —
        // stepped as one value, so shadows stay grey rather than speckling
        // into colour — over a faint earthshine on the dark side.
        float lv = 4.0;
        float kq = floor(clamp(k, 0.0, 1.2) * lv + bayer4(gl_FragCoord.xy) * 0.5) / lv;
        vec3 col = vec3(0.035, 0.04, 0.055) + vec3(1.0, 0.97, 0.9) * kq;
        // Seen through a long way of night air: a little of the sky's blue
        // in it, its seas a little paler — that's what makes it far. Bright
        // enough to bloom.
        col = mix(col, vec3(0.62, 0.7, 0.95), 0.16);
        gl_FragColor = vec4(col * 0.86, 1.0);
        #include <colorspace_fragment>
      }`,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
  });
}

/** The moon's halo: a camera-facing square, additive, drawn just after the
 * moon — a bright glow hugging the limb (softening it into the air, which is
 * what makes a moon look far), a wide wash beyond, smooth all the way out:
 * no rings, no outline. Distances in moon radii. */
function haloMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color("#c2ceff") }, uSpan: { value: HALO_SPAN } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uSpan;
      varying vec2 vUv;
      ${NOISE}
      void main() {
        float rm = length(vUv - 0.5) * 2.0 * uSpan; // moon radii from the centre
        float k;
        if (rm < 1.0) {
          // On the disc: only a soft brightening toward the limb.
          k = 0.1 * smoothstep(0.75, 1.0, rm);
        } else {
          float o = rm - 1.0;
          k = 0.9 * exp(-o * 4.0) + 0.32 * exp(-o * 1.0) + 0.12 * exp(-o * 0.35);
        }
        k *= 1.0 - smoothstep(uSpan * 0.8, uSpan, rm);
        k += (bayer4(gl_FragCoord.xy) - 0.5) / 255.0 * 4.0;
        gl_FragColor = vec4(uColor * max(k, 0.0), 1.0);
      }`,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
  });
}

/** The great range (skyline.rangeHeight) as a mesh: a polar grid round the
 * eye, its triangles ordered from the outermost ring in — drawn without
 * depth, the nearer ridges simply paint over the farther, as from the
 * middle of a heightfield they always stand in front. Flat-shaded: every
 * facet one tone, like hewn rock at the world's pixels. */
function rangeGeometry(): BufferGeometry {
  const A = 600;
  const R = 40;
  const verts: number[] = [];
  const at = (i: number, j: number) => {
    const a = ((i % A) / A) * Math.PI * 2;
    const r = RANGE_INNER + ((RANGE_OUTER - RANGE_INNER) * j) / R;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    return [x, rangeHeight(x, z), z];
  };
  const grid: number[][][] = [];
  for (let j = 0; j <= R; j++) {
    const row: number[][] = [];
    for (let i = 0; i < A; i++) row.push(at(i, j));
    grid.push(row);
  }
  // Outermost ring first.
  for (let j = R - 1; j >= 0; j--) {
    for (let i = 0; i < A; i++) {
      const a = grid[j]![i]!;
      const b = grid[j]![(i + 1) % A]!;
      const c = grid[j + 1]![i]!;
      const d = grid[j + 1]![(i + 1) % A]!;
      verts.push(...a, ...c, ...b, ...b, ...c, ...d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(verts), 3));
  g.computeVertexNormals();
  return g;
}

/** The range's look: dark rock and snow on the gentle high faces, lit from
 * behind by the moon (the crests and every face turned to it catch a cold
 * rim) and from above by the sky; then the air — the farther the ridge the
 * deeper it sinks into the blue haze, the valley's mist pooled at its feet,
 * the haze glowing toward the moon so the ranges stand dark against it. */
function rangeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    side: DoubleSide,
    uniforms: {
      uMoon: { value: MOON_DIR },
      uKey: { value: RANGE_KEY },
      uHaze: { value: new Color("#222c58") },
      uMoonGlow: { value: new Color("#5a6cb8") },
      // Albedos, not display colours: dark rock, bright snow.
      uRock: { value: new Color("#4a5270") },
      uSnow: { value: new Color("#dce4ff") },
      // Light: the night sky's blue, from above.
      uSky: { value: new Color("#2c3668") },
      uInner: { value: RANGE_INNER },
      uOuter: { value: RANGE_OUTER },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      varying vec3 vN;
      void main() {
        vPos = position;
        vN = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uMoon;
      uniform vec3 uKey;
      uniform vec3 uHaze;
      uniform vec3 uMoonGlow;
      uniform vec3 uRock;
      uniform vec3 uSnow;
      uniform vec3 uSky;
      uniform float uInner;
      uniform float uOuter;
      varying vec3 vPos;
      varying vec3 vN;
      ${NOISE}
      void main() {
        vec3 n = normalize(vN);
        // Faces must face the eye (the grid's winding varies).
        if (dot(n, -vPos) < 0.0) n = -n;
        vec3 d = normalize(vPos);
        float dith = bayer4(gl_FragCoord.xy);
        float r = length(vPos.xz);
        float md = max(dot(d, uMoon), 0.0);
        // Snow on the high faces gentle enough to hold it, ragged at its line.
        float line = 6.0 + (fbm(vPos * 0.12) - 0.5) * 10.0;
        float snow = step(line, vPos.y) * smoothstep(0.28, 0.5, n.y);
        vec3 alb = mix(uRock, uSnow, snow);
        // The moonlight rakes across the range from behind and to the side,
        // so every ridge has a lit flank and a shadowed one; the sky lights
        // whatever faces up.
        float key = max(dot(n, uKey), 0.0);
        float sky = 0.15 + 0.85 * clamp(n.y, 0.0, 1.0);
        vec3 c = alb * (uSky * sky + vec3(0.62, 0.7, 0.95) * key * 0.75);
        // A few tones, stepped where the eye sees steps (gamma, not linear:
        // linear steps would swallow every dark face whole).
        vec3 g = pow(max(c, 0.0), vec3(1.0 / 2.2));
        g = floor(g * 12.0 + dith) / 12.0;
        c = pow(g, vec3(2.2));
        // The air between: deeper with distance, thick low down, glowing
        // toward the moon (less than the open sky — the ranges stand dark).
        vec3 haze = uHaze + uMoonGlow * 0.12 * pow(md, 6.0);
        float far = smoothstep(uInner, uOuter, r);
        // Backlit against the moon, the faces turned from it go darker still.
        float hz = (0.06 + 0.42 * far) * (1.0 - 0.45 * pow(md, 10.0));
        hz = max(hz, smoothstep(2.0, -6.0, vPos.y) * 0.95);
        c = mix(c, haze, floor(clamp(hz, 0.0, 1.0) * 10.0 + dith) / 10.0);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
}

/** The near hills at infinity: a strip round the eye from below the horizon
 * up to their crest (skyline.hillsCrest), each column carrying its crest
 * height so the shader knows how far below the ridgeline it is. */
function ridge(columns: number): BufferGeometry {
  const n = columns;
  const pos = new Float32Array((n + 1) * 2 * 3);
  const crest = new Float32Array((n + 1) * 2);
  const idx: number[] = [];
  const foot = -Math.tan((12 * Math.PI) / 180) * RIDGE_R;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const y = Math.tan(hillsCrest(a)) * RIDGE_R;
    const x = Math.cos(a) * RIDGE_R;
    const z = Math.sin(a) * RIDGE_R;
    pos.set([x, foot, z, x, y, z], i * 6);
    crest.set([y, y], i * 2);
    if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("aCrest", new BufferAttribute(crest, 1));
  g.setIndex(idx);
  return g;
}

interface RidgeLook {
  rock: string;
  /** How much of the valley's haze lies over the whole range (0…1). */
  haze: number;
  /** Snow on the peaks above this elevation (degrees; Infinity: none). */
  snow: number;
  /** Moonlight on the crests nearest the moon. */
  rim: number;
}

/** A range's material: dark rock with faint gullies, snow on the high far
 * peaks, the valley's mist rising over its feet (blue, glowing toward the
 * moon), and the crests by the moon rimmed with light — all in a few
 * dithered tones. */
function ridgeMaterial(look: RidgeLook): ShaderMaterial {
  return new ShaderMaterial({
    side: DoubleSide,
    uniforms: {
      uRock: { value: new Color(look.rock) },
      uSnowCol: { value: new Color("#4c5884") },
      uHaze: { value: new Color(HORIZON) },
      uMoonGlow: { value: new Color("#5a6cb8") },
      uMoon: { value: MOON_DIR },
      uHazeAmt: { value: look.haze },
      uSnow: { value: (look.snow * Math.PI) / 180 },
      uRim: { value: look.rim },
    },
    vertexShader: /* glsl */ `
      attribute float aCrest;
      varying vec3 vPos;
      varying float vCrest;
      void main() {
        vPos = position;
        vCrest = aCrest;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uRock;
      uniform vec3 uSnowCol;
      uniform vec3 uHaze;
      uniform vec3 uMoonGlow;
      uniform vec3 uMoon;
      uniform float uHazeAmt;
      uniform float uSnow;
      uniform float uRim;
      varying vec3 vPos;
      varying float vCrest;
      ${NOISE}
      void main() {
        vec3 d = normalize(vPos);
        float dith = bayer4(gl_FragCoord.xy);
        float r = length(vPos.xz);
        float el = atan(vPos.y, r);
        float below = atan(vCrest, r) - el; // radians under the ridgeline
        float az = atan(d.z, d.x);
        float md = max(dot(d, uMoon), 0.0);
        // Rock, with gullies running down from the crest.
        float gully = fbm(vec3(az * 60.0, el * 18.0, 0.0));
        vec3 c = uRock * (0.75 + 0.5 * floor(gully * 3.0 + dith) / 3.0);
        // Snow on the high peaks, in the gullies, ragged at its line — in
        // shadow (the moon is behind the range), so blue-grey, not white.
        float line = uSnow + (fbm(vec3(az * 40.0, el * 30.0, 4.0)) - 0.5) * 0.04;
        if (el > line && gully > 0.48) {
          float s = floor(clamp((gully - 0.48) * 4.0 + (el - line) * 12.0, 0.0, 1.0) * 3.0 + dith) / 3.0;
          c = mix(c, uSnowCol, s);
        }
        // The valley's mist: over the whole range a little, thick at its feet;
        // lit from within toward the moon.
        // (Less glow than the open sky: the ranges stand dark against it.)
        vec3 haze = uHaze + uMoonGlow * 0.3 * pow(md, 8.0);
        float mist = uHazeAmt + (1.0 - uHazeAmt) * smoothstep(0.05, -0.02, el);
        c = mix(c, haze, floor(clamp(mist, 0.0, 1.0) * 6.0 + dith) / 6.0);
        // Moonlight catching the crests nearest the moon (they're backlit).
        float rim = smoothstep(0.007, 0.0, below) * pow(md, 90.0) * uRim;
        c += vec3(0.55, 0.62, 0.95) * floor(rim * 3.0 + dith) / 3.0;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
}

const tmpA = new Vector3();
const tmpB = new Vector3();

/** Draw order of the backdrop's layers (all before the world). */
const ORDER = { dome: -20, stars: -19, moon: -18, halo: -17, range: -16, near: -14 } as const;

export function Sky() {
  const res = useMemo(() => {
    const stars = starField(2600);
    return {
      dome: new SphereGeometry(DOME_R, 32, 16),
      domeMat: skyMaterial(),
      starGeo: stars.geometry,
      starMat: stars.material,
      range: rangeGeometry(),
      rangeMat: rangeMaterial(),
      near: ridge(2400),
      nearMat: ridgeMaterial({ rock: "#04060d", haze: 0.06, snow: Infinity, rim: 0.6 }),
      moon: new SphereGeometry(MOON_R, 64, 48),
      moonMat: moonMaterial(MOON_SUN),
      halo: new PlaneGeometry(MOON_R * HALO_SPAN * 2, MOON_R * HALO_SPAN * 2),
      haloMat: haloMaterial(),
    };
  }, []);
  const points = useMemo(() => {
    const p = new Points(res.starGeo, res.starMat);
    p.frustumCulled = false;
    p.renderOrder = ORDER.stars;
    return p;
  }, [res]);
  useEffect(
    () => () => {
      for (const r of Object.values(res)) r.dispose();
    },
    [res],
  );
  const rig = useRef<Group>(null);
  const moonPos = useMemo(() => MOON_DIR.clone().multiplyScalar(MOON_D), []);
  // Facing the eye: the halo square's normal (+z) turned back along the
  // moon's direction (the eye is always at the rig's origin).
  const moonFacing = useMemo(() => new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), MOON_DIR.clone().negate()), []);
  // Shooting stars: one every 7–18 s, across 0.7 s.
  const meteor = useMemo(() => ({ next: 4, start: -10, a: new Vector3(), b: new Vector3() }), []);
  useFrame(({ clock, camera }) => {
    // At infinity: the backdrop goes wherever the eye goes.
    rig.current?.position.copy(camera.position);
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
    <group ref={rig}>
      <mesh geometry={res.dome} material={res.domeMat} renderOrder={ORDER.dome} frustumCulled={false} />
      <primitive object={points} />
      {/* Moon and halo face the eye (the rig's origin). */}
      <group position={moonPos} quaternion={moonFacing}>
        <mesh geometry={res.halo} material={res.haloMat} renderOrder={ORDER.halo} frustumCulled={false} />
        <mesh geometry={res.moon} material={res.moonMat} renderOrder={ORDER.moon} frustumCulled={false} />
      </group>
      <mesh geometry={res.range} material={res.rangeMat} renderOrder={ORDER.range} frustumCulled={false} />
      <mesh geometry={res.near} material={res.nearMat} renderOrder={ORDER.near} frustumCulled={false} />
    </group>
  );
}
