import { Color, ShaderMaterial, Vector2 } from "three";
import { VORTEX_NOISE_GLSL } from "./vortexGlsl";

/** The travel overlay: ONE fullscreen quad, ONE draw call, drawn in the world
 * canvas (so bloom feeds on it) after everything else (renderOrder high,
 * depthTest off). It is a pure function of a handful of uniforms that
 * TransitionSystem fills from timeline.ts each frame:
 *
 * - The TUNNEL is analytic, not geometry: each pixel's view ray is intersected
 *   with an infinite tube (depth = 1 / radius), so it covers the view
 *   completely at any FOV or roll and costs a few noise lookups per pixel.
 *   Walls are two layers of periodic fbm in (turns, depth) twisted into a
 *   spiral, light streaks race along 48 angular lanes, flecks float at two
 *   inner radii for parallax, and the far end blazes (bloom does the rest).
 * - ENTER draws that same tunnel inside an iris centred on the portal's
 *   on-screen position, starting at the portal's own apparent size, ringed by
 *   a wobbling event horizon, while spiral arms of the portal's colour wind
 *   over the still-visible world.
 * - ARRIVE tears a growing hole in the tunnel at the screen centre, riding a
 *   white-hot ring.
 * - Death has no vortex: a noise-threshold dissolve eats the view from the
 *   edges in, glowing ember-red along the burn line, leaving smouldering
 *   black-red ash with sparks drifting up.
 *
 * At dpr 0.35 the whole thing is ~70k fragments; nothing here allocates. */

