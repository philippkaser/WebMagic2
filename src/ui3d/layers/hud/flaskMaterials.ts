import {
  BackSide,
  Color,
  CylinderGeometry,
  DoubleSide,
  FrontSide,
  LatheGeometry,
  MeshStandardMaterial,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
} from "three";

/** The vitals flasks: a lathe-turned round-bottomed flask of glass holding a
 * glowing liquid whose level IS the value.
 *
 * The liquid is a sphere inside the bulb whose fragments above a (tilting,
 * rippling) surface plane are discarded. Its BACK faces below the plane are
 * painted as the surface itself: looking down into the flask you see the far
 * inner wall through the cut, and colouring it as "top of the liquid" reads
 * exactly like a flat meniscus — the classic cutaway-liquid trick, no extra
 * geometry. Between the level and the "ghost" of a recent loss the liquid
 * fizzes away (gauge.ts), so a hit shows how much it took.
 *
 * Object space: the bulb is a unit sphere at the origin; the neck rises to
 * y ≈ 1.75. Callers scale the whole flask. */

// ── Geometry (shared) ────────────────────────────────────────────────────────

let geo: { glass: LatheGeometry; liquid: SphereGeometry; cork: CylinderGeometry; band: TorusGeometry; lip: TorusGeometry } | null = null;

export function flaskGeometry() {
  if (geo) return geo;
  const pts: Vector2[] = [];
  // Bulb: a circle from the bottom pole up to where the neck leaves it.
  const neckAt = (70 * Math.PI) / 180;
  for (let i = 0; i <= 20; i++) {
    const a = -Math.PI / 2 + (i / 20) * (Math.PI / 2 + neckAt);
    pts.push(new Vector2(Math.max(0.001, Math.cos(a)), Math.sin(a)));
  }
  // Neck, gently tapering, then the flared lip.
  const r0 = Math.cos(neckAt);
  const y0 = Math.sin(neckAt);
  pts.push(new Vector2(r0 * 0.94, y0 + 0.18), new Vector2(r0 * 0.88, y0 + 0.5), new Vector2(r0 * 0.9, y0 + 0.66));
  pts.push(new Vector2(r0 * 1.18, y0 + 0.72), new Vector2(r0 * 1.2, y0 + 0.8), new Vector2(r0 * 0.95, y0 + 0.83));
  geo = {
    glass: new LatheGeometry(pts, 28),
    liquid: new SphereGeometry(0.93, 32, 22),
    cork: new CylinderGeometry(0.27, 0.23, 0.34, 12),
    band: new TorusGeometry(0.33, 0.045, 6, 22),
    lip: new TorusGeometry(0.37, 0.05, 6, 22),
  };
  return geo;
}

/** Top of the neck in object space (where the cork sits). */
export const FLASK_TOP = Math.sin((70 * Math.PI) / 180) + 0.83;

// ── Liquid ──────────────────────────────────────────────────────────────────

