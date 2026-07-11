/** Timestamped snapshot buffers with interpolation.
 *
 * Replicated motion in this game renders ~120 ms in the past: incoming
 * snapshots are buffered by server timestamp, and each frame the buffer is
 * sampled at (serverNow − delay). Between two snapshots position is
 * hermite-interpolated using the sender's velocities (so arcs stay arcs at
 * 15 Hz); past the newest snapshot it extrapolates briefly, then holds.
 * Rotation is nlerp'd; named angles (yaw/pitch) take the shortest arc.
 *
 * Pure logic — no three.js, no React — so it is unit-testable and can run
 * in a future headless host. */

export interface Snap {
  /** Server timeline, ms. */
  t: number;
  p: [number, number, number];
  /** Velocity (units/s) — enables hermite interpolation + extrapolation. */
  v?: [number, number, number];
  /** Rotation quaternion (props tumble; enemies don't need it). */
  q?: [number, number, number, number];
  /** Named angles in radians, interpolated along the shortest arc. */
  a?: number[];
}

export interface SampledPose {
  p: [number, number, number];
  v: [number, number, number];
  q: [number, number, number, number] | null;
  a: number[] | null;
}

/** How far past the newest snapshot we keep moving before freezing (ms).
 * Long enough to ride out one dropped interval, short enough that a stopped
 * sender doesn't overshoot far. */
export const MAX_EXTRAPOLATION_MS = 250;

const MAX_SNAPS = 32;

export function makeSampledPose(): SampledPose {
  return { p: [0, 0, 0], v: [0, 0, 0], q: null, a: null };
}

export class SnapshotBuffer {
  private snaps: Snap[] = [];

  get size(): number {
    return this.snaps.length;
  }

  latest(): Snap | null {
    return this.snaps.length > 0 ? this.snaps[this.snaps.length - 1] : null;
  }

  push(snap: Snap): void {
    const snaps = this.snaps;
    // Overwhelmingly the common case: newest arrives last.
    if (snaps.length === 0 || snap.t >= snaps[snaps.length - 1].t) {
      if (snaps.length > 0 && snap.t === snaps[snaps.length - 1].t) {
        snaps[snaps.length - 1] = snap; // same-stamp update wins
      } else {
        snaps.push(snap);
      }
    } else {
      // Late packet — insert in order so sampling stays monotonic.
      let i = snaps.length - 1;
      while (i > 0 && snaps[i - 1].t > snap.t) i--;
      snaps.splice(i, 0, snap);
    }
    if (snaps.length > MAX_SNAPS) snaps.splice(0, snaps.length - MAX_SNAPS);
  }

  clear(): void {
    this.snaps.length = 0;
  }

  /** Sample the buffer at `time` (server timeline). Returns false while the
   * buffer is empty; `out` is only written on success. */
  sample(time: number, out: SampledPose): boolean {
    const snaps = this.snaps;
    if (snaps.length === 0) return false;

    const newest = snaps[snaps.length - 1];
    if (time >= newest.t) {
      // Beyond the newest data: extrapolate along its velocity, capped.
      const dt = Math.min(time - newest.t, MAX_EXTRAPOLATION_MS) / 1000;
      const v = newest.v;
      out.p[0] = newest.p[0] + (v ? v[0] * dt : 0);
      out.p[1] = newest.p[1] + (v ? v[1] * dt : 0);
      out.p[2] = newest.p[2] + (v ? v[2] * dt : 0);
      writeVel(out, v);
      writeQuat(out, newest.q ?? null);
      writeAngles(out, newest.a ?? null);
      return true;
    }

    const oldest = snaps[0];
    if (time <= oldest.t) {
      out.p[0] = oldest.p[0];
      out.p[1] = oldest.p[1];
      out.p[2] = oldest.p[2];
      writeVel(out, oldest.v);
      writeQuat(out, oldest.q ?? null);
      writeAngles(out, oldest.a ?? null);
      return true;
    }

    // Find the bracketing pair (buffers are short; linear scan from the end).
    let hi = snaps.length - 1;
    while (snaps[hi - 1].t > time) hi--;
    const s0 = snaps[hi - 1];
    const s1 = snaps[hi];
    const span = s1.t - s0.t;
    const u = span > 0 ? (time - s0.t) / span : 1;

    if (s0.v && s1.v && span <= 400) {
      hermite(out.p, s0.p, s0.v, s1.p, s1.v, u, span / 1000);
    } else {
      out.p[0] = s0.p[0] + (s1.p[0] - s0.p[0]) * u;
      out.p[1] = s0.p[1] + (s1.p[1] - s0.p[1]) * u;
      out.p[2] = s0.p[2] + (s1.p[2] - s0.p[2]) * u;
    }
    if (s0.v && s1.v) {
      out.v[0] = s0.v[0] + (s1.v[0] - s0.v[0]) * u;
      out.v[1] = s0.v[1] + (s1.v[1] - s0.v[1]) * u;
      out.v[2] = s0.v[2] + (s1.v[2] - s0.v[2]) * u;
    } else {
      writeVel(out, s1.v ?? s0.v);
    }

    if (s0.q && s1.q) {
      nlerp(ensureQuat(out), s0.q, s1.q, u);
    } else {
      writeQuat(out, s1.q ?? s0.q ?? null);
    }

    if (s0.a && s1.a) {
      const a = ensureAngles(out, s0.a.length);
      for (let i = 0; i < a.length; i++) {
        a[i] = s0.a[i] + shortestArc(s1.a[i] - s0.a[i]) * u;
      }
    } else {
      writeAngles(out, s1.a ?? s0.a ?? null);
    }
    return true;
  }
}

