import { useSyncExternalStore } from "react";
import { TILE } from "../core/config";
import type { FloorLayout } from "./types";

/** The floor being played, shared beyond the world canvas (the cast map
 * lives on the UI canvas), and how much of it this wizard has seen.
 *
 * Exploration is per layout object (a new floor, a new instance → a new
 * layout → a fresh, unseen map): `markExplored` reveals the floor tiles
 * within a few tiles of a world point, `isExplored` reads them back, and
 * `version` ticks whenever anything new was seen, so a map can rebuild. */

let current: FloorLayout | null = null;
const listeners = new Set<() => void>();
const seen = new WeakMap<FloorLayout, Uint8Array>();
let version = 0;

export function setCurrentLayout(layout: FloorLayout | null): void {
  if (current === layout) return;
  current = layout;
  version++;
  // Called while the world renders (GameScene's memo): tell subscribers
  // (on the other canvas) after this render, not during it.
  queueMicrotask(() => {
    for (const l of listeners) l();
  });
}

export function getCurrentLayout(): FloorLayout | null {
  return current;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The current layout, as React state. */
export function useCurrentLayout(): FloorLayout | null {
  return useSyncExternalStore(subscribe, getCurrentLayout, getCurrentLayout);
}

/** Exploration ticks (re-read the map when it changes). */
export function exploredVersion(): number {
  return version;
}

function grid(layout: FloorLayout): Uint8Array {
  let g = seen.get(layout);
  if (!g) {
    g = new Uint8Array(layout.size * layout.size);
    seen.set(layout, g);
  }
  return g;
}

/** Reveal the walkable tiles within `radius` tiles of world (x, z). Returns
 * true if anything new was seen. */
export function markExplored(layout: FloorLayout, x: number, z: number, radius = 4): boolean {
  const g = grid(layout);
  const n = layout.size;
  const cx = Math.floor(x / TILE + n / 2);
  const cz = Math.floor(z / TILE + n / 2);
  let changed = false;
  for (let dz = -radius; dz <= radius; dz++)
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dz * dz > radius * radius + 1) continue;
      const tx = cx + dx;
      const tz = cz + dz;
      if (tx < 0 || tz < 0 || tx >= n || tz >= n) continue;
      const i = tz * n + tx;
      if (g[i] || !layout.tiles[i]) continue;
      g[i] = 1;
      changed = true;
    }
  if (changed) version++;
  return changed;
}

export function isExplored(layout: FloorLayout, tx: number, tz: number): boolean {
  if (tx < 0 || tz < 0 || tx >= layout.size || tz >= layout.size) return false;
  return grid(layout)[tz * layout.size + tx] === 1;
}

/** What this wizard has seen of `layout`, packed one bit per tile and
 * base64'd — what a cast map carries to the other wizards on the floor. */
export function exploredBits(layout: FloorLayout): string {
  const g = grid(layout);
  const bytes = new Uint8Array(Math.ceil(g.length / 8));
  for (let i = 0; i < g.length; i++) if (g[i]) bytes[i >> 3]! |= 1 << (i & 7);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Learn what another wizard has seen (exploredBits): their seen floor
 * tiles join ours. Malformed input is ignored. Returns true if anything
 * new was learnt. */
export function mergeExplored(layout: FloorLayout, bits: string): boolean {
  let bin: string;
  try {
    bin = atob(bits);
  } catch {
    return false;
  }
  const g = grid(layout);
  if (bin.length !== Math.ceil(g.length / 8)) return false;
  let changed = false;
  for (let i = 0; i < g.length; i++) {
    if (g[i] || !layout.tiles[i]) continue;
    if (bin.charCodeAt(i >> 3) & (1 << (i & 7))) {
      g[i] = 1;
      changed = true;
    }
  }
  if (changed) version++;
  return changed;
}
