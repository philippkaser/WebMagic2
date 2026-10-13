/** The floor's marks: scorches where blasts went off, splats where things
 * died — the bookkeeping, pure (no three.js), so it's tested like the
 * particle sim; fx/decals/FloorDecals.tsx draws it.
 *
 * A fixed number of slots (one instance each, so the draw never grows).
 * Past `softCap` live marks the oldest start to fade — they erode in an
 * ordered dither over `fadeSeconds` and free their slot — so a long fight
 * keeps its newest ~200 marks and the old ones crumble away instead of
 * popping. If every slot is taken anyway (a burst of blasts faster than
 * the fade), the oldest is overwritten. A floor's marks die with the floor
 * (the pool lives in the floor's component). */

export const DECAL_CAPACITY = 200;
/** Live marks kept before the oldest begin to fade. */
export const DECAL_SOFT_CAP = DECAL_CAPACITY - 16;
export const DECAL_FADE_SECONDS = 2.5;

/** What a mark is: the atlas row it's painted in. */
export const DecalKind = { scorch: 0, goo: 1, ash: 2, shards: 3 } as const;
export type DecalKind = (typeof DecalKind)[keyof typeof DecalKind];
export const DECAL_KINDS = 4;
export const DECAL_VARIANTS = 4;

export type Rgb = [number, number, number];

export interface DecalSpec {
  kind: DecalKind;
  /** World centre on the floor. */
  x: number;
  z: number;
  /** Edge length of the square the mark is painted in, metres. */
  size: number;
  /** Turn about the vertical, radians. */
  rot: number;
  /** Which of the kind's painted variants. */
  variant: number;
  /** Albedo multiplier (linear rgb). */
  tint: Rgb;
  /** Colour of its embers / soul-specks (linear rgb), and how bright. */
  glow: Rgb;
  glowStrength: number;
  /** Seconds the specks take to go out (each its own share of it). */
  glowSeconds: number;
}

export interface Decal extends DecalSpec {
  born: number;
  /** When it began to fade (Infinity = not fading). */
  fadeStart: number;
}

export class DecalPool {
  readonly slots: (Decal | null)[];
  private live = 0;

  constructor(
    readonly capacity = DECAL_CAPACITY,
    readonly softCap = Math.min(DECAL_SOFT_CAP, capacity),
    readonly fadeSeconds = DECAL_FADE_SECONDS,
  ) {
    this.slots = Array.from({ length: capacity }, () => null);
  }

  /** Marks not yet fading. */
  get liveCount(): number {
    return this.live;
  }

  get count(): number {
    let n = 0;
    for (const s of this.slots) if (s) n++;
    return n;
  }

  /** Lay a mark; returns its slot. May start the oldest marks fading (see
   * `fading`) or, with every slot taken, overwrite the oldest. */
  add(spec: DecalSpec, now: number): number {
    let slot = this.slots.indexOf(null);
    if (slot < 0) {
      slot = this.oldest(true);
      if (this.slots[slot]!.fadeStart === Infinity) this.live--;
    }
    this.slots[slot] = { ...spec, born: now, fadeStart: Infinity };
    this.live++;
    while (this.live > this.softCap) {
      const o = this.oldest(false);
      if (o < 0) break;
      this.slots[o]!.fadeStart = now;
      this.live--;
    }
    return slot;
  }

  /** Free the slots whose fade has finished; returns them (the renderer
   * hides those instances). */
  update(now: number, out: number[] = []): number[] {
    out.length = 0;
    for (let i = 0; i < this.capacity; i++) {
      const d = this.slots[i];
      if (d && now - d.fadeStart >= this.fadeSeconds) {
        this.slots[i] = null;
        out.push(i);
      }
    }
    return out;
  }

  /** 1 = whole, falling to 0 as it erodes away. */
  fade(slot: number, now: number): number {
    const d = this.slots[slot];
    if (!d) return 0;
    if (d.fadeStart === Infinity) return 1;
    return Math.max(0, 1 - (now - d.fadeStart) / this.fadeSeconds);
  }

  clear(): void {
    this.slots.fill(null);
    this.live = 0;
  }

  /** Slot of the oldest mark — among all (`any`) or only those not fading. */
  private oldest(any: boolean): number {
    let best = -1;
    let born = Infinity;
    for (let i = 0; i < this.capacity; i++) {
      const d = this.slots[i];
      if (!d || (!any && d.fadeStart !== Infinity)) continue;
      if (d.born < born) {
        born = d.born;
        best = i;
      }
    }
    return best;
  }
}

