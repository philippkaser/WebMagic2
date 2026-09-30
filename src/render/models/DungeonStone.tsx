import { useEffect, useMemo } from "react";
import { AdditiveBlending, Color, MeshBasicMaterial, ShaderMaterial, UniformsLib, UniformsUtils } from "three";
import { WALL_HEIGHT } from "../../core/config";
import type { FloorArchitecture } from "../../world/types";
import type { SurfaceKind } from "../textures";
import { MeshBuilder, buildArchitectureMeshes } from "./architectureMesh";
import { toGeometry } from "./meshGeometry";
import { type StoneLook, stoneMaterial } from "./wallMaterial";

/** The floor's stonework and vault: walls, base course, ribs on their piers
 * and pillars in one world-mapped mesh (one draw), the ceiling, and — where
 * the biome asks for them — glowing heat seams at the foot of the walls
 * with their glow spilling onto the floor. Presentational: colliders and
 * lights are the scene's (scenes/DungeonFloor.tsx). */

export interface DungeonStoneProps {
  tiles: Uint8Array;
  size: number;
  extent: number;
  architecture: FloorArchitecture;
  wall: SurfaceKind;
  ceiling: SurfaceKind;
  look: StoneLook;
  /** Share of wall faces with a glowing seam at their foot (0 = none). */
  seamChance: number;
  seamColor: string;
}

/** Heat bleeding from a seam across the floor: a soft half-ellipse drawn
 * from the quad's UVs (u along the crack, v away from the wall), additive,
 * fading with the fog like everything else. */
function seamGlowMaterial(color: string): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog, { uColor: { value: new Color(color) } }]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float d = length(vec2((vUv.x - 0.5) * 2.0, vUv.y * 1.15));
        float a = pow(max(0.0, 1.0 - d), 2.2) * 0.55;
        #ifdef USE_FOG
          a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
        #endif
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

export function DungeonStone(props: DungeonStoneProps) {
  const { tiles, size, extent, architecture, wall, ceiling, look, seamChance, seamColor } = props;
  const geo = useMemo(() => {
    const m = buildArchitectureMeshes({ tiles, size, architecture }, { seamChance });
    const b = new MeshBuilder();
    b.quad(
      [-extent, WALL_HEIGHT, -extent],
      [extent, WALL_HEIGHT, -extent],
      [extent, WALL_HEIGHT, extent],
      [-extent, WALL_HEIGHT, extent],
      [0, -1, 0],
    );
    return {
      stone: toGeometry(m.stone),
      seams: m.seams.indices.length ? toGeometry(m.seams) : null,
      seamGlow: m.seamGlow.indices.length ? toGeometry(m.seamGlow) : null,
      ceiling: toGeometry(b.build()),
    };
  }, [tiles, size, extent, architecture, seamChance]);
  useEffect(
    () => () => {
      geo.stone.dispose();
      geo.seams?.dispose();
      geo.seamGlow?.dispose();
      geo.ceiling.dispose();
    },
    [geo],
  );

  const stoneMat = stoneMaterial(wall, look);
  // The vault shares the wall's stone (and its fade to gloom) unless the
  // biome roofs itself with something else entirely.
  const ceilingMat = ceiling === wall ? stoneMat : stoneMaterial(ceiling, { ...look, dampHeight: 0 });
  const seamMats = useMemo(
    () => ({
      // Pushed past 1.0 so the crack itself clears the bloom threshold.
      line: new MeshBasicMaterial({ color: new Color(seamColor).multiplyScalar(2.6), toneMapped: false }),
      glow: seamGlowMaterial(seamColor),
    }),
    [seamColor],
  );
  useEffect(
    () => () => {
      seamMats.line.dispose();
      seamMats.glow.dispose();
    },
    [seamMats],
  );

  return (
    <group>
      <mesh geometry={geo.stone} material={stoneMat} castShadow receiveShadow />
      <mesh geometry={geo.ceiling} material={ceilingMat} />
      {geo.seams && <mesh geometry={geo.seams} material={seamMats.line} />}
      {geo.seamGlow && <mesh geometry={geo.seamGlow} material={seamMats.glow} />}
    </group>
  );
}
