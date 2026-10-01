import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  FrontSide,
  Group,
  LatheGeometry,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Vector2,
  type Texture,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { getModelTextures, type ModelTextureKind } from "./modelPaint";

/** Tiny construction kit for the procedural models. Models are assembled
 * imperatively once into template groups (cached per kind), then cloned per
 * use — clones share every geometry and material, so ten crates cost zero
 * extra GPU buffers or shader programs. Static templates are additionally
 * `bake`d: parts sharing a material merge into one mesh, so a crate with two
 * dozen planks and brackets is three draw calls. Materials are interned by
 * their parameters for the same reason.
 *
 * Templates are plain three.js objects, so they render in either canvas (the
 * world's and the in-world UI's): three.js uploads a shared buffer once per
 * renderer. */

export interface StdOpts {
  tex?: ModelTextureKind;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  emissiveMap?: Texture;
  flatShading?: boolean;
  doubleSide?: boolean;
}

const materials = new Map<string, Material>();

/** Interned lit material: same color + options → same instance. */
export function std(color: string, o: StdOpts = {}): MeshStandardMaterial {
  const key = `std|${color}|${o.tex ?? ""}|${o.roughness ?? 0.85}|${o.metalness ?? 0}|${o.emissive ?? ""}|${
    o.emissiveIntensity ?? 1
  }|${o.emissiveMap?.uuid ?? ""}|${o.flatShading ? 1 : 0}|${o.doubleSide ? 1 : 0}`;
  const hit = materials.get(key);
  if (hit) return hit as MeshStandardMaterial;
  const maps = o.tex ? getModelTextures(o.tex) : null;
  const m = new MeshStandardMaterial({
    color,
    map: maps?.map ?? null,
    normalMap: maps?.normalMap ?? null,
    roughness: o.roughness ?? 0.85,
    metalness: o.metalness ?? 0,
    flatShading: o.flatShading ?? false,
    side: o.doubleSide ? DoubleSide : FrontSide,
  });
  if (o.emissive) {
    m.emissive = new Color(o.emissive);
    m.emissiveIntensity = o.emissiveIntensity ?? 1;
    m.emissiveMap = o.emissiveMap ?? null;
  }
  materials.set(key, m);
  return m;
}

/** Interned self-lit material for crystals, eyes and embers. Not tone-mapped
 * so it can push past 1.0 and feed the bloom pass. */
export function glow(color: string, intensity = 2.5): MeshStandardMaterial {
  const key = `glow|${color}|${intensity}`;
  const hit = materials.get(key);
  if (hit) return hit as MeshStandardMaterial;
  const m = new MeshStandardMaterial({
    color: "#07060a",
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.25,
    metalness: 0.2,
    toneMapped: false,
  });
  materials.set(key, m);
  return m;
}

/** Interned additive, unlit material for halos, wings and afterimages. */
export function additive(color: string, opacity = 1, map?: Texture): MeshBasicMaterial {
  const key = `add|${color}|${opacity}|${map?.uuid ?? ""}`;
  const hit = materials.get(key);
  if (hit) return hit as MeshBasicMaterial;
  const m = new MeshBasicMaterial({
    color,
    map: map ?? null,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  });
  materials.set(key, m);
  return m;
}

export type V3 = [number, number, number];

/** Place a mesh: position, Euler rotation, scale (uniform or per-axis). */
export function part(
  geo: BufferGeometry,
  material: Material,
  p: V3 = [0, 0, 0],
  r: V3 = [0, 0, 0],
  s: number | V3 = 1,
  shadow = true,
): Mesh {
  const m = new Mesh(geo, material);
  m.position.set(p[0], p[1], p[2]);
  m.rotation.set(r[0], r[1], r[2]);
  if (typeof s === "number") m.scale.setScalar(s);
  else m.scale.set(s[0], s[1], s[2]);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}