const VERTEX = /* glsl */ `
varying vec2 vNdc;
void main() {
  // A 1×1 plane blown up to clip space: camera-attached by construction.
  vNdc = position.xy * 2.0;
  gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
varying vec2 vNdc;
uniform float uTime;
uniform float uAspect;
uniform float uTanHalf;
uniform float uRoll;
uniform vec2 uCenter;
uniform float uIrisR;
uniform float uRevealR;
uniform float uRing;
uniform float uSwirl;
uniform float uDissolve;
uniform float uDark;
uniform float uFlash;
uniform float uFade;
uniform float uLook;
uniform vec3 uColor;
uniform vec3 uHot;
uniform vec3 uDeep;
uniform float uSpinDir;
uniform float uSpin;
uniform float uSpeed;
uniform float uStreaks;
uniform float uRings;
uniform float uFeathers;

${VORTEX_NOISE_GLSL}

const float TAU = 6.2831853;

vec3 tunnel(vec2 q) {
  // Screen point (in half-heights) × tan(fov/2) = the view ray's slope.
  vec2 d = q * uTanHalf;
  float cs = cos(uRoll);
  float sn = sin(uRoll);
  d = vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y);
  float r = max(length(d), 1e-4);
  float ang = atan(d.y, d.x);
  float z = 1.0 / r;
  float t = uTime;
  float fly = t * uSpeed * 12.0;
  float v = z + fly;
  float turns = ang / TAU + uSpinDir * (z * 0.07 + t * uSpin * 0.14);

  // Walls: dark swirling bands in the deep shade and the base colour, with
  // hot filaments only on the noise peaks — most of the tube stays under the
  // bloom threshold so the streaks and rings are what glow.
  float n1 = vxFbmP(vec2(turns * 10.0, v * 0.3), 10.0);
  float n2 = vxFbmP(vec2(turns * 22.0 + 5.0, v * 0.9 - t * 0.8), 22.0);
  float bands = smoothstep(0.42, 0.8, n1);
  vec3 col = uDeep * (0.45 + 0.9 * n1);
  col = mix(col, uColor * 0.5, bands * 0.85);
  col += uColor * pow(n2, 5.0) * 2.0 * (0.25 + bands);

  // Light streaks racing along the walls: thin lanes, short bright heads.
  float cells = 96.0;
  float cu = turns * cells;
  float ci = mod(floor(cu), cells);
  float rnd = vxHash11(ci * 7.13 + 1.0);
  float lane = 1.0 - smoothstep(0.1, 0.3, abs(fract(cu) - 0.5));
  float sv = fract(v * (0.04 + rnd * 0.05) + rnd * 13.0);
  float on = step(1.0 - uStreaks * 0.32, vxHash11(ci * 3.71 + 9.0));
  float head = smoothstep(0.84, 1.0, sv);
  // (Faded right at the screen edge, where the nearest wall would blow a
  // streak up into a slab.)
  col += (uHot * 1.25 + uColor * 0.4) * head * head * lane * on * smoothstep(0.4, 1.2, z);

  // Rune rings rushing past.
  float rv = fract(v * 0.06);
  float ringBand = smoothstep(0.9, 0.93, rv) * (1.0 - smoothstep(0.955, 0.975, rv));
  float glyph = step(0.42, vxHash21(vec2(mod(floor(turns * 18.0), 18.0), floor(v * 0.06))));
  col += uColor * 1.9 * ringBand * uRings * (0.25 + 0.75 * glyph);

  // Flecks floating inside the tube at two radii: parallax depth.
  for (int k = 0; k < 2; k++) {
    float rho = k == 0 ? 0.55 : 0.28;
    float per = k == 0 ? 20.0 : 12.0;
    float zk = rho / r;
    float vk = (zk + fly * 1.15) * 0.7;
    float uk = (ang / TAU) * per + t * 0.25 * uSpinDir * float(k + 1);
    vec2 cell = vec2(mod(floor(uk), per), floor(vk));
    float h = vxHash21(cell + float(k) * 31.0);
    vec2 f = vec2(fract(uk), fract(vk)) - 0.5;
    f.y -= (h - 0.5) * 0.4;
    float fleck = 1.0 - smoothstep(0.05, 0.22, length(f * vec2(1.0, 0.3)));
    float present = step(0.86 - uStreaks * 0.1, h);
    col += uHot * 1.3 * fleck * present * (1.0 - smoothstep(3.0, 10.0, zk));
  }

  // Feathers: soft pale flakes drifting slowly, rocking as they go.
  if (uFeathers > 0.0) {
    float fr = 0.8 / r;
    float fu = (ang / TAU) * 14.0;
    float fv = fr * 0.9 + t * 1.3;
    vec2 fc = vec2(mod(floor(fu), 14.0), floor(fv));
    float h = vxHash21(fc + 7.0);
    vec2 f = vec2(fract(fu), fract(fv)) - 0.5;
    float sway = sin(t * 2.3 + h * 20.0) * 0.6;
    f = vec2(cos(sway) * f.x - sin(sway) * f.y, sin(sway) * f.x + cos(sway) * f.y);
    float flake = 1.0 - smoothstep(0.08, 0.3, length(f * vec2(2.4, 0.8)));
    col = mix(col, uHot * 1.2, flake * step(0.55, h) * uFeathers * (1.0 - smoothstep(2.0, 7.0, fr)));
  }

  // Depth: the far end brightens into the light at the end of the tunnel;
  // the nearest wall darkens so the tube has volume.
  float far = smoothstep(3.0, 12.0, z);
  col = mix(col, uColor * 0.75, far * 0.7);
  col = mix(col, uHot * 2.2, smoothstep(13.0, 34.0, z));
  col *= mix(0.3, 1.0, smoothstep(0.25, 1.4, z));
  return col;
}

vec4 vortex(vec2 q) {
  vec2 qc = q - uCenter;
  float dist = length(qc);
  float ang = atan(qc.y, qc.x);

  // The iris: the tunnel, inside a living, wobbling event horizon.
  float wob = vxNoiseP(vec2(ang / TAU * 9.0, uTime * 3.0), 9.0) - 0.5;
  float edgeR = uIrisR * (1.0 + wob * 0.16);
  float inside = step(dist, edgeR);
  vec3 col = vec3(0.0);
  float a = 0.0;
  if (inside > 0.5) col = tunnel(qc);
  float ring = exp(-abs(dist - edgeR) * 26.0) * uRing * step(0.001, uIrisR);

  // Outside: spiral arms of light winding into the iris.
  float lr = log(max(dist, 1e-3));
  float warp = vxNoise(qc * 2.5 + uTime * 0.6) * 2.5;
  float s = sin(ang * 3.0 + uSpinDir * (lr * 5.5 - uTime * 7.0) + warp) * 0.5 + 0.5;
  float reach = 1.0 - smoothstep(edgeR + 0.2, edgeR + 0.35 + 2.4 * uSwirl, dist);
  float arm = smoothstep(0.8 - 0.35 * uSwirl, 1.0, s) * uSwirl * reach;
  vec3 outCol = mix(uDeep * 0.5, uColor * 1.4 + uHot * 0.5 * arm, arm);
  float outA = max(arm * 0.92, uSwirl * 0.4 * smoothstep(0.2, 1.8, dist));

  col = mix(outCol, col, inside);
  a = mix(outA, 1.0, inside);
  col += (uHot * 1.6 + uColor * 0.8) * ring;
  a = max(a, min(ring, 1.0));

  // ARRIVE: the tunnel tears open from the centre on a white-hot ring.
  if (uRevealR > 0.0) {
    float rd = length(q);
    float ra = atan(q.y, q.x);
    float rw = vxNoiseP(vec2(ra / TAU * 9.0, uTime * 3.0 + 7.0), 9.0) - 0.5;
    float er = uRevealR * (1.0 + rw * 0.12);
    float hole = step(rd, er);
    float rring = exp(-abs(rd - er) * 22.0) * uRing;
    a *= 1.0 - hole;
    col *= 1.0 - 0.45 * smoothstep(0.0, 2.0, uRevealR);
    col += (uHot * 2.0 + uColor) * rring;
    a = max(a, min(rring, 1.0));
  }

  // Respawn: the death screen's black lifts off the tunnel.
  col *= 1.0 - uDark;
  a = max(a, uDark);
  col += uHot * uFlash * 1.6;
  a = max(a, uFlash * 0.9);
  return vec4(col, a);
}

vec4 dissolve(vec2 q) {
  float maxR = length(vec2(uAspect, 1.0));
  float edgeD = length(q) / maxR;
  float n = vxFbm(q * 2.4 + vec2(0.0, uTime * 0.05));
  float n2 = vxNoise(q * 11.0 + 3.0);
  // High in the middle: the world burns away from the edges inward.
  float field = (1.0 - edgeD) * 0.6 + n * 0.32 + n2 * 0.08;
  float th = uDissolve * 1.02;
  float burned = step(field, th);
  float edge = (1.0 - smoothstep(0.0, 0.05, abs(field - th))) * (1.0 - step(0.999, uDissolve));

  // Ash: smouldering black-red, sparks drifting up through it, and a slow
  // pulse — the last of the heartbeat.
  float beat = pow(max(0.0, sin(uTime * 3.2)), 16.0);
  vec3 ash = mix(vec3(0.012, 0.0, 0.003), uDeep * (2.0 + beat * 1.5), n * n);
  vec2 ec = q * 26.0 + vec2(0.0, -uTime * 2.2);
  float eh = vxHash21(floor(ec));
  float ember = step(0.984, eh) * (0.55 + 0.45 * sin(uTime * 5.0 + eh * 50.0))
    * (1.0 - smoothstep(0.15, 0.45, length(fract(ec) - 0.5)));
  ash += uColor * ember * 1.7;

  vec3 burnCol = uColor * 2.0 + uHot * 0.8 * edge * edge;
  // Before it burns, the world bleeds dark red — at once, so the death reads
  // from the first frame.
  vec3 washCol = uDeep * 0.9 + uColor * 0.08;
  vec3 col = mix(washCol, ash, burned);
  col = mix(col, burnCol, edge);
  float a = max(max(burned, edge), sqrt(uDissolve) * 0.55);
  // The blow that killed you: a red pulse.
  col = mix(col, uColor * 1.4, uFlash);
  a = max(a, uFlash);
  return vec4(col, a);
}

void main() {
  vec2 q = vec2(vNdc.x * uAspect, vNdc.y);
  vec4 c = uLook > 0.5 ? dissolve(q) : vortex(q);
  gl_FragColor = vec4(c.rgb, clamp(c.a, 0.0, 1.0) * uFade);
}
`;

