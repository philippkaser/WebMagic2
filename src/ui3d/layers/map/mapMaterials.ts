import { AdditiveBlending, Color, ShaderMaterial } from "three";

/** The cast map's materials. The map lies on the floor in the WORLD canvas
 * (depth-tested: walls and wizards stand in front of it), so everything is
 * added light in linear values, bloomed and graded with the world.
 *
 * Tiles and walls are instanced; each instance carries `aBorn`, the uiNow
 * second it appears (the reveal ripples out from where the caster stood),
 * and tiles `aBright` (paths glow brighter). Each grows in (tiles unfold,
 * walls rise) over a quarter second with a white-hot flash. Folding runs
 * the other way: from `uFoldAt`, the light drains back toward the caster —
 * the farthest pieces first (`aDist`, metres from there, of
 * `uDistMax`) — tiles flaring once as they go out, walls sinking into the
 * floor. */

const LIGHT = {
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
  fog: false,
} as const;

/** Floor decals sit a hair above the floor; pull them forward in depth so
 * they never flicker into it. */
const DECAL = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 } as const;

const COMMON = /* glsl */ `
uniform float uTime;
uniform float uFoldAt;
uniform float uDistMax;
attribute float aBorn;
attribute float aDist;
varying float vAge;
varying float vFold;
// 0 standing … 1 gone: the edge goes first, the middle last.
float foldOf() {
  return clamp((uTime - uFoldAt - (uDistMax - aDist) * FOLD_PER_M) / 0.3, 0.0, 1.0);
}
`;

/** Seconds per metre (of the miniature's world) the fold takes to travel
 * in from the edge. */
export const FOLD_PER_M = 0.02;
const DEFINES = { FOLD_PER_M: FOLD_PER_M.toFixed(4) };

const foldUniforms = () => ({ uFoldAt: { value: 1e9 }, uDistMax: { value: 0 } });

export function makeTileMaterial(color: string): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uTime: { value: 0 }, uAlpha: { value: 1 }, ...foldUniforms() },
    defines: DEFINES,
    vertexShader: /* glsl */ `
${COMMON}
attribute float aBright;
varying vec2 vUv;
varying vec3 vWorld;
varying float vBright;
void main() {
  vUv = uv;
  vBright = aBright;
  vAge = uTime - aBorn;
  vFold = foldOf();
  vec3 p = position * clamp(vAge / 0.25, 0.0, 1.0);
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`,
    fragmentShader: /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uAlpha;
varying float vAge;
varying float vFold;
varying vec2 vUv;
varying vec3 vWorld;
varying float vBright;
void main() {
  if (vAge < 0.0 || vFold >= 1.0) discard;
  vec2 e = min(vUv, 1.0 - vUv);
  float edge = min(e.x, e.y);
  float b = (0.06 + (edge < 0.12 ? 0.08 : 0.0)) * vBright;
  // A slow sweep crossing the map.
  float sweep = abs(fract(vWorld.x * 0.5 + vWorld.z * 0.25 - uTime * 0.3) - 0.5);
  b += sweep < 0.025 ? 0.05 : 0.0;
  b += vAge < 0.3 ? (0.3 - vAge) * 1.2 : 0.0;
  // Going out: one flare, then dark.
  b = vFold > 0.0 ? (b + 0.12 * (1.0 - vFold)) * (1.0 - vFold) : b;
  gl_FragColor = vec4(uColor * b * uAlpha, 1.0);
}
`,
    ...LIGHT,
    ...DECAL,
    side: 2,
  });
}

export function makeWallMaterial(color: string): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uTime: { value: 0 }, uAlpha: { value: 1 }, ...foldUniforms() },
    defines: DEFINES,
    vertexShader: /* glsl */ `
