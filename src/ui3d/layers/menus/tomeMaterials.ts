import {
  DataTexture,
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";
import { LIGHT_BLENDING } from "../../holo/holoMaterial";

/** The codex's materials — a SPECTRAL tome, cast like every other menu: its
 * pages are dark vellum you can faintly see through, lit from within by
 * the caster's arcane light; the stacked page edges glow as lines of that
 * light; the leather boards are a ghost of leather, a translucent shell
 * with a pixel grain. Painted in typed-array math (pixel textures, like
 * the world's). Shared singletons — the tome is the only thing that uses
 * them. */

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

/** Dark vellum: soot-black (the grimoire's panel stone, #1a1520) with a
 * mottled tooth, a few stains, and edges darkened by centuries of thumbs.
 * One page maps the whole texture. */
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
      // Stepped into a few tones, like the world's palette ramps.
      const q = Math.round(v * 6) / 6;
      data[i] = Math.min(255, 34 * q);
      data[i + 1] = Math.min(255, 27 * q);
      data[i + 2] = Math.min(255, 40 * q);
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
      // Parchment page edges (#eadfc4, aged).
      data[i] = 206 * line;
      data[i + 1] = 190 * line;
      data[i + 2] = 156 * line;
      data[i + 3] = 255;
    }
  }
  return texture(data);
}

/** Oxblood leather: a pixel grain of three tones with darker creases. */
function leatherTexture(base: [number, number, number]): DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const n = smoothNoise(x, y, 8, 7) * 0.6 + hash(x, y, 8) * 0.4;
      const crease = smoothNoise(x, y, 5, 11) > 0.78 ? 0.7 : 1;
      const k = (n < 0.38 ? 0.82 : n < 0.62 ? 1 : 1.14) * crease;
      data[i] = Math.min(255, base[0] * k);
      data[i + 1] = Math.min(255, base[1] * k);
      data[i + 2] = Math.min(255, base[2] * k);
      data[i + 3] = 255;
    }
  }
  return texture(data);
}

let mats: {
  vellum: MeshStandardMaterial;
  leaf: MeshStandardMaterial;
  edgesU: MeshBasicMaterial;
  edgesV: MeshBasicMaterial;
  leather: MeshStandardMaterial;
  leatherDark: MeshStandardMaterial;
} | null = null;

export function tomeMaterials() {
  if (mats) return mats;
  const vellum = vellumTexture();
  const page = { map: vellum, roughness: 0.92, metalness: 0, transparent: true, opacity: 0.84, emissive: "#0b3a33", emissiveIntensity: 0.55 };
  const light = { color: "#2bb894", ...LIGHT_BLENDING, transparent: true, depthWrite: false, toneMapped: false };
  const ghost = { roughness: 0.6, metalness: 0.05, transparent: true, opacity: 0.38, emissive: "#0f3f36", emissiveIntensity: 0.9, depthWrite: false };
  mats = {
    vellum: new MeshStandardMaterial(page),
    leaf: new MeshStandardMaterial({ ...page, side: DoubleSide }),
    edgesU: new MeshBasicMaterial({ map: edgesTexture("u"), ...light }),
    edgesV: new MeshBasicMaterial({ map: edgesTexture("v"), ...light }),
    leather: new MeshStandardMaterial({ map: leatherTexture([96, 44, 34]), ...ghost }),
    leatherDark: new MeshStandardMaterial({ map: leatherTexture([52, 24, 20]), ...ghost }),
  };
  return mats;
}
