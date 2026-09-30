import { clamp01, colorMix, flicker, lerp, lifeAlpha, lifeSize } from "./curves";

/** The particle simulation, free of three.js so it can be unit-tested.
 *
 * Layout: one Float32Array, STRIDE floats per particle, kept DENSE — a dying
 * particle is replaced by the last live one (swap-remove). So a frame costs
 * O(live particles), never O(capacity), and the GPU instance buffers are
 * written as one contiguous prefix: the renderer uploads exactly
 * `count × 16` floats and draws `count` instances, one draw call for every
 * sprite style at once.
 *
 * Nothing here allocates after construction. Spawning goes through a single
 * reusable `ParticleInit` scratch object (see Particles.tsx#emit). */

// ── Shapes: what the fragment shader draws (shared with particleMaterial) ──
export const SHAPE = {
  /** Soft round falloff with a hot core — glows, embers, motes. */
  glow: 0,
  /** Capsule stretched along velocity, brighter at the head — sparks, flames. */
  streak: 1,
  /** Noisy soft puff, alpha-blended — smoke, dust. */
  smoke: 2,
  /** Thin annulus, billboarded or oriented by a normal — shockwaves. */
  ring: 3,
  /** Hard-edged square — the chunky pixel read (debris, legacy bursts). */
  chunk: 4,
  /** Four-point star — muzzle flares and glints. */
  flare: 5,
} as const;

export type ParticleStyle =
  | "pixel"
  | "glow"
  | "spark"
  | "ember"
  | "smoke"
  | "shard"
  | "debris"
  | "mote"
  | "flame"
  | "ring"
  | "flare"
  | "soul";

/** How a style behaves and draws. Per-particle values (sizes, colours,
 * gravity, drag, life) come from the spawn; these are the style's fixed
 * character. */
export interface StyleDef {
  shape: number;
  /** 1 = additive light (feeds bloom), 0 = alpha-blended matter. One blend
   * mode serves both (premultiplied alpha), so both share a draw call. */
  additive: number;
  /** 0 = emissive; 1 = lit by the dynamic light pool + staff light. */
  lit: number;
  /** lifeSize curve id (0 shrink, 1 grow, 2 pop). */
  sizeCurve: number;
  /** Default end size as a multiple of the start size. */
  endSize: number;
  fadeIn: number;
  fadeOutPow: number;
  /** Colour-over-life exponent (see curves.colorMix). */
  colorK: number;
  /** Streak length in seconds of velocity (0 = no stretch). */
  stretch: number;
  /** Brightness flicker amount 0..1. */
  flicker: number;
  /** Turbulent wander acceleration, m/s². */
  wobble: number;
  /** Floor restitution; < 0 = ignores the floor. */
  bounce: number;
  /** Max random spin, rad/s. */
  spin: number;
  /** Brightness follows rotation — a tumbling chunk catching light. */
  tumble: boolean;
  gravity: number;
  drag: number;
}

