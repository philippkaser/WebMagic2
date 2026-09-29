import type { RGBA } from "./paint";

/** Height field → tangent-space normal map, via a 3×3 Sobel filter.
 *
 * This is the "pixels that catch light" half of the art style: every painted
 * height step becomes a slope the torch- and spell-light can rake across.
 * Sobel (a central difference smoothed 1-2-1 across the other axis) is used
 * instead of a bare central difference because it reads a one-texel ridge
 * as a ridge rather than as two unrelated steps, which keeps chunky mortar
 * lines and carved grooves coherent under moving light.
 *
 * Convention: three.js (OpenGL-style, +Y = up the texture). Canvas row 0 is
 * the TOP of the image and CanvasTexture flips it to v = 1, so "up" in the
 * texture is row − 1. A texel on the upper lip of a raised block gets +G.
 * The filter wraps at the borders because every surface texture tiles. */
export function heightToNormal(height: Float32Array, size: number, strength: number): RGBA {
  const out = new Uint8ClampedArray(size * size * 4);
  const h = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  // Divide by 4 so the kernel's weights (1+2+1) average rather than sum: a
  // linear ramp gives the same slope as a two-texel central difference, which
  // keeps `strength` meaning what it always meant.
  const k = strength / 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Descending height toward +x tilts the normal toward +x.
      const gx =
        h(x - 1, y - 1) - h(x + 1, y - 1) +
        2 * (h(x - 1, y) - h(x + 1, y)) +
        h(x - 1, y + 1) - h(x + 1, y + 1);
      // Descending height toward "up" (row − 1) tilts the normal up (+G).
      const gy =
        h(x - 1, y + 1) - h(x - 1, y - 1) +
        2 * (h(x, y + 1) - h(x, y - 1)) +
        h(x + 1, y + 1) - h(x + 1, y - 1);
      const nx = gx * k;
      const ny = gy * k;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      out[i] = ((nx / len) * 0.5 + 0.5) * 255;
      out[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      out[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Decode one texel of an encoded normal map back to a vector (tests, and
 * anyone sanity-checking a painter). */
export function decodeNormal(rgba: RGBA, i: number): [number, number, number] {
  return [
    (rgba[i * 4] / 255) * 2 - 1,
    (rgba[i * 4 + 1] / 255) * 2 - 1,
    (rgba[i * 4 + 2] / 255) * 2 - 1,
  ];
}

/** Roughness field → RGBA. three.js samples roughness from the GREEN channel
 * (metalness from blue); the value is written to all three so the map also
 * previews sensibly as grayscale. */
export function packRoughness(rough: Float32Array): RGBA {
  return packGray(rough);
}

/** Linear 0..1 field → opaque grayscale RGBA (masks, roughness). */
export function packGray(values: Float32Array): RGBA {
  const out = new Uint8ClampedArray(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    const v = values[i] * 255;
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}
