import {
  Color,
  DataTexture,
  DoubleSide,
  MeshStandardMaterial,
  NearestFilter,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";

/** The codex's materials, painted in typed-array math like the tablets'
 * stone (materials.ts): dark vellum for the pages (glowing ink needs a dark
 * ground), fine stripes for the page edges, oiled leather for the boards.
 * Shared singletons — the tome is the only thing that uses them. */

const SIZE = 64;

function hash(x: number, y: number, seed: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function smoothNoise(x: number, y: number, cell: number, seed: number): number {
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, seed) + (hash(x0 + 1, y0, seed) - hash(x0, y0, seed)) * sx;
  const b = hash(x0, y0 + 1, seed) + (hash(x0 + 1, y0 + 1, seed) - hash(x0, y0 + 1, seed)) * sx;
  return a + (b - a) * sy;
}

function texture(data: Uint8Array, w = SIZE, h = SIZE): DataTexture {
  const t = new DataTexture(data, w, h, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = NearestFilter; // the pixel look, like the tablets
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Dark vellum: violet-black with long fibres, a few stains, and edges
 * darkened by centuries of thumbs. One page maps the whole texture. */
function vellumTexture(): DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      // Mottled skin rather than grain: broad cloudiness, a fine tooth,
      // a few stains.
      const cloud = smoothNoise(x, y, 16, 2) * 0.6 + smoothNoise(x, y, 6, 1) * 0.25 + hash(x, y, 3) * 0.15;
      const stain = Math.max(0, smoothNoise(x, y, 11, 5) - 0.7) * 2;
      const ex = Math.min(x, SIZE - 1 - x) / (SIZE / 2);
      const ey = Math.min(y, SIZE - 1 - y) / (SIZE / 2);
      const edge = Math.min(1, Math.min(ex, ey) * 4);
      const v = (0.7 + cloud * 0.35 - stain * 0.25) * (0.45 + 0.55 * edge);
      data[i] = Math.min(255, 40 * v);
      data[i + 1] = Math.min(255, 33 * v);
      data[i + 2] = Math.min(255, 58 * v);
      data[i + 3] = 255;
    }
  }
  return texture(data);
}

/** Stacked page edges: pale lines, alternating slightly. `across` picks
 * whether the lines vary along u or v (box faces map differently). */
function edgesTexture(across: "u" | "v"): DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const k = across === "u" ? x : y;
      const line = (k % 2 === 0 ? 0.9 : 0.72) + hash(k, 0, 9) * 0.12 - hash(x, y, 4) * 0.05;
      data[i] = 196 * line;
      data[i + 1] = 178 * line;
      data[i + 2] = 150 * line;
      data[i + 3] = 255;
    }
  }
  return texture(data);
}

let mats: {
  vellum: MeshStandardMaterial;
  leaf: MeshStandardMaterial;
  edgesU: MeshStandardMaterial;
  edgesV: MeshStandardMaterial;
  leather: MeshStandardMaterial;
  leatherDark: MeshStandardMaterial;
} | null = null;

export function tomeMaterials() {
  if (mats) return mats;
  const vellum = vellumTexture();
  mats = {
    vellum: new MeshStandardMaterial({ map: vellum, roughness: 0.92, metalness: 0 }),
    leaf: new MeshStandardMaterial({ map: vellum, roughness: 0.92, metalness: 0, side: DoubleSide }),
    edgesU: new MeshStandardMaterial({ map: edgesTexture("u"), roughness: 0.95 }),
    edgesV: new MeshStandardMaterial({ map: edgesTexture("v"), roughness: 0.95 }),
    leather: new MeshStandardMaterial({ color: new Color("#4a2346"), roughness: 0.62, metalness: 0.05 }),
    leatherDark: new MeshStandardMaterial({ color: new Color("#2a1428"), roughness: 0.7, metalness: 0.05 }),
  };
  return mats;
}
