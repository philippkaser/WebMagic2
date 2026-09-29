import { useMemo, type Ref } from "react";
import { BoxGeometry, MeshStandardMaterial, PlaneGeometry } from "three";
import { getRuneTextures } from "../textures";
import { shared, surfaceMaterial } from "./shared";

/** A lore rune: a carved stone tablet mounted on a wall, its glyph glowing
 * from the bottom of the carving. Every `seed` (a lore fragment id) paints a
 * different glyph and line of script, identically on every client.
 *
 * Local space: the tablet FACES +Z and is centred on the origin vertically.
 * Rotate the whole model by the layout's `facing` yaw. By default its back
 * sits `wallOffset` = 0.08 m behind the origin — flush with the wall for a
 * rune placed 0.46 tiles (0.92 m) from its tile centre toward the wall, as
 * the generator does. Pass a different offset if the placement changes.
 *
 * The glyph is its own overlay plane (alpha-tested, not tone-mapped) so it
 * can glow like every other emissive in the game while the stone around it
 * stays tone-mapped with the rest of the wall. `glowRef` is that overlay's
 * material: behaviour pulses `emissiveIntensity` (resting value
 * `intensity`), e.g. brighter while the rune is being read. */

export interface LoreRuneModelProps {
  seed: string;
  /** Glyph glow color. */
  color: string;
  glowRef?: Ref<MeshStandardMaterial>;
  /** Resting glow brightness. */
  intensity?: number;
  /** Distance from the origin back to the wall surface (m). */
  wallOffset?: number;
  castShadow?: boolean;
}

const W = 0.7;
const H = 0.86;
const DEPTH = 0.12;
const FACE = 0.58;
const FACE_Y = -0.03;

const frameGeo = shared(() => new BoxGeometry(W, H, DEPTH));
const ledgeGeo = shared(() => new BoxGeometry(W + 0.1, 0.06, DEPTH + 0.04));
const faceGeo = shared(() => new PlaneGeometry(FACE, FACE));
const frameMat = shared(() =>
  surfaceMaterial("slab", { roughness: 0.85, metalness: 0.05, envMapIntensity: 0.4 }),
);

export function LoreRuneModel({
  seed,
  color,
  glowRef,
  intensity = 1.6,
  wallOffset = 0.08,
  castShadow = false,
}: LoreRuneModelProps) {
  const tex = useMemo(() => getRuneTextures(seed), [seed]);
  const back = -wallOffset;
  const front = back + DEPTH;
  return (
    <group>
      <mesh geometry={frameGeo()} material={frameMat()} position={[0, 0, back + DEPTH / 2]} castShadow={castShadow} receiveShadow />
      {[H / 2, -H / 2].map((y) => (
        <mesh key={y} geometry={ledgeGeo()} material={frameMat()} position={[0, y, back + DEPTH / 2 + 0.02]} castShadow={castShadow} receiveShadow />
      ))}
      {/* Carved face: bevelled stone with the glyph cut in (normal-mapped). */}
      <mesh geometry={faceGeo()} position={[0, FACE_Y, front + 0.002]} receiveShadow>
        <meshStandardMaterial map={tex.map} normalMap={tex.normalMap} roughness={0.85} />
      </mesh>
      {/* The glow, exactly over the carving. The emissive map is sRGB, so as
          an alpha map it samples linear: strokes ≈ 1, the dim script ≈ 0.22,
          the halo ≈ 0.02 — alphaTest 0.1 keeps strokes + script, drops halo. */}
      <mesh geometry={faceGeo()} position={[0, FACE_Y, front + 0.004]}>
        <meshStandardMaterial
          ref={glowRef}
          color="#000000"
          emissive={color}
          emissiveIntensity={intensity}
          emissiveMap={tex.emissiveMap}
          alphaMap={tex.emissiveMap}
          alphaTest={0.1}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
