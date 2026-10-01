import { useEffect, useMemo } from "react";
import { Color, PlaneGeometry, ShaderMaterial, Vector2 } from "three";

/** A glass flask drawn as pixel art — the vitals' vessel. One quad; the
 * fragment shader paints it on a coarse grid of square "flask pixels" (the
 * same chunky pixels the world is drawn in) every frame, so the liquid can
 * move: its surface leans as the flask is carried, ripples, bubbles, flares
 * white when you're struck and leaves a fizzing ghost of what a blow took.
 *
 * The bottle: a round bulb with a stepped two-tone glass rim lit from the
 * upper left, a narrow neck with a brass band, a lip and a cork, all inside
 * a one-pixel ink outline; a curved glint across the glass; and a stepped
 * pixel glow around it in the liquid's colour (the UI canvas has no bloom).
 *
 * Driving it: write `uniforms` every frame (level, ghost, tilt, wave,
 * bubbles, flash, bright, reveal, time). Grid and palette are fixed per
 * material. */

/** The flask grid, in flask pixels (bulb, neck, lip, cork). */
export const FLASK = { w: 26, h: 34, halo: 6 } as const;
/** The quad's size in flask pixels (the flask plus its glow). */
export const FLASK_QUAD = { w: FLASK.w + FLASK.halo * 2, h: FLASK.h + FLASK.halo * 2 } as const;

export interface FlaskPalette {
  deep: string;
  mid: string;
  light: string;
  top: string;
  /** The pale fizz of a loss, and the hot white of a hit. */
  ghost: string;
  hot: string;
}

export const FLASK_PALETTES: Record<"health" | "mana", FlaskPalette> = {
  health: { deep: "#4a0910", mid: "#a61c26", light: "#e0413a", top: "#ff9b7c", ghost: "#ffd9c4", hot: "#fff3e0" },
  mana: { deep: "#0c1a52", mid: "#2550c4", light: "#4a8cff", top: "#a6d6ff", ghost: "#d6ecff", hot: "#f2fbff" },
};

