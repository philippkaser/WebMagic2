import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, PlaneGeometry, ShaderMaterial, Vector2, Vector3, type Mesh } from "three";

/** A glass orb of liquid — the vitals' vessel — drawn as a real sphere but
 * shaded like the world: in chunky pixels, hard colour bands, ordered
 * dither and grit.
 *
 * One quad. Its fragment shader ray-casts a sphere on a grid of square
 * cells (a couple of screen pixels each, locked to the orb so the pattern
 * glides with it instead of crawling), so every cell is one flat colour:
 *
 *  - the liquid inside is a smaller sphere cut by a surface plane that stays
 *    LEVEL WITH THE WORLD (look down and you see it from above) and leans
 *    with the slosh; where the ray meets the plane first you see the
 *    surface itself, rippling;
 *  - the liquid is lit from the upper left in four bands of its palette,
 *    churned by a slowly swirling noise and dithered between bands, glows
 *    from its core, and carries rising bubbles and sparks;
 *  - above it the empty glass is dark and see-through, the glass rim takes
 *    the light, a crescent glint sits top left, a one-cell ink outline
 *    holds the shape, and a dithered glow rings it in the liquid's light;
 *  - a loss leaves a fizzing pale band above the level (the gauge's
 *    ghost), a blow blanches it white-hot, and the cells pop in one by one
 *    when it appears.
 *
 * Drive it by writing the uniforms each frame (level, ghost, tilt, wave,
 * bubbles, flash, bright, reveal); geometry uniforms (centre, radius in
 * pixels, the world's up) are kept current by the component itself. */

export interface OrbPalette {
  deep: string;
  mid: string;
  light: string;
  top: string;
  ghost: string;
  hot: string;
}

export const ORB_PALETTES: Record<"health" | "mana", OrbPalette> = {
  health: { deep: "#3a060c", mid: "#8e1620", light: "#d8392f", top: "#ff9a74", ghost: "#ffd9c4", hot: "#fff3e0" },
  mana: { deep: "#0a1442", mid: "#2040a8", light: "#4486ff", top: "#a8dcff", ghost: "#d6ecff", hot: "#f2fbff" },
};

/** The quad spans this many orb radii (the orb plus its glow). */
const SPAN = 2.9;

let quad: PlaneGeometry | null = null;
const plane = () => (quad ??= new PlaneGeometry(1, 1));

const VERT = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uLight;
uniform vec3 uTop;
uniform vec3 uGhostCol;
uniform vec3 uHot;
uniform vec2 uCenterPx;  // the orb's centre, device pixels
uniform float uRadiusPx; // its radius, device pixels
uniform float uCell;     // one cell, device pixels
uniform vec3 uUp;        // the world's up, in the orb's frame (z toward the eye)
uniform float uLevel;
uniform float uGhost;
uniform vec2 uTilt;
uniform float uWave;
uniform float uBubbles;
uniform float uFlash;
uniform float uBright;
uniform float uReveal;
uniform float uTime;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float bayer4(vec2 c) {
  vec2 m = mod(c, 4.0);
  int i = int(m.x) + int(m.y) * 4;
  float b[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (b[i] + 0.5) / 16.0;
}
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }

// Four bands of the liquid's palette, dithered where they meet.
vec3 ramp(float k, vec2 cell) {
  float x = clamp(k, 0.0, 1.0) * 3.0 + (bayer4(cell) - 0.5) * 0.7;
  return x < 1.0 ? uDeep : x < 2.0 ? uMid : x < 3.0 ? uLight : uTop;
}

const float RI = 0.86;          // the liquid's sphere inside the glass
const vec3 LIGHT = normalize(vec3(-0.55, 0.7, 0.55));