// ── What each event leaves behind ────────────────────────────────────────────

/** A cosmetic hash in [0, 1) of a world spot: every client paints the same
 * variant and turn for the same blast. */
export function spotHash(x: number, z: number, salt: number): number {
  let h = Math.imul(Math.round(x * 64) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(z * 64) | 0, 0x165667b1) ^ Math.imul(salt + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface ExplosionMark {
  x: number;
  y: number;
  z: number;
  /** The blast's scaled radius. */
  radius: number;
  /** Linear rgb of the blast. */
  color: Rgb;
  /** The caller's sense of the blast's size (particles / 36: a bolt's pop
   * ≈ 0.4, a barrel 1, a boss slam 1.4). */
  power: number;
  vfx: "blast" | "shockwave";
}

/** The scorch a blast leaves on the floor, or null: a ring of force
 * (shockwave) burns nothing, and a blast whose sphere doesn't reach the
 * floor leaves the floor alone. Sized by the sphere's footprint on the
 * floor and the blast's power — a bolt's pop a scuff, a barrel a crater. */
export function scorchFor(e: ExplosionMark): DecalSpec | null {
  if (e.vfx === "shockwave") return null;
  const h = Math.max(0, e.y);
  if (h >= e.radius * 0.92) return null;
  const foot = Math.sqrt(e.radius * e.radius - h * h);
  const power = Math.min(Math.max(e.power, 0), 1.5);
  const size = Math.min(4.6, 2 * foot * (0.34 + 0.24 * power));
  if (size < 0.45) return null;
  return {
    kind: DecalKind.scorch,
    x: e.x,
    z: e.z,
    size,
    rot: spotHash(e.x, e.z, 1) * Math.PI * 2,
    variant: Math.floor(spotHash(e.x, e.z, 2) * DECAL_VARIANTS),
    tint: [1, 1, 1],
    glow: e.color,
    glowStrength: 1.6 + power * 1.2,
    glowSeconds: 5 + power * 5,
  };
}

export interface DeathMark {
  x: number;
  y: number;
  z: number;
  /** Linear rgb of what it was made of (the burst's first colour). */
  body: Rgb;
  /** Linear rgb of its soul-light. */
  soul: Rgb;
  /** Burst style: goo (default), shards, smoke or spark. */
  style?: string;
  /** Size of the creature (1 = wisp-sized). */
  scale: number;
}

/** What a death leaves on the floor below it: goo for the soft things,
 * shards for the crystal ones, soul-ash for the ones made of light or
 * shadow — tinted by what the creature was, glinting with its soul. */
export function splatFor(d: DeathMark): DecalSpec {
  const kind =
    d.style === "shard" ? DecalKind.shards : d.style === "smoke" || d.style === "spark" ? DecalKind.ash : DecalKind.goo;
  // A flier high up spreads its fall thinner.
  const spread = d.y > 2.5 ? 1.2 : 1;
  const size = Math.min(3.4, Math.max(0.7, 1.35 * d.scale * spread));
  const grey = (c: Rgb, k: number, m: number): Rgb => {
    const l = c[0] * 0.3 + c[1] * 0.55 + c[2] * 0.15;
    return [(l + (c[0] - l) * k) * m, (l + (c[1] - l) * k) * m, (l + (c[2] - l) * k) * m];
  };
  const tint: Rgb =
    kind === DecalKind.goo
      ? grey(d.body, 1.1, 1.15)
      : kind === DecalKind.shards
        ? grey(d.body, 0.9, 1.1)
        : // Ash: grey dust carrying a breath of the soul's colour.
          [0.55 + d.soul[0] * 0.35, 0.55 + d.soul[1] * 0.35, 0.55 + d.soul[2] * 0.35];
  return {
    kind,
    x: d.x,
    z: d.z,
    size,
    rot: spotHash(d.x, d.z, 3) * Math.PI * 2,
    variant: Math.floor(spotHash(d.x, d.z, 4) * DECAL_VARIANTS),
    tint,
    glow: d.soul,
    glowStrength: kind === DecalKind.ash ? 2.2 : kind === DecalKind.shards ? 1.6 : 0.9,
    glowSeconds: kind === DecalKind.goo ? 8 : 14,
  };
}