const STYLE_LIST: readonly (readonly [ParticleStyle, StyleDef])[] = [
  // The pre-rework look: opaque chunky squares that shrink, fall and bounce.
  ["pixel", { shape: SHAPE.chunk, additive: 0, lit: 0, sizeCurve: 0, endSize: 0, fadeIn: 0, fadeOutPow: 0, colorK: 1, stretch: 0, flicker: 0, wobble: 0, bounce: 0.35, spin: 0, tumble: false, gravity: -14, drag: 1.6 }],
  ["glow", { shape: SHAPE.glow, additive: 1, lit: 0, sizeCurve: 1, endSize: 0.35, fadeIn: 0.04, fadeOutPow: 1.6, colorK: 0.7, stretch: 0, flicker: 0, wobble: 0, bounce: -1, spin: 0, tumble: false, gravity: 0, drag: 2.5 }],
  ["spark", { shape: SHAPE.streak, additive: 1, lit: 0, sizeCurve: 0, endSize: 0.4, fadeIn: 0, fadeOutPow: 1.2, colorK: 0.45, stretch: 0.05, flicker: 0.15, wobble: 0, bounce: 0.3, spin: 0, tumble: false, gravity: -11, drag: 2.2 }],
  ["ember", { shape: SHAPE.glow, additive: 1, lit: 0, sizeCurve: 0, endSize: 0.2, fadeIn: 0.12, fadeOutPow: 1.3, colorK: 0.8, stretch: 0, flicker: 0.6, wobble: 2.2, bounce: -1, spin: 0, tumble: false, gravity: 1.1, drag: 1.4 }],
  ["smoke", { shape: SHAPE.smoke, additive: 0, lit: 1, sizeCurve: 1, endSize: 2.6, fadeIn: 0.14, fadeOutPow: 1.4, colorK: 1.5, stretch: 0, flicker: 0, wobble: 0.5, bounce: -1, spin: 1.2, tumble: false, gravity: 0.35, drag: 2.2 }],
  ["shard", { shape: SHAPE.chunk, additive: 0, lit: 1, sizeCurve: 0, endSize: 0.3, fadeIn: 0, fadeOutPow: 0, colorK: 1, stretch: 0, flicker: 0, wobble: 0, bounce: 0.3, spin: 14, tumble: true, gravity: -17, drag: 0.6 }],
  ["mote", { shape: SHAPE.glow, additive: 1, lit: 0, sizeCurve: 0, endSize: 0.5, fadeIn: 0.3, fadeOutPow: 1.2, colorK: 1, stretch: 0, flicker: 0.35, wobble: 0.7, bounce: -1, spin: 0, tumble: false, gravity: 0, drag: 1.2 }],
  ["flame", { shape: SHAPE.streak, additive: 1, lit: 0, sizeCurve: 0, endSize: 0.15, fadeIn: 0.08, fadeOutPow: 1.1, colorK: 0.75, stretch: 0.09, flicker: 0.25, wobble: 3, bounce: -1, spin: 0, tumble: false, gravity: 2.5, drag: 2 }],
  ["ring", { shape: SHAPE.ring, additive: 1, lit: 0, sizeCurve: 1, endSize: 6, fadeIn: 0, fadeOutPow: 1.8, colorK: 0.6, stretch: 0, flicker: 0, wobble: 0, bounce: -1, spin: 0, tumble: false, gravity: 0, drag: 0 }],
  ["flare", { shape: SHAPE.flare, additive: 1, lit: 0, sizeCurve: 2, endSize: 1.6, fadeIn: 0, fadeOutPow: 1.5, colorK: 0.5, stretch: 0, flicker: 0, wobble: 0, bounce: -1, spin: 0, tumble: false, gravity: 0, drag: 0 }],
  // Rising energy: the dissolve of a dying creature, souls leaving graves.
  ["soul", { shape: SHAPE.glow, additive: 1, lit: 0, sizeCurve: 0, endSize: 0.1, fadeIn: 0.1, fadeOutPow: 1.1, colorK: 0.9, stretch: 0, flicker: 0.2, wobble: 3.2, bounce: -1, spin: 0, tumble: false, gravity: 3.2, drag: 1.8 }],
];

/** Style index ↔ definition. "debris" is an alias of "shard". */
export const STYLE_DEFS: readonly StyleDef[] = STYLE_LIST.map(([, d]) => d);
const styleIndex = new Map<ParticleStyle, number>(STYLE_LIST.map(([n], i) => [n, i]));
styleIndex.set("debris", styleIndex.get("shard")!);

export function styleId(style: ParticleStyle | undefined): number {
  return style ? (styleIndex.get(style) ?? 0) : 0;
}

export function styleDef(style: ParticleStyle | undefined): StyleDef {
  return STYLE_DEFS[styleId(style)];
}

// ── Particle record layout ─────────────────────────────────────────────────
export const STRIDE = 32;
const PX = 0, PY = 1, PZ = 2, VX = 3, VY = 4, VZ = 5, AGE = 6, LIFE = 7;
const SIZE0 = 8, SIZE1 = 9, ALPHA = 10, STYLE = 11;
const R0 = 12, G0 = 13, B0 = 14, SEED = 15;
const R1 = 16, G1 = 17, B1 = 18, STRETCH = 19;
const GRAV = 20, DRAG = 21, ROT = 22, SPIN = 23;
const AX = 24, AY = 25, AZ = 26, AK = 27;
const NX = 28, NY = 29, NZ = 30, FLOOR = 31;

/** Floats per instance in each of the four GPU attributes. */
export const INSTANCE_VEC = 4;

/** Everything one particle needs at birth. Reused as a scratch object by the
 * emit path — never allocate one per particle. */
