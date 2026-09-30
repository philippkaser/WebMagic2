/** Random streams for one floor.
 *
 * A floor draws from several independent Rng streams, all derived from the
 * instance seed and the floor number. Keeping them apart is what lets a new
 * system (an omen roll, lore runes) join generation without shifting a single
 * draw of the layout stream — so a given seed keeps its rooms, props and
 * enemies no matter what gets added beside them. */

/** Salts XOR'd into the seed, one per stream. Arbitrary, but never change
 * them: every shared floor instance depends on all clients agreeing. */
export const STREAM_SALT = {
  omen: 0x6f6d656e, // "omen"
  lore: 0x6c6f7265, // "lore"
  architecture: 0x61726368, // "arch"
} as const;

/** The layout stream's seed. Kept byte-for-byte as it has always been, so
 * existing seeds generate the same floors. */
export function layoutSeed(seed: number, floor: number): number {
  return seed ^ (floor * 0x51ed270b);
}

/** Seed for a side stream: (seed ^ salt) mixed with the floor through a
 * murmur3-style finalizer. The avalanche matters — mulberry32 seeded with
 * nearby values yields correlated first draws, and adjacent floors or
 * sequential instance seeds are exactly "nearby values". */
export function streamSeed(seed: number, floor: number, salt: number): number {
  let h = ((seed ^ salt) + Math.imul(floor, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
