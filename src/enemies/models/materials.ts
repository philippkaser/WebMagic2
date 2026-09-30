import { useEffect, useMemo } from "react";
import { BufferGeometry, DoubleSide, Matrix4, MeshStandardMaterial, Euler, Quaternion, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Shared, module-level surfaces for the bestiary. Flat-shaded and matte so
 * the low-res pixel pass reads them as chunky facets, and kept dark: the
 * wizard's own staff light is fierce up close, and pale albedo blows out.
 * The only per-instance material an enemy owns is its glow (eyes, runes,
 * cores), because that one animates — hit flashes and attack telegraphs. */

const flat = (color: string, roughness = 0.85, metalness = 0) =>
  new MeshStandardMaterial({ color, roughness, metalness, flatShading: true });

export const MAT = {
  bone: flat("#857a62"),
  boneDark: flat("#4a4234"),
  stone: flat("#4a4452", 0.95),
  stoneDark: flat("#2a2630", 0.95),
  iron: flat("#2a262e", 0.45, 0.7),
  rust: flat("#5a3424", 0.8, 0.3),
  rot: flat("#3a4c44", 0.8),
  rotDark: flat("#1e2a26", 0.9),
  barnacle: flat("#666150", 0.95),
  clothWet: new MeshStandardMaterial({
    color: "#15201e",
    roughness: 0.6,
    flatShading: true,
    side: DoubleSide,
  }),
  impSkin: flat("#5a1c12", 0.7),
  horn: flat("#1a1210", 0.5),
  wing: new MeshStandardMaterial({ color: "#2e0c08", roughness: 0.8, flatShading: true, side: DoubleSide }),
  rock: flat("#3b4050", 0.95),
  rockDark: flat("#232633", 0.95),
  crystal: new MeshStandardMaterial({
    color: "#123646",
    emissive: "#2fb8ff",
    emissiveIntensity: 0.45,
    roughness: 0.2,
    metalness: 0.2,
    flatShading: true,
  }),
  teeth: flat("#a89f88", 0.6),
  flesh: flat("#7a1822", 0.5),
  void: new MeshStandardMaterial({ color: "#000000", roughness: 1 }),
  whiteHot: new MeshStandardMaterial({
    color: "#000000",
    emissive: "#fff4e6",
    emissiveIntensity: 3.2,
    toneMapped: false,
  }),
} as const;

/** One enemy's animated emissive material, disposed with it. */
export function useGlow(color: string, intensity: number): MeshStandardMaterial {
  const mat = useMemo(
    () =>
      new MeshStandardMaterial({
        color: "#000000",
        emissive: color,
        emissiveIntensity: intensity,
        toneMapped: false,
      }),
    [color, intensity],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  return mat;
}

const m4 = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const s = new Vector3();
const p = new Vector3();

/** Bake several primitives (each with position/rotation/scale) into one
 * geometry — static parts of a model cost one draw call. Module-level only. */
export function bake(
  parts: {
    geo: BufferGeometry;
    pos?: [number, number, number];
    rot?: [number, number, number];
    scale?: [number, number, number];
  }[],
): BufferGeometry {
  const geos = parts.map(({ geo, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] }) => {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).deleteAttribute("uv");
    m4.compose(p.set(...pos), q.setFromEuler(e.set(...rot)), s.set(...scale));
    return g.applyMatrix4(m4);
  });
  const merged = mergeGeometries(geos, false);
  merged.computeVertexNormals();
  return merged;
}