void main() {
  vec2 cell = floor((gl_FragCoord.xy - uCenterPx) / uCell);
  vec2 o = (cell + 0.5) * uCell / uRadiusPx;
  float r2 = dot(o, o);
  float rCell = uCell / uRadiusPx;

  // Cells pop in (and out) one by one, the newest still hot.
  float hp = hash(cell + 31.0);
  if (hp > uReveal * 1.2) discard;
  bool fresh = hp > uReveal * 1.2 - 0.2 && uReveal < 0.999;

  vec3 col;
  float a;
  float glowK = (0.35 + uLevel * 0.65) * uBright + uFlash;

  if (r2 < 1.0) {
    vec3 N = vec3(o, sqrt(1.0 - r2));
    // The liquid's frame: level with the world, leaning with the slosh.
    vec3 up = normalize(uUp);
    vec3 tx = normalize(cross(up, vec3(0.0, 0.0, 1.0)) + vec3(1e-4, 0.0, 0.0));
    vec3 tz = cross(tx, up);
    vec3 n = normalize(up - tx * uTilt.x * 0.9 - tz * uTilt.y * 0.9);
    float L = mix(-RI, RI, uLevel) + uWave * 0.09 * sin(dot(o, tx.xy) * 9.0 + uTime * 9.0) + 0.025 * sin(uTime * 2.1 + o.x * 4.0) * step(0.02, uLevel);
    float G = mix(-RI, RI, uGhost) + (L - mix(-RI, RI, uLevel));

    bool inner = r2 < RI * RI;
    float zf = inner ? sqrt(RI * RI - r2) : 0.0;
    vec3 Qf = vec3(o, zf);
    float hf = dot(Qf, n);

    // Glass first: dark, a little see-through.
    col = srgb(vec3(0.05, 0.06, 0.085));
    a = 0.6;
    if (hash(cell + 7.0) > 0.965) col = srgb(vec3(0.16, 0.18, 0.22)); // dust on the glass

    if (inner) {
      if (hf < L) {
        // The liquid's body, as a lit sphere.
        vec3 Nl = Qf / RI;
        float diff = max(dot(Nl, LIGHT), 0.0);
        vec3 swirl = Qf * 3.2 + vec3(uTime * 0.25, -uTime * 0.4, uTime * 0.18);
        float grit = vnoise(swirl) * 0.5 + vnoise(swirl * 2.3) * 0.25;
        float core = 1.0 - r2 / (RI * RI);
        float k = diff * 0.62 + core * 0.28 + (grit - 0.37) * 0.55 + 0.05;
        // Rising bubbles: streaks of noise drifting up through the liquid.
        float rise = vnoise(vec3(Qf.x * 7.0, dot(Qf, up) * 3.0 - uTime * 1.6, Qf.z * 7.0));
        if (rise > 1.0 - uBubbles * 0.22) k += 0.45;
        // Sparks: single cells flashing on for a beat.
        if (hash(cell + floor(uTime * 7.0) * 1.37) > 0.993 - uBubbles * 0.004) k = 1.2;
        // The meniscus: the cells just under the surface.
        if (hf > L - rCell * 1.4) k = max(k, 0.9);
        col = ramp(k, cell);
        a = 1.0;
      } else {
        // Above the level: does the ray dip below the surface before it
        // leaves the liquid? Then we're looking at the surface itself.
        float zs = abs(n.z) > 1e-3 ? (L - dot(o, n.xy)) / n.z : -9.0;
        if (zs < zf && zs > -zf) {
          vec3 Qs = vec3(o, zs);
          float rip = vnoise(vec3(dot(Qs, tx) * 9.0, dot(Qs, tz) * 9.0, uTime * 1.3));
          float k = 0.7 + (rip - 0.5) * 0.7 + max(dot(n, LIGHT), 0.0) * 0.15;
          col = ramp(k, cell);
          a = 1.0;
        } else if (hf < G) {
          // What a blow took, fizzing away.
          float chk = mod(cell.x + cell.y + floor(uTime * 14.0), 2.0);
          col = uGhostCol;
          a = chk < 1.0 ? 0.9 : 0.4;
        }
      }
      if (a >= 1.0) {
        col = mix(col, uHot, step(0.34, uFlash) * (0.45 + 0.5 * step(0.67, uFlash)));
        col *= uBright;
      }
    }

    // The glass rim takes the light; a crescent glint sits top left.
    if (r2 > (1.0 - rCell * 2.2) * (1.0 - rCell * 2.2)) {
      float lit = dot(normalize(o), normalize(vec2(-0.7, 0.7)));
      col = lit > 0.4 ? srgb(vec3(0.85, 0.92, 0.97)) : lit > -0.3 ? srgb(vec3(0.42, 0.5, 0.58)) : srgb(vec3(0.18, 0.22, 0.28));
      a = max(a, 0.92);
    }
    vec3 Hh = normalize(LIGHT + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(N, Hh), 0.0), 60.0);
    vec2 g = o - vec2(-0.42, 0.46);
    bool crescent = length(g) < 0.24 && length(g - vec2(0.07, -0.07)) > 0.2;
    if (spec > 0.55 || crescent) { col = srgb(vec3(1.0, 0.99, 0.95)); a = 1.0; }
  } else if (r2 < (1.0 + rCell * 1.2) * (1.0 + rCell * 1.2)) {
    col = srgb(vec3(0.027, 0.024, 0.04)); // the ink outline
    a = 0.95;
  } else {
    // The glow: stepped, dithered rings of the liquid's light.
    float d = sqrt(r2) - 1.0;
    float ring = d < 0.12 ? 0.32 : d < 0.26 ? (bayer4(cell) < 0.5 ? 0.2 : 0.0) : d < 0.4 ? (bayer4(cell) < 0.2 ? 0.14 : 0.0) : 0.0;
    if (ring <= 0.0) discard;
    col = mix(uLight, uHot, uFlash * 0.6);
    a = ring * min(1.4, glowK);
  }

  if (fresh) col = mix(col, uHot, 0.7);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

