import type { MeshStandardMaterial } from "three";

/** A body that dissolves the pixel-art way: an ordered 4×4 Bayer dither on
 * the render target's own pixels (the world renders at dpr 0.35, so the
 * cells read as chunky pixels), never a soft alpha blend. `uFade` 1 is
 * solid, 0 is gone. Every corpse material shares one program
 * (customProgramCacheKey), each with its own uniform. */

const CHUNK = /* glsl */ `
uniform float uFade;
float corpseBayer(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[x + y * 4] + 0.5) / 16.0;
}
`;

/** Patch `mat` (before its first render) and return its fade uniform. */
export function withDitherFade(mat: MeshStandardMaterial): { value: number } {
  const fade = { value: 1 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFade = fade;
    shader.fragmentShader =
      CHUNK +
      shader.fragmentShader.replace(
        "#include <clipping_planes_fragment>",
        "#include <clipping_planes_fragment>\n\tif (uFade < 0.999 && corpseBayer(gl_FragCoord.xy) >= uFade) discard;",
      );
  };
  mat.customProgramCacheKey = () => "corpse-dither";
  return fade;
}
