import { Color, ShaderMaterial } from "three";
import { LIGHT_BLENDING } from "../../light";

/** The cast map's light: everything is added light in the caster's colour,
 * computed in display values (light.ts).
 *
 * Tiles and walls are instanced; each instance carries `aBorn`, the uiNow
 * second it appears (the reveal ripples out from where the wizard stands),
 * and tiles `aBright` (paths glow brighter). Each grows in (tiles unfold,
 * walls rise) over a quarter second with a white-hot flash. `uGone`
 * collapses everything again when the map is dismissed. */

const COMMON = /* glsl */ `
uniform float uTime;
uniform float uGone;
attribute float aBorn;
varying float vAge;
`;

export function makeTileMaterial(color: string): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uTime: { value: 0 }, uGone: { value: 0 }, uAlpha: { value: 1 } },
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
  float grow = clamp(vAge / 0.25, 0.0, 1.0) * (1.0 - uGone);
  vec3 p = position * grow;
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
varying vec2 vUv;
varying vec3 vWorld;
varying float vBright;
void main() {
  if (vAge < 0.0) discard;
  vec2 e = min(vUv, 1.0 - vUv);
  float edge = min(e.x, e.y);
  float b = (0.13 + (edge < 0.12 ? 0.14 : 0.0)) * vBright;
  // A slow sweep crossing the map.
  float sweep = abs(fract(vWorld.x * 1.6 + vWorld.z * 0.8 - uTime * 0.35) - 0.5);
  b += sweep < 0.03 ? 0.08 : 0.0;
  b += vAge < 0.3 ? (0.3 - vAge) * 2.0 : 0.0;
  gl_FragColor = vec4(pow(uColor, vec3(1.0 / 2.2)) * b * uAlpha, 0.0);
}
`,
    transparent: true,
    depthWrite: false,
    ...LIGHT_BLENDING,
    side: 2,
  });
}

export function makeWallMaterial(color: string): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uTime: { value: 0 }, uGone: { value: 0 }, uAlpha: { value: 1 } },
    vertexShader: /* glsl */ `
${COMMON}
varying vec3 vLocal;
varying vec3 vNormal2;
varying vec3 vWorld;
void main() {
  vAge = uTime - aBorn;
  float grow = clamp(vAge / 0.3, 0.0, 1.0) * (1.0 - uGone);
  // Rise from the floor of the miniature (the box spans y 0..1).
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
varying vec3 vLocal;
varying vec3 vNormal2;
varying vec3 vWorld;
void main() {
  if (vAge < 0.0) discard;
  // Lit like a hologram: tops bright, sides dim, edges traced.
  float top = vNormal2.y > 0.5 ? 1.0 : 0.0;
  float b = top > 0.5 ? 0.22 : 0.08;
  vec3 q = abs(vLocal - vec3(0.0, 0.5, 0.0)) * 2.0; // 0 centre … 1 faces
  float edges = 0.0;
  if (top > 0.5) edges = max(q.x, q.z) > 0.86 ? 1.0 : 0.0;
  else edges = (vLocal.y > 0.9 || (abs(vNormal2.x) > 0.5 ? q.z : q.x) > 0.86) ? 1.0 : 0.0;
  b += edges * 0.3;
  // Scanlines climbing the walls.
  b += fract(vWorld.y * 90.0 - uTime * 1.5) < 0.3 ? 0.05 : 0.0;
  b += vAge < 0.35 ? (0.35 - vAge) * 2.0 : 0.0;
  gl_FragColor = vec4(pow(uColor, vec3(1.0 / 2.2)) * b * uAlpha, 0.0);
}
`,
    transparent: true,
    depthWrite: false,
    ...LIGHT_BLENDING,
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
  float b = 0.45 + 0.4 * facing + uPulse * 0.4 * (0.5 + 0.5 * sin(uTime * 6.0));
  gl_FragColor = vec4(pow(uColor, vec3(1.0 / 2.2)) * b * uAlpha, 0.0);
}
`,
    transparent: true,
    depthWrite: false,
    ...LIGHT_BLENDING,
  });
}