function writeVel(out: SampledPose, v: [number, number, number] | undefined): void {
  out.v[0] = v ? v[0] : 0;
  out.v[1] = v ? v[1] : 0;
  out.v[2] = v ? v[2] : 0;
}

function ensureQuat(out: SampledPose): [number, number, number, number] {
  if (!out.q) out.q = [0, 0, 0, 1];
  return out.q;
}

function writeQuat(out: SampledPose, q: [number, number, number, number] | null): void {
  if (!q) {
    out.q = null;
    return;
  }
  const dst = ensureQuat(out);
  dst[0] = q[0];
  dst[1] = q[1];
  dst[2] = q[2];
  dst[3] = q[3];
}

function ensureAngles(out: SampledPose, length: number): number[] {
  if (!out.a || out.a.length !== length) out.a = new Array(length).fill(0);
  return out.a;
}

function writeAngles(out: SampledPose, a: number[] | null): void {
  if (!a) {
    out.a = null;
    return;
  }
  const dst = ensureAngles(out, a.length);
  for (let i = 0; i < a.length; i++) dst[i] = a[i];
}

export function shortestArc(delta: number): number {
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}

/** Cubic hermite with velocity tangents. `h` is the segment span in seconds
 * (velocities are units/s, so tangents scale by it). */
function hermite(
  out: [number, number, number],
  p0: [number, number, number],
  v0: [number, number, number],
  p1: [number, number, number],
  v1: [number, number, number],
  u: number,
  h: number,
): void {
  const u2 = u * u;
  const u3 = u2 * u;
  const c0 = 2 * u3 - 3 * u2 + 1;
  const c1 = u3 - 2 * u2 + u;
  const c2 = -2 * u3 + 3 * u2;
  const c3 = u3 - u2;
  for (let i = 0; i < 3; i++) {
    out[i] = c0 * p0[i] + c1 * v0[i] * h + c2 * p1[i] + c3 * v1[i] * h;
  }
}

/** Normalized quaternion lerp with shortest-path sign flip — visually
 * indistinguishable from slerp at 15 Hz spacing and much cheaper. */
function nlerp(
  out: [number, number, number, number],
  a: [number, number, number, number],
  b: [number, number, number, number],
  u: number,
): void {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = dot < 0 ? -1 : 1;
  let x = a[0] + (b[0] * sign - a[0]) * u;
  let y = a[1] + (b[1] * sign - a[1]) * u;
  let z = a[2] + (b[2] * sign - a[2]) * u;
  let w = a[3] + (b[3] * sign - a[3]) * u;
  const len = Math.hypot(x, y, z, w) || 1;
  x /= len;
  y /= len;
  z /= len;
  w /= len;
  out[0] = x;
  out[1] = y;
  out[2] = z;
  out[3] = w;
}

/** Quantization for the wire: 2 dp for meters/velocities keeps packets small
 * without visible steps at this game's scale. */
export function q2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function q3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