let quad: PlaneGeometry | null = null;
export function flaskQuad(): PlaneGeometry {
  return (quad ??= new PlaneGeometry(1, 1));
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
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
uniform float uLevel;   // 0..1 displayed
uniform float uGhost;   // 0..1 (>= level): what a loss left behind
uniform vec2 uTilt;     // surface slope (x across, z toward you)
uniform float uWave;    // ripple amplitude 0..1
uniform float uBubbles; // 0..1
uniform float uFlash;   // 0..1 white-hot
uniform float uBright;  // 1 = normal
uniform float uReveal;  // 0..1 pixels popping in
uniform float uTime;
varying vec2 vUv;

const float W = ${FLASK.w}.0;
const float H = ${FLASK.h}.0;
const float HALO = ${FLASK.halo}.0;
const vec2 BC = vec2(13.0, 12.0);
const float BR = 11.6;

vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

bool inBulb(vec2 c, float g) { return length(c - BC) < BR + g; }
bool inNeck(vec2 c, float g) { return c.x > 10.0 - g && c.x < 16.0 + g && c.y > 18.0 && c.y < 28.0 + g; }
bool inLip(vec2 c, float g) { return c.x > 9.0 - g && c.x < 17.0 + g && c.y > 28.0 - g && c.y < 30.0 + g; }
bool inCork(vec2 c, float g) { return c.x > 10.0 - g && c.x < 16.0 + g && c.y > 30.0 - g && c.y < 33.0 + g; }
bool inGlass(vec2 c, float g) { return inBulb(c, g) || inNeck(c, g) || inLip(c, g); }
bool inSolid(vec2 c, float g) { return inGlass(c, g) || inCork(c, g); }
bool inInterior(vec2 c) {
  return length(c - BC) < BR - 1.15 || (c.x > 11.0 && c.x < 15.0 && c.y > 18.0 && c.y < 28.0);
}

// The liquid's surface height at column x (flask pixels from the bottom).
float surfaceAt(float x) {
  // Full = the bulb brimming at the neck's foot.
  float levelY = mix(0.6, 23.4, uLevel);
  float dx = x - BC.x;
  float s = levelY + uTilt.x * 0.55 * dx + uTilt.y * 1.6;
  s += uWave * 1.1 * sin(x * 0.85 + uTime * 9.0);
  s += 0.35 * sin(x * 0.55 + uTime * 2.3) * step(0.02, uLevel);
  return s;
}

void main() {
  vec2 p = vUv * vec2(W + HALO * 2.0, H + HALO * 2.0) - HALO;
  vec2 cell = floor(p);
  vec2 c = cell + 0.5;

  // Pixels pop in (and out) one by one, the newest still hot.
  float hp = hash(cell + 17.0);
  if (hp > uReveal * 1.2) discard;
  float fresh = step(uReveal * 1.2 - 0.18, hp) * step(uReveal, 0.999);

  vec3 col = vec3(0.0);
  float a = 0.0;
  vec3 lightDir = normalize(vec3(-0.55, 0.65, 0.55));
  float glow = (0.35 + uLevel * 0.65) * uBright + uFlash;

  if (inSolid(c, 0.0)) {
    bool interior = inInterior(c);
    if (inCork(c, 0.0)) {
      // Cork: lit left column, shaded right, a lighter crown.
      float t = c.x < 11.5 ? 2.0 : c.x > 14.5 ? 0.0 : 1.0;
      if (c.y > 32.0) t = min(2.0, t + 1.0);
      col = t > 1.5 ? srgb(vec3(0.64, 0.45, 0.25)) : t > 0.5 ? srgb(vec3(0.45, 0.29, 0.15)) : srgb(vec3(0.25, 0.15, 0.08));
      a = 1.0;
    } else if (!interior) {
      // The glass rim (and the brass band round the neck).
      if (c.y > 24.0 && c.y < 26.0 && inNeck(c, 0.0)) {
        float t = c.x < 11.5 ? 2.0 : c.x > 14.5 ? 0.0 : 1.0;
        col = t > 1.5 ? srgb(vec3(1.0, 0.86, 0.48)) : t > 0.5 ? srgb(vec3(0.78, 0.63, 0.24)) : srgb(vec3(0.42, 0.31, 0.12));
        a = 1.0;
      } else {
        vec2 n2 = inBulb(c, 0.0) && c.y < 19.0 ? normalize(c - BC) : vec2(c.x < 13.0 ? -1.0 : 1.0, 0.25);
        float lit = dot(n2, normalize(vec2(-0.7, 0.7)));
        col = lit > 0.35 ? srgb(vec3(0.86, 0.93, 0.97)) : lit > -0.35 ? srgb(vec3(0.5, 0.6, 0.68)) : srgb(vec3(0.22, 0.27, 0.33));
        a = lit > 0.35 ? 0.95 : 0.85;
      }
    } else {
      float s = surfaceAt(c.x);
      float levelTop = s;
      float ghostTop = mix(0.6, 23.4, uGhost) + (s - mix(0.6, 23.4, uLevel));
      if (c.y < s) {
        // Liquid, shaded as a sphere lit from the upper left, in hard bands.
        vec2 d = (c - BC) / (BR - 1.0);
        float z = sqrt(max(0.0, 1.0 - dot(d, d)));
        float sh = dot(normalize(vec3(d, z + 0.001)), lightDir);
        if (c.y > 18.5) sh = c.x < 13.0 ? 0.55 : 0.3; // the neck
        col = sh > 0.62 ? uLight : sh > 0.22 ? uMid : uDeep;
        if (c.y >= levelTop - 1.0) col = uTop; // the meniscus
        // Bubbles: rising single pixels, more of them while it refills.
        for (int i = 0; i < 7; i++) {
          float fi = float(i);
          if (fi >= uBubbles * 7.0) break;
          float bx = floor(3.0 + hash(vec2(fi, 3.1)) * 20.0) + 0.5;
          float speed = 3.0 + hash(vec2(fi, 9.7)) * 5.0;
          float by = floor(mod(uTime * speed + hash(vec2(fi, 1.3)) * 40.0, max(1.0, levelTop - 1.0))) + 0.5;
          if (abs(c.x - bx) < 0.1 && abs(c.y - by) < 0.1) col = uTop;
        }
        col = mix(col, uHot, step(0.34, uFlash) * (0.45 + 0.5 * step(0.67, uFlash)));
        col *= uBright;
        a = 1.0;
      } else if (c.y < ghostTop) {
        // What a blow took, fizzing away: a pale dither above the level.
        float chk = mod(cell.x + cell.y + floor(uTime * 14.0), 2.0);
        col = uGhostCol;
        a = chk < 1.0 ? 0.9 : 0.35;
      } else {
        // Empty glass: dark, a little see-through, a faint reflection.
        col = srgb(vec3(0.07, 0.08, 0.11));
        a = 0.55;
        if (c.x > 18.0 && c.x < 20.0 && c.y > 6.0 && c.y < 18.0) { col = srgb(vec3(0.3, 0.36, 0.42)); a = 0.5; }
      }
    }
    // The glint across the glass, in front of whatever is inside.
    vec2 q = c - BC;
    float r = length(q);
    float ang = atan(q.y, q.x);
    bool glint = (r > BR - 3.6 && r < BR - 2.3 && ang > 1.95 && ang < 2.75) || (abs(c.x - 8.5) < 0.1 && abs(c.y - 18.5) < 0.1);
    if (glint && inBulb(c, 0.0)) { col = srgb(vec3(1.0, 1.0, 0.96)); a = 1.0; }
  } else if (inSolid(c, 1.0)) {
    col = srgb(vec3(0.027, 0.024, 0.04)); // the ink outline
    a = 1.0;
  } else {
    // The glow: two stepped rings of the liquid's light, the outer dithered.
    float d = length(c - BC) - BR;
    float ring = d < 2.5 ? 0.3 : d < 5.0 ? (mod(cell.x + cell.y, 2.0) < 1.0 ? 0.16 : 0.0) : 0.0;
    if (ring <= 0.0) discard;
    col = mix(uLight, uHot, uFlash * 0.6);
    a = ring * min(1.4, glow);
  }

  if (fresh > 0.5) col = mix(col, uHot, 0.7);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

export type FlaskMaterial = ShaderMaterial & {
  uniforms: {
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

export function makeFlaskMaterial(p: FlaskPalette): FlaskMaterial {
  return new ShaderMaterial({
    uniforms: {
      uDeep: { value: new Color(p.deep) },
      uMid: { value: new Color(p.mid) },
      uLight: { value: new Color(p.light) },
      uTop: { value: new Color(p.top) },
      uGhostCol: { value: new Color(p.ghost) },
      uHot: { value: new Color(p.hot) },
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
    toneMapped: false,
  }) as FlaskMaterial;
}

/** A flask quad, `texel` world units per flask pixel, centred on the
 * flask's grid (`material` from makeFlaskMaterial; disposed on unmount). */
export function PixelFlask({ material, texel }: { material: FlaskMaterial; texel: number }) {
  useEffect(() => () => material.dispose(), [material]);
  const scale = useMemo(() => [FLASK_QUAD.w * texel, FLASK_QUAD.h * texel, 1] as [number, number, number], [texel]);
  return <mesh geometry={flaskQuad()} material={material} scale={scale} renderOrder={6} />;
}
