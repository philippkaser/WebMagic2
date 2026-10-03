import { BackSide, Color, DoubleSide, FrontSide, ShaderMaterial, SphereGeometry, Vector2 } from "three";

/** The vitals orbs: a sphere of glass holding a glowing liquid whose level IS
 * the value — real geometry, lit by the UI's torch, in the world's gritty
 * pixel hand.
 *
 * The liquid is a smaller sphere whose fragments above a (tilting,
 * rippling) surface plane are discarded; its BACK faces below the plane are
 * painted as the surface itself — looking down into the orb you see the far
 * inner wall through the cut, and colouring it as the top of the liquid
 * reads exactly like a flat surface (the cutaway-liquid trick, no extra
 * geometry). Its colour is posterized into a few dithered bands on a grid
 * of object-space cells, churned by a swirl and carrying bubbles, so it
 * reads as pixel art up close. Between the level and the "ghost" of a
 * recent loss it fizzes away (gauge.ts).
 *
 * The glass is where the pixels catch the light: its surface is broken
 * into small facets (object-space cells, each tilted a little at random),
 * so besides its main highlight, single cells here and there flash as they
 * turn through the torch's reflection — the orb spins slowly, so they
 * twinkle. A few cells are frosted, a few are clear; the rim glows.
 *
 * Object space: the glass is a unit sphere at the origin. Callers scale. */

let geo: { glass: SphereGeometry; liquid: SphereGeometry } | null = null;

export function orbGeometry() {
  return (geo ??= { glass: new SphereGeometry(1, 40, 28), liquid: new SphereGeometry(0.9, 36, 24) });
}

/** Displayed level (0…1) → the liquid's surface height in object space. */
export function levelToHeight(level: number, bottom = -0.88, top = 0.86): number {
  const l = Math.min(1, Math.max(0, level));
  return l <= 0 ? bottom - 0.05 : bottom + (top - bottom) * l;
}

const VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vN;
varying vec3 vView;
void main() {
  vObj = position;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

/** Shared helpers: hashes, value noise, a 4×4 Bayer threshold. */
const COMMON = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 hash3(vec3 p) {
  return fract(sin(vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float bayer4(vec2 c) {
  vec2 m = mod(c, 4.0);
  int i = int(m.x) + int(m.y) * 4;
  float b[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (b[i] + 0.5) / 16.0;
}
`;

const LIQUID_FRAG = /* glsl */ `
uniform float uLevel;
uniform float uGhost;
uniform vec2 uTilt;
uniform float uWave;
uniform float uTime;
uniform float uFlash;
uniform float uBubbles;
uniform float uCells;
uniform vec3 uColor;
uniform vec3 uDeep;
uniform vec3 uHot;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vView;
${COMMON}
void main() {
  // Everything is decided per cell: the liquid is pixel art up close.
  vec3 q = (floor(vObj * uCells) + 0.5) / uCells;
  vec2 dc = floor(vObj.xy * uCells) + floor(vObj.z * uCells) * 7.0;
  float ripple = uWave * 0.09 * (sin(q.x * 7.0 + uTime * 6.3) * 0.6 + sin(q.z * 6.0 - uTime * 5.1) * 0.4);
  float lean = dot(uTilt, q.xz) + ripple + 0.012 * sin(uTime * 1.7 + q.x * 3.0);
  float surf = uLevel + lean;
  float ghost = max(uGhost, uLevel) + lean;
  float h = q.y;
  if (h > ghost) discard;
  bool inGhost = h > surf;

  vec3 col;
  float k;
  if (!gl_FrontFacing) {
    // Seen through the cut: paint the far inner wall as the liquid's top.
    if (inGhost) discard;
    float swirl = noise(q.xz * 3.5 + vec2(uTime * 0.35, -uTime * 0.25));
    k = 0.72 + swirl * 0.3;
  } else {
    vec3 V = normalize(-vView);
    vec3 N = normalize(vN);
    float depth = clamp((surf - h) / 1.6, 0.0, 1.0);
    k = mix(0.62, 0.12, smoothstep(0.0, 1.0, depth));
    // Light pooling at the surface and scattering at the glancing edges.
    k += smoothstep(0.12, 0.0, surf - h) * 0.45;
    k += pow(1.0 - abs(dot(N, V)), 2.0) * 0.3;
    // A slow inner churn.
    k += (noise(vec2(atan(q.z, q.x) * 2.0, h * 3.0 - uTime * 0.6)) - 0.5) * 0.28;
    // Bubbles climbing the wall, a cell each.
    float lane = floor(atan(q.z, q.x) * 3.0);
    float rise = fract(h * 1.6 - uTime * (0.35 + uBubbles * 0.9) + hash(vec2(lane, 3.0)));
    if (hash(vec2(lane, 9.0)) < 0.25 + uBubbles * 0.5 && rise < 0.06 && surf - h > 0.08) k += 0.55;
    if (inGhost) {
      // What was just lost fizzes away: pale, crumbling, flickering.
      float n = hash(dc + floor(uTime * 18.0));
      float g = (h - surf) / max(0.001, ghost - surf);
      if (n < 0.25 + g * 0.55) discard;
      k = 1.2;
    }
  }
  // Four dithered bands of the liquid's palette.
  float x = clamp(k, 0.0, 1.2) * 3.0 + (bayer4(dc) - 0.5) * 0.55;
  col = x < 1.0 ? uDeep : x < 2.0 ? mix(uDeep, uColor, 0.55) : x < 3.0 ? uColor : mix(uColor, uHot, 0.45);
  if (inGhost) col = mix(uHot, uColor, 0.3);
  col = mix(col, uHot * 1.4, uFlash * 0.75);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export type LiquidMaterial = ShaderMaterial & {
  uniforms: {
    uLevel: { value: number };
    uGhost: { value: number };
    uTilt: { value: Vector2 };
    uWave: { value: number };
    uTime: { value: number };
    uFlash: { value: number };
    uBubbles: { value: number };
    uCells: { value: number };
    uColor: { value: Color };
    uDeep: { value: Color };
    uHot: { value: Color };
  };
};

export function makeLiquidMaterial(color: string, deep: string, hot = "#fff0d8"): LiquidMaterial {
  return new ShaderMaterial({
    uniforms: {
      uLevel: { value: levelToHeight(0) },
      uGhost: { value: levelToHeight(0) },
      uTilt: { value: new Vector2() },
      uWave: { value: 0 },
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uBubbles: { value: 0.3 },
      uCells: { value: 15 },
      uColor: { value: new Color(color) },
      uDeep: { value: new Color(deep) },
      uHot: { value: new Color(hot) },
    },
    vertexShader: VERT,
    fragmentShader: LIQUID_FRAG,
    side: DoubleSide,
  }) as LiquidMaterial;
}

const GLASS_FRAG = /* glsl */ `
uniform vec3 uTint;
uniform float uFlash;
uniform float uBack;
uniform float uCells;
uniform float uTime;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vView;
${COMMON}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(-vView);
  // Facets: each object-space cell's normal is tipped a little at random,
  // so single cells catch the torch on their own as the orb turns.
  vec3 cell = floor(vObj * uCells);
  vec3 r = hash3(cell);
  vec3 Nf = normalize(N + (r - 0.5) * 0.32);
  float ndv = abs(dot(N, V));
  float fr = pow(1.0 - ndv, 2.4);
  // The UI torch hangs up and to the left of the eye (UiCanvas).
  vec3 L = normalize(vec3(-0.55, 0.65, 0.55));
  vec3 H = normalize(L + V);
  float main = pow(max(dot(N, H), 0.0), 60.0) * 1.5;
  float glint = pow(max(dot(Nf, H), 0.0), 320.0);
  // A cold fill from the right, for a second, smaller sparkle.
  vec3 H2 = normalize(normalize(vec3(0.8, -0.3, 0.5)) + V);
  float glint2 = pow(max(dot(Nf, H2), 0.0), 420.0);
  // Glints are whole cells, on or off (pixel art): threshold, don't blend.
  float g = step(0.5, glint) * 0.95 + step(0.55, glint2) * 0.5;
  // A rare frosted cell.
  float frost = r.x > 0.97 ? 0.05 : 0.0;
  float lit = step(0.6, main) * 1.1 + main * 0.25 + g;
  vec3 col = uTint * (fr * 0.6 + frost) + vec3(1.0, 0.97, 0.92) * lit;
  float a = fr * 0.5 + frost + lit * 0.7 + 0.03;
  col *= uBack;
  a *= uBack;
  col += uTint * uFlash * 0.4;
  gl_FragColor = vec4(col, min(a, 1.0));
  #include <colorspace_fragment>
}
`;

export type GlassMaterial = ShaderMaterial & {
  uniforms: { uTint: { value: Color }; uFlash: { value: number }; uBack: { value: number }; uCells: { value: number }; uTime: { value: number } };
};

/** Front (`back` = false) or the fainter inner back wall (`back` = true). */
export function makeGlassMaterial(tint: string, back: boolean): GlassMaterial {
  return new ShaderMaterial({
    uniforms: { uTint: { value: new Color(tint) }, uFlash: { value: 0 }, uBack: { value: back ? 0.35 : 1 }, uCells: { value: 15 }, uTime: { value: 0 } },
    vertexShader: VERT,
    fragmentShader: GLASS_FRAG,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    side: back ? BackSide : FrontSide,
  }) as GlassMaterial;
}