export interface ParticleInit {
  style: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size0: number;
  size1: number;
  /** Peak alpha (0..1); glows can exceed 1 via colour, not alpha. */
  alpha: number;
  /** Linear RGB at birth and at death (values > 1 are HDR — they bloom). */
  r0: number;
  g0: number;
  b0: number;
  r1: number;
  g1: number;
  b1: number;
  gravity: number;
  drag: number;
  /** Sprite rotation (rad). For rings it carries the band thickness as a
   * fraction of the radius instead (rings don't spin). */
  rotation: number;
  spin: number;
  /** Stretch seconds override (NaN = the style's). */
  stretch: number;
  /** Attractor: accelerate toward (ax, ay, az) at `attract` m/s², dying on
   * arrival (black holes, implosions). 0 = none. */
  ax: number;
  ay: number;
  az: number;
  attract: number;
  /** Ring plane normal; zero = face the camera. */
  nx: number;
  ny: number;
  nz: number;
  /** Floor height for bouncing styles. */
  floorY: number;
}

export function createParticleInit(): ParticleInit {
  return {
    style: 0,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 1,
    size0: 0.1,
    size1: 0,
    alpha: 1,
    r0: 1,
    g0: 1,
    b0: 1,
    r1: 1,
    g1: 1,
    b1: 1,
    gravity: 0,
    drag: 0,
    rotation: 0,
    spin: 0,
    stretch: NaN,
    ax: 0,
    ay: 0,
    az: 0,
    attract: 0,
    nx: 0,
    ny: 0,
    nz: 0,
    floorY: 0.03,
  };
}

/** The four per-instance attribute arrays the sprite shader reads. */
export interface InstanceArrays {
  /** xyz position, w size (quad half-extent, metres). */
  posSize: Float32Array;
  /** Linear RGB (HDR) + alpha. */
  color: Float32Array;
  /** xyz = velocity (streaks) or plane normal (rings); w = stretch seconds. */
  axis: Float32Array;
  /** x shape, y additive, z rotation, w lit. */
  misc: Float32Array;
}

export function createInstanceArrays(capacity: number): InstanceArrays {
  return {
    posSize: new Float32Array(capacity * INSTANCE_VEC),
    color: new Float32Array(capacity * INSTANCE_VEC),
    axis: new Float32Array(capacity * INSTANCE_VEC),
    misc: new Float32Array(capacity * INSTANCE_VEC),
  };
}