${COMMON}
varying vec3 vLocal;
varying vec3 vNormal2;
varying vec3 vWorld;
void main() {
  vAge = uTime - aBorn;
  vFold = foldOf();
  // Rise from the floor of the miniature (the box spans y 0..1) — and sink
  // back into it on the fold.
  float grow = clamp(vAge / 0.3, 0.0, 1.0) * (1.0 - vFold);
  vec3 p = vec3(position.x, position.y * grow, position.z);
  vLocal = position;
  vNormal2 = normal;
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`,
    fragmentShader: /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uAlpha;
varying float vAge;
varying float vFold;
varying vec3 vLocal;
varying vec3 vNormal2;
varying vec3 vWorld;
void main() {
  if (vAge < 0.0 || vFold >= 1.0) discard;
  // Lit like a hologram: tops bright, sides dim, edges traced.
  float top = vNormal2.y > 0.5 ? 1.0 : 0.0;
  float b = top > 0.5 ? 0.14 : 0.05;
  vec3 q = abs(vLocal - vec3(0.0, 0.5, 0.0)) * 2.0; // 0 centre … 1 faces
  float edges = 0.0;
  if (top > 0.5) edges = max(q.x, q.z) > 0.84 ? 1.0 : 0.0;
  else edges = (vLocal.y > 0.88 || (abs(vNormal2.x) > 0.5 ? q.z : q.x) > 0.84) ? 1.0 : 0.0;
  b += edges * 0.22;
  // Scanlines climbing the walls.
  b += fract(vWorld.y * 40.0 - uTime * 1.5) < 0.3 ? 0.03 : 0.0;
  b += vAge < 0.35 ? (0.35 - vAge) * 1.2 : 0.0;
  b *= 1.0 - vFold * 0.6;
  gl_FragColor = vec4(uColor * b * uAlpha, 1.0);
}
`,
    ...LIGHT,
  });
}

/** A marker: flat bright light that pulses. */
export function makeMarkerMaterial(color: string): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uTime: { value: 0 }, uAlpha: { value: 0 }, uPulse: { value: 0 } },
    vertexShader: /* glsl */ `
varying vec3 vN;
void main() {
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
    fragmentShader: /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uAlpha;
uniform float uPulse;
varying vec3 vN;
void main() {
  float facing = abs(vN.z);
  float b = 0.35 + 0.35 * facing + uPulse * 0.35 * (0.5 + 0.5 * sin(uTime * 6.0));
  gl_FragColor = vec4(uColor * b * uAlpha, 1.0);
}
`,
    ...LIGHT,
  });
}

/** The rune circle the map lies in (a unit quad; lay it flat): two rings, a
 * band of blocky glyphs turning slowly, ticks turning the other way, on a
 * polar grid of chunky cells. It draws itself around as `uIgnite` rises. */
export function makeSigilMaterial(color: string): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uIgnite: { value: 0 }, uAlpha: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
    fragmentShader: /* glsl */ `
uniform vec3 uColor;
uniform float uIgnite;
uniform float uAlpha;
uniform float uTime;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 q = floor((vUv - 0.5) * 160.0) + 0.5;
  float r = length(q) / 80.0;
  if (r > 1.0 || r < 0.72) discard;
  float ang = atan(q.y, q.x);
  float a01 = fract(ang / 6.2831853 + 0.25);
  if (a01 > uIgnite) discard;
  float b = 0.0;
  // Rings.
  if (abs(r - 0.96) < 0.01) b = 0.3;
  if (abs(r - 0.8) < 0.008) b = 0.22;
  // A band of glyphs between them, turning.
  if (r > 0.845 && r < 0.915) {
    float t = fract(ang / 6.2831853 + uTime * 0.01);
    float seg = floor(t * 60.0);
    float rr = floor((r - 0.845) / 0.07 * 3.0);
    float aa = floor(fract(t * 60.0) * 4.0);
    b = max(b, hash(vec2(seg * 4.0 + aa, rr + seg)) > 0.6 ? 0.12 : 0.0);
    if (aa > 2.5) b = 0.0; // the gap between glyphs
  }
  // Ticks inside, turning the other way.
  if (r > 0.74 && r < 0.77 && mod(floor(fract(ang / 6.2831853 - uTime * 0.02) * 96.0), 2.0) < 1.0) b = max(b, 0.12);
  b *= 0.85 + 0.15 * sin(uTime * 3.0 + r * 9.0);
  if (b <= 0.01) discard;
  gl_FragColor = vec4(uColor * b * uAlpha, 1.0);
}
`,
    ...LIGHT,
    ...DECAL,
  });
}

/** The dark under the map: the floor dimmed in a soft disc so the light on
 * it reads (a unit quad; lay it flat). */
export function makeShadeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uAlpha: { value: 0 } },
    vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
    fragmentShader: /* glsl */ `
uniform float uAlpha;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.55, 1.0, r)) * 0.6 * uAlpha;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.01, a);
}
`,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    fog: false,
    ...DECAL,
  });
}