export interface VortexUniforms {
  uTime: { value: number };
  uAspect: { value: number };
  uTanHalf: { value: number };
  uRoll: { value: number };
  uCenter: { value: Vector2 };
  uIrisR: { value: number };
  uRevealR: { value: number };
  uRing: { value: number };
  uSwirl: { value: number };
  uDissolve: { value: number };
  uDark: { value: number };
  uFlash: { value: number };
  uFade: { value: number };
  uLook: { value: number };
  uColor: { value: Color };
  uHot: { value: Color };
  uDeep: { value: Color };
  uSpinDir: { value: number };
  uSpin: { value: number };
  uSpeed: { value: number };
  uStreaks: { value: number };
  uRings: { value: number };
  uFeathers: { value: number };
}

export function createVortexMaterial(): ShaderMaterial & { uniforms: VortexUniforms } {
  const uniforms: VortexUniforms = {
    uTime: { value: 0 },
    uAspect: { value: 1.6 },
    uTanHalf: { value: 0.8 },
    uRoll: { value: 0 },
    uCenter: { value: new Vector2() },
    uIrisR: { value: 0 },
    uRevealR: { value: 0 },
    uRing: { value: 0 },
    uSwirl: { value: 0 },
    uDissolve: { value: 0 },
    uDark: { value: 0 },
    uFlash: { value: 0 },
    uFade: { value: 1 },
    uLook: { value: 0 },
    uColor: { value: new Color() },
    uHot: { value: new Color() },
    uDeep: { value: new Color() },
    uSpinDir: { value: 1 },
    uSpin: { value: 1 },
    uSpeed: { value: 1 },
    uStreaks: { value: 1 },
    uRings: { value: 0 },
    uFeathers: { value: 0 },
  };
  const material = new ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, { value: unknown }>,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  return material as ShaderMaterial & { uniforms: VortexUniforms };
}