export function group(children: Object3D[], p: V3 = [0, 0, 0], r: V3 = [0, 0, 0]): Group {
  const g = new Group();
  g.position.set(p[0], p[1], p[2]);
  g.rotation.set(r[0], r[1], r[2]);
  for (const c of children) g.add(c);
  return g;
}

/** Lathe from a flat [radius, y] profile — pots, flasks, robes, hoods. */
export function lathe(profile: [number, number][], segments: number, phiStart = 0, phiLength = Math.PI * 2): LatheGeometry {
  return new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    segments,
    phiStart,
    phiLength,
  );
}

/** Deterministic vertex jitter: breaks up the perfect CG symmetry of
 * primitives (stones, bark, rubble) so they read hand-hewn. Hashes by
 * rounded position so shared seam vertices move together (no cracks). */
export function roughen<T extends BufferGeometry>(geo: T, amount: number, seed = 1): T {
  const pos = geo.getAttribute("position");
  const hash = (x: number, y: number, z: number) => {
    const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.3) * 43758.5453;
    return h - Math.floor(h) - 0.5;
  };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const kx = Math.round(x * 1000) / 1000;
    const ky = Math.round(y * 1000) / 1000;
    const kz = Math.round(z * 1000) / 1000;
    pos.setXYZ(i, x + hash(kx, ky, kz) * amount, y + hash(ky, kz, kx) * amount, z + hash(kz, kx, ky) * amount);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Deep-clone a template's hierarchy while sharing geometry + materials. */
export function instance(template: Object3D): Object3D {
  return template.clone(true);
}

const dimmedCache = new WeakMap<Material, Map<number, Material>>();

/** A darker twin of a lit material. The first-person viewmodel sits a hand's
 * breadth from the player's big personal light, so its surfaces would blow
 * out to white; dimming the albedo keeps them reading as wood and leather. */
export function dimmed<T extends Material>(m: T, factor: number): T {
  let byFactor = dimmedCache.get(m);
  if (!byFactor) {
    byFactor = new Map();
    dimmedCache.set(m, byFactor);
  }
  let d = byFactor.get(factor);
  if (!d) {
    d = m.clone();
    if (d instanceof MeshStandardMaterial) d.color.multiplyScalar(factor);
    byFactor.set(factor, d);
  }
  return d as T;
}

/** Swap every non-glow mesh material under `root` for its dimmed twin. */
export function dimTree(root: Object3D, factor: number): void {
  root.traverse((n) => {
    if (n instanceof Mesh && !n.userData.glow) n.material = dimmed(n.material as Material, factor);
  });
}

/** Merge a static assembly into one mesh per material. Transforms of every
 * part (including nested groups) are baked into the vertices. Parts tagged
 * with `userData` flags (glow, spin, …) are kept as separate meshes so owners
 * can still find and animate them. */
export function bake(root: Object3D, shadow = true): Group {
  root.updateMatrixWorld(true);
  const byMaterial = new Map<Material, BufferGeometry[]>();
  const keep: Mesh[] = [];
  root.traverse((n) => {
    if (!(n instanceof Mesh)) return;
    if (Object.keys(n.userData).length) {
      keep.push(n);
      return;
    }
    let g = n.geometry as BufferGeometry;
    g = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(n.matrixWorld);
    for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
    const list = byMaterial.get(n.material as Material) ?? [];
    list.push(g);
    byMaterial.set(n.material as Material, list);
  });
  const out = new Group();
  for (const [material, geos] of byMaterial) {
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    const m = new Mesh(merged, material);
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    out.add(m);
  }
  for (const k of keep) {
    const clone = k.clone();
    k.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
    out.add(clone);
  }
  return out;
}

/** A template cache: build on first use, clone per instance. */
export function templateCache<K>(build: (key: K) => Object3D): (key: K) => Object3D {
  const templates = new Map<K, Object3D>();
  return (key) => {
    let t = templates.get(key);
    if (!t) {
      t = build(key);
      templates.set(key, t);
    }
    return instance(t);
  };
}
