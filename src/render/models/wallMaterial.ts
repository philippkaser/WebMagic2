import { Color, MeshStandardMaterial, type WebGLProgramParametersWithUniforms } from "three";
import { WALL_HEIGHT } from "../../core/config";
import { getSurface, type SurfaceKind } from "../textures";

/** The dungeon's stone material: a surface's maps (world-mapped, see
 * architectureMesh.ts) plus two effects that depend on HEIGHT, which a
 * texture tiling every 4 m can't carry:
 *
 *  - a damp band at the foot of every wall and pillar — darker, tinted and
 *    glossier, with a ragged upper edge — so torchlight glints where stone
 *    meets floor and the rooms feel wet from the ground up;
 *  - a slow fade toward the vault, so 7 m walls dissolve upward into gloom
 *    instead of ending at a lit seam.
 *
 * Both are a few ALU ops in the standard shader (onBeforeCompile), driven by
 * per-biome uniforms. One material per (surface, look), shared by walls,
 * base course, piers, ribs, pillars and the ceiling — one program. */

export interface StoneLook {
  /** Albedo multiplier at the very foot of the wall. */
  dampTint: string;
  /** Height (m) the damp reaches (its ragged edge wanders ±20%). */
  dampHeight: number;
  /** Roughness multiplier inside the damp band (< 1 = glossier). */
  dampGloss: number;
  /** Albedo multiplier at the vault (the top fades toward this). */
  vaultShade: number;
}

const cache = new Map<string, MeshStandardMaterial>();

export function stoneMaterial(kind: SurfaceKind, look: StoneLook): MeshStandardMaterial {
  const key = `${kind}|${look.dampTint}|${look.dampHeight}|${look.dampGloss}|${look.vaultShade}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const mat = new MeshStandardMaterial({ ...getSurface(kind).material });
  const uniforms = {
    uDampTint: { value: new Color(look.dampTint) },
    uDampHeight: { value: look.dampHeight },
    uDampGloss: { value: look.dampGloss },
    uVaultShade: { value: look.vaultShade },
    uVault: { value: WALL_HEIGHT },
  };
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vStoneWorld;")
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvStoneWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec3 uDampTint;
uniform float uDampHeight;
uniform float uDampGloss;
uniform float uVaultShade;
uniform float uVault;
varying vec3 vStoneWorld;`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
// Ragged tide line: the damp's reach wanders with position, never ruled.
float stoneWob = 0.5 * sin(vStoneWorld.x * 1.3 + vStoneWorld.z * 0.7)
  + 0.5 * sin(vStoneWorld.x * 0.37 - vStoneWorld.z * 1.9);
float stoneReach = uDampHeight * (0.8 + 0.2 * stoneWob);
float stoneWet = 1.0 - smoothstep(stoneReach * 0.3, stoneReach, vStoneWorld.y);
diffuseColor.rgb *= mix(vec3(1.0), uDampTint, stoneWet);
diffuseColor.rgb *= mix(1.0, uVaultShade, smoothstep(uVault * 0.5, uVault, vStoneWorld.y));`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
roughnessFactor *= mix(1.0, uDampGloss, stoneWet);`,
      );
  };
  // One program per look, not per material instance of it.
  mat.customProgramCacheKey = () => "webmagic-stone";
  cache.set(key, mat);
  return mat;
}