export type OrbMaterial = ShaderMaterial & {
  uniforms: {
    uCenterPx: { value: Vector2 };
    uRadiusPx: { value: number };
    uCell: { value: number };
    uUp: { value: Vector3 };
    uLevel: { value: number };
    uGhost: { value: number };
    uTilt: { value: Vector2 };
    uWave: { value: number };
    uBubbles: { value: number };
    uFlash: { value: number };
    uBright: { value: number };
    uReveal: { value: number };
    uTime: { value: number };
  };
};

export function makeOrbMaterial(p: OrbPalette): OrbMaterial {
  return new ShaderMaterial({
    uniforms: {
      uDeep: { value: new Color(p.deep) },
      uMid: { value: new Color(p.mid) },
      uLight: { value: new Color(p.light) },
      uTop: { value: new Color(p.top) },
      uGhostCol: { value: new Color(p.ghost) },
      uHot: { value: new Color(p.hot) },
      uCenterPx: { value: new Vector2() },
      uRadiusPx: { value: 1 },
      uCell: { value: 2 },
      uUp: { value: new Vector3(0, 1, 0) },
      uLevel: { value: 0 },
      uGhost: { value: 0 },
      uTilt: { value: new Vector2() },
      uWave: { value: 0 },
      uBubbles: { value: 0 },
      uFlash: { value: 0 },
      uBright: { value: 1 },
      uReveal: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  }) as OrbMaterial;
}

const center = new Vector3();
const toEye = new Vector3();
const ax = new Vector3();
const ay = new Vector3();
const worldUp = new Vector3();
const bufSize = new Vector2();

/** An orb of `radius` (world units) at the group's origin. `cssCell` is one
 * shading cell in CSS pixels (the world's pixels are ~2.9). */
export function PixelOrb({ material, radius, cssCell = 2 }: { material: OrbMaterial; radius: number; cssCell?: number }) {
  const mesh = useRef<Mesh>(null);
  const gl = useThree((s) => s.gl);
  useEffect(() => () => material.dispose(), [material]);
  const scale = useMemo(() => [radius * SPAN, radius * SPAN, 1] as [number, number, number], [radius]);

  useFrame(({ camera }) => {
    const m = mesh.current;
    if (!m) return;
    const u = material.uniforms;
    gl.getDrawingBufferSize(bufSize);
    // Centre in device pixels, radius from its distance (the orb is drawn
    // round wherever it sits, as a held object would be seen).
    m.getWorldPosition(center);
    const dist = Math.max(1e-4, center.distanceTo(camera.position));
    toEye.copy(center).project(camera);
    u.uCenterPx.value.set((toEye.x * 0.5 + 0.5) * bufSize.x, (toEye.y * 0.5 + 0.5) * bufSize.y);
    u.uRadiusPx.value = (radius / dist) * camera.projectionMatrix.elements[5]! * (bufSize.y / 2);
    u.uCell.value = Math.max(1, Math.round(cssCell * gl.getPixelRatio()));
    // The orb is seen along the screen's normal (as if held square to the
    // eye): its frame is the camera's. The world's up expressed in it keeps
    // the liquid level with the floor — look down and you see its surface
    // from above, look level and you see it side-on.
    ax.set(1, 0, 0).applyQuaternion(camera.quaternion);
    ay.set(0, 1, 0).applyQuaternion(camera.quaternion);
    toEye.set(0, 0, 1).applyQuaternion(camera.quaternion);
    worldUp.set(0, 1, 0);
    u.uUp.value.set(worldUp.dot(ax), worldUp.dot(ay), worldUp.dot(toEye));
  });

  return <mesh ref={mesh} geometry={plane()} material={material} scale={scale} renderOrder={6} />;
}
