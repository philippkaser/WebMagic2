import { MeshStandardMaterial, type Group } from "three";
import { BoxGeometry, IcosahedronGeometry, SphereGeometry, TorusGeometry } from "three";
import { bake, MAT } from "../models/materials";

/** The Hollow Choir: a hole in the world where a cathedral's congregation
 * was swallowed mid-hymn. A void heart floats inside a broken stone halo;
 * around it circle the singers — pale masks with nothing behind them, eyes
 * and mouths lit by the note they're holding. */

export interface ChoirRig {
  halo: (Group | null)[];
  masks: (Group | null)[];
  heart: Group | null;
}

export const MASK_COUNT = 5;
export const HALO_ARCS = 3;

const heartGeo = new SphereGeometry(0.62, 10, 8);
const heartShellGeo = new IcosahedronGeometry(0.78, 1);
/** One third of the halo (with a gap), in the XZ plane. */
const arcGeo = bake([{ geo: new TorusGeometry(1.45, 0.26, 4, 9, (Math.PI * 2) / HALO_ARCS - 0.35), rot: [Math.PI / 2, 0, 0] }]);
/** Mask: a shallow half-shell facing +Z with a brow ridge. */
const maskGeo = bake([
  { geo: new SphereGeometry(0.36, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2), rot: [Math.PI / 2, 0, 0], scale: [0.85, 1.15, 0.6] },
  { geo: new BoxGeometry(0.46, 0.06, 0.1), pos: [0, 0.12, 0.18] },
]);
const maskGlowGeo = bake([
  // Sorrowful slanted eyes and a mouth held open on its note.
  { geo: new BoxGeometry(0.15, 0.07, 0.05), pos: [-0.11, 0.04, 0.22], rot: [0, 0, 0.3] },
  { geo: new BoxGeometry(0.15, 0.07, 0.05), pos: [0.11, 0.04, 0.22], rot: [0, 0, -0.3] },
  { geo: new BoxGeometry(0.13, 0.22, 0.05), pos: [0, -0.17, 0.2] },
]);

/** Faintly self-lit so the singers read as ghost-pale even across a dark
 * arena; the halo stone carries a violet sheen from the void it circles. */
const porcelain = new MeshStandardMaterial({
  color: "#9a927e",
  emissive: "#4a4030",
  emissiveIntensity: 0.6,
  roughness: 0.5,
  flatShading: true,
});
const haloStone = new MeshStandardMaterial({
  color: "#3e3848",
  emissive: "#3a1d66",
  emissiveIntensity: 0.5,
  roughness: 0.9,
  flatShading: true,
});

export function ChoirModel({
  rig,
  voices,
  rim,
}: {
  rig: ChoirRig;
  /** Eyes/mouths of the masks — they flare as they sing. */
  voices: readonly MeshStandardMaterial[];
  /** The void heart's crackling rim. */
  rim: MeshStandardMaterial;
}) {
  return (
    <group>
      <group ref={(g) => void (rig.heart = g)}>
        <mesh geometry={heartGeo} material={MAT.void} />
        <mesh geometry={heartShellGeo} material={rim} />
      </group>
      {Array.from({ length: HALO_ARCS }, (_, i) => (
        <group key={i} ref={(g) => void (rig.halo[i] = g)} rotation={[0, (i / HALO_ARCS) * Math.PI * 2, 0]}>
          <mesh geometry={arcGeo} material={haloStone} castShadow />
        </group>
      ))}
      {Array.from({ length: MASK_COUNT }, (_, i) => (
        <group key={i} ref={(g) => void (rig.masks[i] = g)}>
          <mesh geometry={maskGeo} material={porcelain} scale={1.5} castShadow />
          <mesh geometry={maskGlowGeo} material={voices[i]} scale={1.5} />
        </group>
      ))}
    </group>
  );
}
