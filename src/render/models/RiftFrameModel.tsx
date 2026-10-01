import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  Euler,
  Matrix4,
  MeshStandardMaterial,
  NearestFilter,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Rng, hashSeed } from "../../core/rng";
import { shared } from "./shared";

/** The stonework around every rift (ported from the artpass branch's
 * AltarModels): a round rune dais under the tear with a glowing inlaid ring,
 * a tall standing stone leaning in on one side, a snapped one on the other
 * (its top lying in the dust), and rubble. The carvings are an emissive glyph
 * map, so the same stone glows in whatever colour its rift burns — cyan for
 * the way down, gold for the way home.
 *
 * Built once: every part is baked into TWO merged geometries (plain stone and
 * rune-carved stone), shared by every rift; only the rune material differs
 * per colour. Origin is the ground at the rift's centre; the stones stand
 * behind the tear (−Z) so the approach (+Z) stays open.
 *
 * The two textures are painted here rather than in render/textures because
 * nothing else wears them: dark basalt with carved grooves, and a black
 * field of bright stroke runes used only as an emissive map. */

/** Footprints of the solid stones, for the owner's colliders (rift-local
 * centre + half extents). Both stand behind the tear and inside x ∈ ±2.1, so
 * the way home two tiles along x from the descent never overlaps them. */
export const RIFT_STONES: { pos: [number, number, number]; half: [number, number, number] }[] = [
  { pos: [-1.75, 1.3, -1.3], half: [0.3, 1.3, 0.3] },
  { pos: [1.75, 0.8, -1.2], half: [0.32, 0.8, 0.32] },
];

// ── Textures ─────────────────────────────────────────────────────────────────

const TEX = 64;

function pixelTexture(rgba: Uint8Array, srgb: boolean): DataTexture {
  const t = new DataTexture(rgba, TEX, TEX);
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Dark basalt with carved grooves, like weathered glyph rows — colour plus
 * a Sobel normal map from its height field, so torchlight catches the cuts. */
const runestoneTex = shared(() => {
  const rng = new Rng(hashSeed("rift:runestone"));
  const color = new Uint8Array(TEX * TEX * 4);
  const height = new Float32Array(TEX * TEX);
  const groove = (x: number, y: number) => y % 11 > 7 && Math.sin(x * 0.9 + y * 4.7) > -0.35 && x % 13 !== 0;
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const n = rng.next();
      const i = y * TEX + x;
      let r: number, g: number, b: number;
      if (groove(x, y)) {
        const v = 14 + n * 8;
        [r, g, b] = [v, v * 1.05, v * 1.3];
        height[i] = 0.12;
      } else {
        const fleck = n > 0.96 ? 1.9 : 1;
        const v = (30 + n * 16) * fleck;
        [r, g, b] = [v * 0.95, v * 0.97, v * 1.12];
        height[i] = 0.6 + n * 0.3;
      }
      color.set([r, g, b, 255], i * 4);
    }
  }
  const normal = new Uint8Array(TEX * TEX * 4);
  const h = (x: number, y: number) => height[((y + TEX) % TEX) * TEX + ((x + TEX) % TEX)];
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const dx = (h(x - 1, y) - h(x + 1, y)) * 2.4;
      const dy = (h(x, y - 1) - h(x, y + 1)) * 2.4;
      const len = Math.hypot(dx, dy, 1);
      normal.set(
        [((dx / len) * 0.5 + 0.5) * 255, ((dy / len) * 0.5 + 0.5) * 255, ((1 / len) * 0.5 + 0.5) * 255, 255],
        (y * TEX + x) * 4,
      );
    }
  }
  return { map: pixelTexture(color, true), normalMap: pixelTexture(normal, false) };
});

/** Rows of 5×7 stroke glyphs — a stem and a branch or two — white on black:
 * reads as "runes" at any size without being a real script. */
const glyphTex = shared(() => {
  const rng = new Rng(hashSeed("rift:glyphs"));
  const px = new Uint8Array(TEX * TEX * 4);
  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  const stroke = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= TEX || y >= TEX) return;
    px.set([255, 255, 255], (y * TEX + x) * 4);
  };
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 9; col++) {
      const ox = 2 + col * 7;
      const oy = 2 + row * 9;
      if (rng.next() < 0.12) continue; // word gaps
      const stem = 1 + rng.int(0, 1);
      for (let y = 0; y < 7; y++) stroke(ox + stem, oy + y);
      const branches = 1 + rng.int(0, 1);
      for (let b = 0; b < branches; b++) {
        const by = rng.int(0, 4);
        const dir = rng.chance(0.5) ? 1 : -1;
        for (let k = 1; k < 3; k++) stroke(ox + stem + dir * k, oy + by + (rng.chance(0.5) ? k : 0));
      }
    }
  }
  return pixelTexture(px, false);
});