const LIQUID_VERT = /* glsl */ `
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

const LIQUID_FRAG = /* glsl */ `
uniform float uLevel;
uniform float uGhost;
uniform vec2 uTilt;
uniform float uWave;
uniform float uTime;
uniform float uFlash;
uniform float uBubbles;
uniform vec3 uColor;
uniform vec3 uDeep;
uniform vec3 uHot;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vView;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  float ripple = uWave * 0.09 * (sin(vObj.x * 7.0 + uTime * 6.3) * 0.6 + sin(vObj.z * 6.0 - uTime * 5.1) * 0.4);
  float lean = dot(uTilt, vObj.xz) + ripple + 0.012 * sin(uTime * 1.7 + vObj.x * 3.0);
  float surf = uLevel + lean;
  float ghost = max(uGhost, uLevel) + lean;
  float h = vObj.y;
  if (h > ghost) discard;
  bool inGhost = h > surf;

  vec3 col;
  if (!gl_FrontFacing) {
    // Seen through the cut: paint the far inner wall as the liquid's top.
    if (inGhost) discard;
    float swirl = noise(vObj.xz * 3.5 + vec2(uTime * 0.35, -uTime * 0.25));
    col = (uColor * 1.2 + uHot * 0.05) * (0.8 + swirl * 0.4);
  } else {
    vec3 V = normalize(-vView);
    vec3 N = normalize(vN);
    float depth = clamp((surf - h) / 1.6, 0.0, 1.0);
    col = mix(uColor * 1.15, uDeep, smoothstep(0.0, 1.0, depth));
    // Light pooling at the meniscus, and scattering at the glancing edges.
    float men = smoothstep(0.1, 0.0, surf - h);
    col += (uColor * 0.7 + uHot * 0.08) * men;
    float fr = pow(1.0 - abs(dot(N, V)), 2.0);
    col += uColor * fr * 0.55;
    // A slow inner churn so it never looks like painted plastic.
    col *= 0.88 + 0.24 * noise(vec2(atan(vObj.z, vObj.x) * 2.0, h * 3.0 - uTime * 0.6));
    // Bubbles climbing the wall.
    vec2 bp = vec2(atan(vObj.z, vObj.x) * 2.6, h * 4.2 - uTime * (0.7 + uBubbles * 1.4));
    vec2 cell = floor(bp);
    vec2 f = fract(bp) - 0.5;
    float r = hash(cell);
    vec2 c = vec2(fract(r * 7.13) - 0.5, fract(r * 3.71) - 0.5) * 0.5;
    float rad = 0.07 + 0.09 * fract(r * 11.3);
    float d = length(f - c);
    float bub = smoothstep(rad, rad * 0.55, d) - smoothstep(rad * 0.55, rad * 0.2, d) * 0.6;
    bub *= step(1.0 - (0.25 + uBubbles * 0.5), r) * smoothstep(0.0, 0.25, surf - h);
    col += (uHot * 0.35 + uColor * 0.5) * max(bub, 0.0);
    if (inGhost) {
      // What was just lost fizzes away: pale, crumbling, flickering.
      float n = hash(floor(vObj.xy * 22.0) + floor(uTime * 18.0));
      float k = (h - surf) / max(0.001, ghost - surf);
      if (n < 0.25 + k * 0.55) discard;
      col = mix(uHot, uColor, 0.35) * (1.1 + n * 0.5);
    }
  }
  col = mix(col, uHot * 1.6, uFlash * 0.75);
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
    uColor: { value: Color };
    uDeep: { value: Color };
    uHot: { value: Color };
  };
};

export function makeLiquidMaterial(color: string, deep: string): LiquidMaterial {
  return new ShaderMaterial({
    uniforms: {
      uLevel: { value: 0 },
      uGhost: { value: 0 },
      uTilt: { value: new Vector2() },
      uWave: { value: 0 },
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uBubbles: { value: 0.3 },
      uColor: { value: new Color(color) },
      uDeep: { value: new Color(deep) },
      uHot: { value: new Color("#fff0d8") },
    },
    vertexShader: LIQUID_VERT,
    fragmentShader: LIQUID_FRAG,
    side: DoubleSide,
  }) as LiquidMaterial;
}

// ── Glass ───────────────────────────────────────────────────────────────────

const GLASS_FRAG = /* glsl */ `
uniform vec3 uTint;
uniform float uFlash;
uniform float uBack;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vView;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(-vView);
  float ndv = abs(dot(N, V));
  float fr = pow(1.0 - ndv, 2.6);
  // The UI torch hangs up and to the left of the eye (UiCanvas): its hot
  // spot, plus a soft window-like streak down the bulb.
  vec3 L = normalize(vec3(-0.55, 0.65, 0.55));
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 70.0) * 1.6;
  float streak = smoothstep(0.93, 0.99, dot(N, normalize(vec3(-0.75, 0.25, 0.62)))) * 0.45;
  float lit = spec + streak;
  vec3 col = uTint * fr * 0.55 + vec3(1.0, 0.97, 0.92) * lit;
  float a = fr * 0.45 + lit * 0.6 + 0.04;
  col *= uBack;
  a *= uBack;
  col += uTint * uFlash * 0.4;
  gl_FragColor = vec4(col, min(a, 1.0));
  #include <colorspace_fragment>
}
`;

export type GlassMaterial = ShaderMaterial & {
  uniforms: { uTint: { value: Color }; uFlash: { value: number }; uBack: { value: number } };
};

/** Front (`back` = false) or the fainter inner back wall (`back` = true). */
export function makeGlassMaterial(tint: string, back: boolean): GlassMaterial {
  return new ShaderMaterial({
    uniforms: { uTint: { value: new Color(tint) }, uFlash: { value: 0 }, uBack: { value: back ? 0.35 : 1 } },
    vertexShader: LIQUID_VERT,
    fragmentShader: GLASS_FRAG,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    side: back ? BackSide : FrontSide,
  }) as GlassMaterial;
}

let corkMat: MeshStandardMaterial | null = null;
export function corkMaterial(): MeshStandardMaterial {
  return (corkMat ??= new MeshStandardMaterial({ color: "#7a5634", roughness: 0.95 }));
}
