/** Does rock stand between two points of the dungeon? The floor is a tile
 * grid extruded to full-height walls, so for anything between the floor and
 * the vault that is a 2D question, answered by stepping the segment cell to
 * cell (Amanatides & Woo's DDA) until it meets a solid tile or arrives.
 *
 * Pure: the light-grid shader (lightGrid.ts) runs the same march per pixel
 * per light, line for line, and the bounce bake (bounce.ts) uses it to keep
 * torchlight on its side of a wall. Coordinates are CELL units — world x /
 * TILE + size / 2, world z likewise (grid y is world Z) — so cell (i, j)
 * covers [i, i + 1) × [j, j + 1). */

export interface OccupancyGrid {
  /** size*size, 1 = open floor, 0 = solid (the FloorLayout contract). */
  tiles: Uint8Array;
  size: number;
}

/** Hard cap on cells crossed per march: a pooled light reaches ≤ ~12 m (6
 * tiles) so ~13 crossings cover any segment it lights; the lantern's 17 m
 * reach needs a few more. Past the cap the march gives up and calls it lit
 * (fail open — the far end of a light's reach is dim anyway). */
export const MAX_STEPS = 20;

/** How far (cells) a light stuck in rock is pushed out past the face. */
export const UNSTICK = 0.02;

export function isOpen(g: OccupancyGrid, cx: number, cy: number): boolean {
  return cx >= 0 && cy >= 0 && cx < g.size && cy < g.size && g.tiles[cy * g.size + cx] === 1;
}

/** World (x, z) → cell coordinates. */
export function toCell(size: number, tile: number, x: number, z: number): [number, number] {
  return [x / tile + size / 2, z / tile + size / 2];
}

/** True when the segment a → b crosses no solid cell. Neither end's own
 * cell is tested: a point on a wall face sits on rock's edge, and a light's
 * cell is the light's (see `unstick`). */
export function gridVisible(
  g: OccupancyGrid,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  maxSteps = MAX_STEPS,
): boolean {
  let cx = Math.floor(ax);
  let cy = Math.floor(ay);
  const ex = Math.floor(bx);
  const ey = Math.floor(by);
  const dx = bx - ax;
  const dy = by - ay;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  // Ray parameter (0 at a, 1 at b) per cell crossed, and to the next edge.
  const tdx = 1 / Math.max(Math.abs(dx), 1e-5);
  const tdy = 1 / Math.max(Math.abs(dy), 1e-5);
  const fx = ax - cx;
  const fy = ay - cy;
  let tmx = (sx > 0 ? 1 - fx : fx) * tdx;
  let tmy = (sy > 0 ? 1 - fy : fy) * tdy;
  for (let i = 0; i < maxSteps; i++) {
    if (Math.min(tmx, tmy) >= 1 || (cx === ex && cy === ey)) return true;
    if (tmx < tmy) {
      tmx += tdx;
      cx += sx;
    } else {
      tmy += tdy;
      cy += sy;
    }
    if (cx === ex && cy === ey) return true;
    if (!isOpen(g, cx, cy)) return false;
  }
  return true;
}

/** A light inside rock (a torch's flame a hair into its wall, a blast at a
 * bolt's impact point) is moved out through its nearest face, so it lights
 * the side it hangs on and not the room behind the wall. Open-cell points
 * are returned unchanged. */
export function unstick(g: OccupancyGrid, x: number, y: number): [number, number] {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (isOpen(g, cx, cy)) return [x, y];
  const fx = x - cx;
  const fy = y - cy;
  const m = Math.min(fx, 1 - fx, fy, 1 - fy);
  if (m === fx) return [cx - UNSTICK, y];
  if (m === 1 - fx) return [cx + 1 + UNSTICK, y];
  if (m === fy) return [x, cy - UNSTICK];
  return [x, cy + 1 + UNSTICK];
}

/** Where across the light's disc a texel's ray aims, from its dither
 * phase: four spots spread evenly over the diameter. */
export function discOffset(phase: number): number {
  return 2 * phase - 0.75;
}

/** Whether a light reaches a point (0 or 1), with a dithered penumbra: the
 * light is a small disc `radius` cells across the ray, and each texel's
 * one ray aims at its own spot on it (`phase`, 0..1, from a 2×2 ordered
 * dither of the surface's texel — see ditherPhase). Where only part of the
 * disc is hidden, neighbouring texels disagree, and the shadow's edge
 * comes out as an ordered dither in whole texels: soft in the pixel-art
 * way, never a blur. Mirrors the shader exactly. */
export function lightVisibility(
  g: OccupancyGrid,
  px: number,
  py: number,
  lx: number,
  ly: number,
  radius: number,
  phase: number,
): number {
  const [ux, uy] = unstick(g, lx, ly);
  const dx = ux - px;
  const dy = uy - py;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return 1;
  const k = (radius * discOffset(phase)) / len;
  const [sx, sy] = unstick(g, ux - dy * k, uy + dx * k);
  return gridVisible(g, px, py, sx, sy) ? 1 : 0;
}

/** 2×2 ordered dither (Bayer) phase for an integer texel coordinate:
 * 0, ½, ¾, ¼ round the square — each texel of a 2×2 block a different
 * sample offset, so a penumbra reads as a pixel dither. */
export function ditherPhase(tx: number, ty: number): number {
  const a = ((tx % 2) + 2) % 2;
  const b = ((ty % 2) + 2) % 2;
  return ((3 * b + 2 * a) % 4) / 4;
}
