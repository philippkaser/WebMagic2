import { AdditiveBlending, Color, ShaderMaterial } from "three";
import { fxUniforms } from "./fxUniforms";

/** The staff crystal's aura, drawn on a small quad parented to the
 * first-person viewmodel (so, unlike world particles, it can never lag behind
 * a strafing wizard). Pixel-magic like every other fx: shapes are measured in
 * the render target's own pixels (uv ÷ its screen derivative) and drawn hard,
 * in flat stepped levels. At rest: a banded glow breathing between two
 * levels, and three 2×2 motes orbiting the crystal. On a cast (uFlash → 1,
 * decaying): a hard plus-shaped burst of pixels with diagonal glints and a
 * white-hot square core, which flips between + and × as it dies — the
 * pixel-art twinkle. Procedural, no textures. */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uFlash;
uniform float uTime;
varying vec2 vUv;

/** Brightness of a plus of arms reaching len pixels, in three bands. */
float plusArms(vec2 q, float len, float w) {
  vec2 a = abs(q);
  float along = max(a.x, a.y);
  if (min(a.x, a.y) > w || along > len) return 0.0;
  float f = along / max(len, 1.0);
  return f < 0.3 ? 2.2 : (f < 0.62 ? 1.2 : 0.5);
}

void main() {
  // Pixel coordinates from the quad's centre: one unit = one rendered pixel.
  vec2 px = vUv / max(fwidth(vUv), vec2(1e-4));
  vec2 q = floor(px) + 0.5;
  float R = 1.0 / max(fwidth(vUv.x), 1e-4);
  float d = length(q) / R;

  // Resting glow: three flat rings, breathing between two levels.
  float breathe = sin(uTime * 2.7) > 0.0 ? 1.0 : 0.82;
  float glow = d < 0.1 ? 0.6 : (d < 0.2 ? 0.3 : (d < 0.32 ? 0.12 : 0.0));
  glow *= breathe;

  // Orbiting motes (an ellipse, as if circling the crystal in depth): 2×2
  // pixel squares with a dim 1-px plus around them.
  float motes = 0.0;
  for (int i = 0; i < 3; i++) {
    float a = uTime * (1.6 + float(i) * 0.35) + float(i) * 2.094;
    vec2 c = floor(vec2(cos(a) * 0.52, sin(a) * 0.2 + 0.05 * sin(uTime * 3.0 + float(i))) * R + 0.5);
    vec2 m = abs(q - c);
    float ch = max(m.x, m.y);
    if (ch < 1.0) motes += 1.4;
    else if (ch < 2.0 && min(m.x, m.y) < 1.0) motes += 0.35;
  }

  // Cast flash: plus arms (a × as it fades), diagonal glints, square core.
  float flash = 0.0;
  float core = 0.0;
  if (uFlash > 0.02) {
    float len = floor(uFlash * R * 0.95);
    bool turned = uFlash < 0.55 && fract(uTime * 7.0) > 0.5;
    vec2 qa = turned ? vec2(q.x + q.y, q.x - q.y) * 0.5 : q;
    float lenA = turned ? floor(len * 0.6) : len;
    float w = uFlash > 0.6 ? 1.5 : 0.5;
    flash = plusArms(qa, lenA, w);
    vec2 aq = abs(q);
    if (!turned && abs(aq.x - aq.y) < 0.5 && max(aq.x, aq.y) < len * 0.3) flash = max(flash, 0.8);
    float cs = floor(2.5 * uFlash) + 0.5;
    if (max(aq.x, aq.y) < cs) core = 1.0;
    flash *= uFlash > 0.5 ? 1.0 : 0.6;
  }

  vec3 col = uColor * (glow + motes + flash * 1.6 + core * 1.2) + vec3(1.0) * core * 1.6;
  if (col.r + col.g + col.b < 0.003) discard;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createStaffGlowMaterial(color: string): ShaderMaterial {
  const c = new Color(color);
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: c },
      uFlash: { value: 0 },
      uTime: fxUniforms.uTime,
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}
