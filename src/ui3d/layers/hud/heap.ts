/** Where coins come to rest on a little heap — pure, deterministic, tested.
 *
 * Slots are generated for the whole heap (a few loose layers, each a
 * golden-angle spiral a little narrower than the one below, every coin
 * tipped at its own angle) and then ORDERED so the heap grows like a real
 * one: the first coins land in the middle, later ones ring them and climb on
 * top, and any prefix of the list is itself a plausible little mound. Units
 * are coin radii; y is up, z toward the eye. */

export interface CoinSlot {
  x: number;
  y: number;
  z: number;
  /** Tilt (x, z) and spin (y), radians. */
  rx: number;
  ry: number;
  rz: number;
}

const LAYERS = [12, 9, 6, 4, 2, 1];
/** Height gained per layer, coin radii (coins interleave as they tip). */
const LAYER_RISE = 0.42;

function rand(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function heapSlots(seed = 1): CoinSlot[] {
  const slots: (CoinSlot & { score: number })[] = [];
  let k = seed * 97;
  const golden = Math.PI * (3 - Math.sqrt(5));
  LAYERS.forEach((n, layer) => {
    const radius = 3.1 * (1 - layer / (LAYERS.length + 0.5));
    for (let i = 0; i < n; i++) {
      const r = n === 1 ? 0 : radius * Math.sqrt((i + 0.5) / n);
      const a = i * golden + layer * 0.9 + rand(k++) * 0.5;
      const x = Math.cos(a) * r;
      // The heap is seen from in front and a little above: a slightly
      // shallower footprint in depth reads as a round mound.
      const z = Math.sin(a) * r * 0.75;
      const y = layer * LAYER_RISE + rand(k++) * 0.08;
      const tip = 0.18 + layer * 0.06 + (r / 3.1) * 0.35;
      slots.push({
        x,
        y,
        z,
        rx: (rand(k++) - 0.5) * 2 * tip,
        ry: rand(k++) * Math.PI * 2,
        rz: (rand(k++) - 0.5) * 2 * tip,
        score: Math.hypot(x, z * 1.2) + y * 2.2 + rand(k++) * 0.3,
      });
    }
  });
  slots.sort((a, b) => a.score - b.score);
  return slots.map(({ score: _score, ...slot }) => slot);
}

/** Total slots a heap offers. */
export const HEAP_CAPACITY = LAYERS.reduce((a, b) => a + b, 0);
