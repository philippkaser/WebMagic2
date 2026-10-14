import { Color, type MeshStandardMaterial } from "three";

/** Wounds you can see on the shell: glowing cracks that open across a body
 * as its life runs out (wounds.ts#crack, in four hard steps). A Voronoi
 * edge pattern in the body's own object space — so the cracks ride with the
 * puppet's squash and tilt — added to the emissive light. More cells crack
 * open as the wound deepens, and their edges widen. The world renders at
 * dpr 0.35, so the lines land as chunky pixels.
 *
 * Patched onto a body's own flash material on its first paint; every enemy
 * shares one program (customProgramCacheKey), each with its own uniforms. */

const FRAG = /* glsl */ `
uniform float uWound;
uniform vec3 uCrackColor;
varying vec3 vWoundPos;
vec3 woundHash(vec3 p) {
  return fract(sin(vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
}
// x: distance to the nearest cell edge; y: that cell's own 0…1 id.
vec2 woundCells(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  float id = 0.0;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 h = woundHash(i + g);
    float d = length(g + h - f);
    if (d < f1) { f2 = f1; f1 = d; id = h.x; }
    else if (d < f2) { f2 = d; }
  }
  return vec2(f2 - f1, id);
}
`;

const APPLY = /* glsl */ `
if (uWound > 0.0) {
  vec2 wc = woundCells(vWoundPos * 4.5);
  // More cells crack open as the wound deepens; their seams widen.
  float open = step(wc.y, uWound);
  float seam = 1.0 - step(0.05 + 0.07 * uWound, wc.x);
  totalEmissiveRadiance += uCrackColor * (seam * open * (2.5 + 3.0 * uWound));
}
`;

interface WoundUniforms {
  wound: { value: number };
  color: { value: Color };
}

/** The material's wound uniforms, patching it on first use. */
export function woundUniforms(mat: MeshStandardMaterial, crackColor: string): WoundUniforms {
  const existing = mat.userData.woundU as WoundUniforms | undefined;
  if (existing) return existing;
  const u: WoundUniforms = { wound: { value: 0 }, color: { value: new Color(crackColor) } };
  mat.userData.woundU = u;
  const prior = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prior?.call(mat, shader, renderer);
    shader.uniforms.uWound = u.wound;
    shader.uniforms.uCrackColor = u.color;
    shader.vertexShader =
      "varying vec3 vWoundPos;\n" +
      shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvWoundPos = position;");
    shader.fragmentShader =
      FRAG + shader.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n" + APPLY);
  };
  mat.customProgramCacheKey = () => "enemy-wound";
  mat.needsUpdate = true;
  return u;
}