export class ParticleSim {
  readonly capacity: number;
  readonly data: Float32Array;
  /** Live particles occupy [0, count). */
  count = 0;
  /** Where a spawn lands when the pool is full (rotates, so the evicted
   * particle is a different one each time — roughly the oldest region). */
  private evict = 0;
  private seedCounter = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * STRIDE);
  }

  /** Fraction of the pool in use — effects thin out as it fills. */
  get occupancy(): number {
    return this.count / this.capacity;
  }

  /** Add one particle. Returns its slot. When full, the particle overwrites
   * a live one (eviction beats refusing: the newest effect is the one the
   * player is looking at). */
  spawn(p: ParticleInit): number {
    let slot: number;
    if (this.count < this.capacity) {
      slot = this.count++;
    } else {
      slot = this.evict;
      this.evict = (this.evict + 1) % this.capacity;
    }
    const d = this.data;
    const o = slot * STRIDE;
    d[o + PX] = p.x;
    d[o + PY] = p.y;
    d[o + PZ] = p.z;
    d[o + VX] = p.vx;
    d[o + VY] = p.vy;
    d[o + VZ] = p.vz;
    d[o + AGE] = 0;
    d[o + LIFE] = Math.max(p.life, 0.001);
    d[o + SIZE0] = p.size0;
    d[o + SIZE1] = p.size1;
    d[o + ALPHA] = p.alpha;
    d[o + STYLE] = p.style;
    d[o + R0] = p.r0;
    d[o + G0] = p.g0;
    d[o + B0] = p.b0;
    d[o + SEED] = (this.seedCounter = (this.seedCounter + 0.618034) % 1);
    d[o + R1] = p.r1;
    d[o + G1] = p.g1;
    d[o + B1] = p.b1;
    d[o + STRETCH] = p.stretch;
    d[o + GRAV] = p.gravity;
    d[o + DRAG] = p.drag;
    d[o + ROT] = p.rotation;
    d[o + SPIN] = p.spin;
    d[o + AX] = p.ax;
    d[o + AY] = p.ay;
    d[o + AZ] = p.az;
    d[o + AK] = p.attract;
    d[o + NX] = p.nx;
    d[o + NY] = p.ny;
    d[o + NZ] = p.nz;
    d[o + FLOOR] = p.floorY;
    return slot;
  }

  /** Remove every particle (floor change, tests). */
  clear(): void {
    this.count = 0;
    this.evict = 0;
  }

  /** Advance every live particle by `dt` and write the live prefix of the
   * instance arrays. Returns the live count (= instances to draw). */
  step(dt: number, out: InstanceArrays): number {
    const d = this.data;
    const { posSize, color, axis, misc } = out;
    let i = 0;
    while (i < this.count) {
      const o = i * STRIDE;
      const age = d[o + AGE] + dt;
      const life = d[o + LIFE];
      if (age >= life) {
        this.removeAt(i);
        continue; // the swapped-in particle now sits at i
      }
      d[o + AGE] = age;
      const def = STYLE_DEFS[d[o + STYLE]] ?? STYLE_DEFS[0];
      const seed = d[o + SEED];

      // ── Integrate ──
      const damp = Math.max(0, 1 - d[o + DRAG] * dt);
      let vx = d[o + VX] * damp;
      let vy = d[o + VY] * damp + d[o + GRAV] * dt;
      let vz = d[o + VZ] * damp;
      if (def.wobble > 0) {
        const w = def.wobble * dt;
        vx += Math.sin(seed * 91 + age * 3.3) * w;
        vy += Math.sin(seed * 13 + age * 2.1) * w * 0.4;
        vz += Math.cos(seed * 37 + age * 2.9) * w;
      }
      const ak = d[o + AK];
      if (ak !== 0) {
        const dx = d[o + AX] - d[o + PX];
        const dy = d[o + AY] - d[o + PY];
        const dz = d[o + AZ] - d[o + PZ];
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 0.22) {
          this.removeAt(i);
          continue; // swallowed
        }
        const k = (ak * dt) / dist;
        vx += dx * k;
        vy += dy * k;
        vz += dz * k;
      }
      const px = d[o + PX] + vx * dt;
      let py = d[o + PY] + vy * dt;
      const pz = d[o + PZ] + vz * dt;
      if (def.bounce >= 0) {
        const floorY = d[o + FLOOR];
        if (py < floorY && vy < 0) {
          py = floorY;
          vy = -vy * def.bounce;
          vx *= 0.7;
          vz *= 0.7;
        }
      }
      d[o + PX] = px;
      d[o + PY] = py;
      d[o + PZ] = pz;
      d[o + VX] = vx;
      d[o + VY] = vy;
      d[o + VZ] = vz;
      const rot = d[o + ROT] + d[o + SPIN] * dt;
      d[o + ROT] = rot;

      // ── Curves ──
      const t = age / life;
      const size = lifeSize(t, d[o + SIZE0], d[o + SIZE1], def.sizeCurve);
      let alpha = d[o + ALPHA];
      if (def.fadeOutPow > 0 || def.fadeIn > 0) alpha *= lifeAlpha(t, def.fadeIn, def.fadeOutPow);
      if (def.flicker > 0) alpha *= flicker(age, seed, def.flicker);
      const m = colorMix(t, def.colorK);
      let bright = 1;
      if (def.tumble) bright = 0.55 + 0.45 * Math.abs(Math.cos(rot * 1.3 + seed * 6));

      // ── Write instance ──
      const q = i * INSTANCE_VEC;
      posSize[q] = px;
      posSize[q + 1] = py;
      posSize[q + 2] = pz;
      posSize[q + 3] = size;
      color[q] = lerp(d[o + R0], d[o + R1], m) * bright;
      color[q + 1] = lerp(d[o + G0], d[o + G1], m) * bright;
      color[q + 2] = lerp(d[o + B0], d[o + B1], m) * bright;
      color[q + 3] = clamp01(alpha);
      // axis.w: stretch seconds for streaks, the particle's seed otherwise
      // (smoke uses it to pick its noise, so no two puffs share a shape).
      if (def.shape === SHAPE.ring) {
        axis[q] = d[o + NX];
        axis[q + 1] = d[o + NY];
        axis[q + 2] = d[o + NZ];
        axis[q + 3] = seed;
      } else {
        axis[q] = vx;
        axis[q + 1] = vy;
        axis[q + 2] = vz;
        if (def.shape === SHAPE.streak) {
          const over = d[o + STRETCH];
          axis[q + 3] = over === over ? over : def.stretch; // NaN = style default
        } else {
          axis[q + 3] = seed;
        }
      }
      misc[q] = def.shape;
      misc[q + 1] = def.additive;
      misc[q + 2] = rot;
      misc[q + 3] = def.lit;
      i++;
    }
    return this.count;
  }

  private removeAt(i: number): void {
    const last = --this.count;
    if (i !== last) this.data.copyWithin(i * STRIDE, last * STRIDE, last * STRIDE + STRIDE);
    if (this.evict >= this.count) this.evict = 0;
  }
}