// ── Geometry ─────────────────────────────────────────────────────────────────

/** Deterministic vertex jitter so primitives read hand-hewn. Hashed by
 * rounded position, so seam vertices move together (no cracks). */
function roughen<T extends BufferGeometry>(geo: T, amount: number, seed: number): T {
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

const menhir = (h: number, seed: number) => roughen(new CylinderGeometry(0.22, 0.34, h, 5, 4), 0.05, seed);

/** Every part placed and merged: [plain stone, rune-carved stone]. */
const frameGeo = shared(() => {
  const plain: BufferGeometry[] = [];
  const runes: BufferGeometry[] = [];
  const m = new Matrix4();
  const q = new Quaternion();
  const one = new Vector3(1, 1, 1);
  const put = (
    into: BufferGeometry[],
    g: BufferGeometry,
    p: [number, number, number],
    r: [number, number, number] = [0, 0, 0],
  ) => {
    q.setFromEuler(new Euler(r[0], r[1], r[2]));
    g.applyMatrix4(m.compose(new Vector3(...p), q, one));
    into.push(g);
  };
  // Round dais under the tear, with a glowing inlaid ring.
  put(plain, roughen(new CylinderGeometry(1.75, 1.85, 0.24, 10, 1), 0.03, 11), [0, 0.12, 0]);
  put(runes, new TorusGeometry(1.45, 0.035, 3, 24), [0, 0.245, 0], [Math.PI / 2, 0, 0]);
  // Tall stone on the left, leaning in.
  put(runes, menhir(2.7, 12), [-1.75, 1.3, -1.3], [0.06, 0.4, -0.08]);
  // The right one snapped: a stump, and its top lying in the dust.
  put(runes, menhir(1.6, 13), [1.75, 0.8, -1.2], [-0.05, -0.3, 0.06]);
  put(plain, menhir(1.1, 14), [0.75, 0.25, -2.1], [Math.PI / 2 - 0.1, 1.9, 0.2]);
  // Rubble.
  put(plain, roughen(new BoxGeometry(0.34, 0.24, 0.3), 0.04, 15), [-1.2, 0.12, 1.4], [0, 0.5, 0.1]);
  put(plain, roughen(new BoxGeometry(0.22, 0.18, 0.26), 0.03, 16), [1.35, 0.09, 0.9], [0.2, 1.1, 0]);
  put(plain, roughen(new BoxGeometry(0.18, 0.14, 0.2), 0.03, 17), [-1.9, 0.07, -0.5], [0, 0.3, 0.3]);
  const merge = (parts: BufferGeometry[]) => {
    const merged = mergeGeometries(parts);
    for (const g of parts) g.dispose();
    merged.computeBoundingSphere();
    return merged;
  };
  return { plain: merge(plain), runes: merge(runes) };
});

const plainMat = shared(() => {
  const t = runestoneTex();
  return new MeshStandardMaterial({ color: "#4a4658", map: t.map, normalMap: t.normalMap, roughness: 0.9 });
});

/** Rune glow at rest (emissiveIntensity); the owner scales it per frame. */
export const RIFT_RUNE_GLOW = 0.8;

/** A rift's rune-carved stone: its own instance, because the owner drives
 * its glow every frame (the carvings smoulder while sealed, burn when open,
 * flare as a seal breaks). Only the uniforms differ — the shader program is
 * shared with every other rune stone. The caller disposes it. */
export function createRiftRuneMaterial(color: string): MeshStandardMaterial {
  const t = runestoneTex();
  return new MeshStandardMaterial({
    color: "#4a4658",
    map: t.map,
    normalMap: t.normalMap,
    roughness: 0.85,
    emissive: new Color(color),
    emissiveMap: glyphTex(),
    emissiveIntensity: RIFT_RUNE_GLOW,
  });
}

/** The rift's dais and standing stones; `runes` from createRiftRuneMaterial. */
export function RiftFrameModel({ runes }: { runes: MeshStandardMaterial }) {
  const geo = frameGeo();
  return (
    <group>
      <mesh geometry={geo.plain} material={plainMat()} castShadow receiveShadow />
      <mesh geometry={geo.runes} material={runes} castShadow receiveShadow />
    </group>
  );
}
