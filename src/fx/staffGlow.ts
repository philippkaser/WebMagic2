import { AdditiveBlending, Color, ShaderMaterial } from "three";
import { fxUniforms } from "./fxUniforms";

/** The staff crystal's aura, drawn on a small quad parented to the
 * first-person viewmodel (so, unlike world particles, it can never lag behind
 * a strafing wizard). At rest: a breathing glow with three motes orbiting the
 * crystal. On a cast (`uFlash` → 1, decaying): a rotating four-point star
 * and a white-hot core — the muzzle flash, seen from behind the staff.
 * Procedural, no textures. */

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

float dotAt(vec2 p, vec2 c, float r) {
  float d = length(p - c) / r;
  return max(0.0, 1.0 - d * d);
}

void main() {
  vec2 p = vUv;
  float r = length(p);
  float breathe = 0.85 + 0.15 * sin(uTime * 2.7);
  float glow = pow(max(0.0, 1.0 - r), 3.0) * 0.55 * breathe;
  // Orbiting motes (an ellipse, as if circling the crystal in depth).
  float motes = 0.0;
  for (int i = 0; i < 3; i++) {
    float a = uTime * (1.6 + float(i) * 0.35) + float(i) * 2.094;
    vec2 c = vec2(cos(a) * 0.52, sin(a) * 0.2 + 0.05 * sin(uTime * 3.0 + float(i)));
    motes += dotAt(p, c, 0.11);
  }
  // Cast flash: rotating star + hot core.
  float ang = uTime * 1.3;
  vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p;
  float rays = max(0.0, 1.0 - abs(q.x) * 12.0) * (1.0 - abs(q.y))
             + max(0.0, 1.0 - abs(q.y) * 12.0) * (1.0 - abs(q.x));
  float core = pow(max(0.0, 1.0 - r), 4.0);
  vec3 col = uColor * (glow + motes * 1.4 + rays * uFlash * 2.2 + core * uFlash * 1.5)
           + vec3(1.0) * core * uFlash * 1.8;
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
