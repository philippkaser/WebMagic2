import { AdditiveBlending, Color, PlaneGeometry, ShaderMaterial } from "three";

/** A soft light that always faces the eye: the halo round a glowing flask,
 * the flare as an object lands. The UI canvas has no bloom pass, so glow is
 * painted on purpose, where it belongs.
 *
 * Additive with alpha 0 (the UiSparks trick): on the transparent UI canvas it
 * only ADDS light to the world beneath, never covers it. The billboard takes
 * its size from the mesh's world scale, so a parent's squash or shrink
 * reaches it. */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 scale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
  mv.xy += position.xy * scale;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uCore;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - r), 2.4) * uIntensity;
  a += exp(-r * r * 40.0) * uCore;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor * a, 0.0);
  #include <colorspace_fragment>
  gl_FragColor.a = 0.0;
}
`;

export type GlowMaterial = ShaderMaterial & {
  uniforms: { uColor: { value: Color }; uIntensity: { value: number }; uCore: { value: number } };
};

/** One per glowing thing: intensity is animated per instance. */
export function makeGlowMaterial(color: string, intensity = 1, core = 0): GlowMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uIntensity: { value: intensity }, uCore: { value: core } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    premultipliedAlpha: true,
  }) as GlowMaterial;
}

let quad: PlaneGeometry | null = null;
/** The unit quad every glow billboard is drawn on. */
export function glowQuad(): PlaneGeometry {
  return (quad ??= new PlaneGeometry(1, 1));
}
