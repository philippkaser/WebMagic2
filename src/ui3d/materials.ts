import {
  Color,
  DataTexture,
  MeshStandardMaterial,
  NearestFilter,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";

/** Materials for physical UI objects — the stone of tablets and plaques,
 * the metal of trims. They're lit by the UI canvas's own torchlight
 * (UiCanvas), so a tablet catches a warm highlight on its bevels exactly
 * like the dungeon walls behind it.
 *
 * The slab texture is painted here in plain typed-array math (value noise
 * for the stone, a height field turned into a normal map) instead of reusing
 * the world's surface painters: the UI must look the same whatever the
 * biome artists do to the walls. */

const SIZE = 64;

function hash(x: number, y: number, seed: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Tileable value noise on a `period`-cell grid. */
function valueNoise(x: number, y: number, period: number, seed: number): number {
  const cell = SIZE / period;
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const h = (i: number, j: number) => hash(((i % period) + period) % period, ((j % period) + period) % period, seed);
  const a = h(x0, y0) + (h(x0 + 1, y0) - h(x0, y0)) * sx;
  const b = h(x0, y0 + 1) + (h(x0 + 1, y0 + 1) - h(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}

/** Height field of worn slate: broad undulation, fine grain, a few chips. */
export function slabHeight(): Float32Array {
  const height = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let h = valueNoise(x, y, 4, 1) * 0.55 + valueNoise(x, y, 16, 2) * 0.3 + valueNoise(x, y, 32, 3) * 0.15;
      if (hash(x, y, 9) > 0.985) h -= 0.35; // pits
      height[y * SIZE + x] = h;
    }
  }
  return height;
}

function dataTexture(data: Uint8Array, srgb: boolean): DataTexture {
  const t = new DataTexture(data, SIZE, SIZE, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = NearestFilter; // the pixel look, even at full resolution
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

let slab: { map: DataTexture; normalMap: DataTexture } | null = null;

export function slabTextures(): { map: DataTexture; normalMap: DataTexture } {
  if (slab) return slab;
  const height = slabHeight();
  const color = new Uint8Array(SIZE * SIZE * 4);
  const normal = new Uint8Array(SIZE * SIZE * 4);
  const at = (x: number, y: number) => height[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)]!;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const h = at(x, y);
      // Low-contrast slate: the light, not the albedo, should do the talking.
      const v = 0.78 + h * 0.3;
      color[i] = Math.min(255, 255 * v);
      color[i + 1] = Math.min(255, 255 * v * 0.97);
      color[i + 2] = Math.min(255, 255 * v * 1.02);
      color[i + 3] = 255;
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2.2;
      const len = Math.hypot(dx, dy, 1);
      normal[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      normal[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      normal[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      normal[i + 3] = 255;
    }
  }
  slab = { map: dataTexture(color, true), normalMap: dataTexture(normal, false) };
  return slab;
}

const stoneCache = new Map<string, MeshStandardMaterial>();

/** Dressed stone for tablets and plaques, tinted (slate by default).
 * Shared per tint; per-tile variation comes from instance colours. */
export function stoneMaterial(tint = "#3a3542"): MeshStandardMaterial {
  let m = stoneCache.get(tint);
  if (!m) {
    const { map, normalMap } = slabTextures();
    m = new MeshStandardMaterial({ color: new Color(tint), map, normalMap, roughness: 0.62, metalness: 0.08 });
    stoneCache.set(tint, m);
  }
  return m;
}

const metalCache = new Map<string, MeshStandardMaterial>();

/** Tarnished trim metal (bronze by default). */
export function metalMaterial(color = "#8a7040"): MeshStandardMaterial {
  let m = metalCache.get(color);
  if (!m) {
    m = new MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.35 });
    metalCache.set(color, m);
  }
  return m;
}

const glowCache = new Map<string, MeshStandardMaterial>();

/** Self-lit material for gems, runes and liquids: dark body, bright heart. */
export function glowMaterial(color: string, intensity = 2.4): MeshStandardMaterial {
  const key = `${color}:${intensity}`;
  let m = glowCache.get(key);
  if (!m) {
    m = new MeshStandardMaterial({
      color: "#0c0a12",
      emissive: color,
      emissiveIntensity: intensity,
      roughness: 0.25,
      metalness: 0.1,
      toneMapped: false,
    });
    glowCache.set(key, m);
  }
  return m;
}
