/** Hitscan geometry for the spells that don't fly: the Prism Ray's beam, the
 * Starpiercer's line, Dragon's Breath's cone, Forked Lightning's leaps — and
 * the swept test a piercing bolt uses to find what it passed through this
 * frame. Pure math over plain targets (centre + radius), no three.js, no
 * physics: walls are decided by the caller (a world raycast caps `maxDist`),
 * so every rule here is unit-tested. */

export interface Vec {
  x: number;
  y: number;
  z: number;
}

export interface HitTarget<T = unknown> {
  pos: Vec;
  /** Body radius — a wisp ~0.45, the Warden ~1.6. */
  radius: number;
  ref: T;
}

export interface RayHit<T> {
  target: HitTarget<T>;
  /** Distance along the ray to where it meets the target's sphere. */
  t: number;
}

/** Every target the ray (origin, unit dir) meets within `maxDist`, nearest
 * first. `slack` widens every sphere (a forgiving beam). */
export function rayHits<T>(origin: Vec, dir: Vec, maxDist: number, targets: readonly HitTarget<T>[], slack = 0): RayHit<T>[] {
  const out: RayHit<T>[] = [];
  for (const target of targets) {
    const t = raySphere(origin, dir, target.pos, target.radius + slack);
    if (t !== null && t <= maxDist) out.push({ target, t });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** Ray–sphere entry distance (0 if the origin is inside), or null on a miss
 * or a sphere behind the origin. `dir` must be unit length. */
export function raySphere(o: Vec, d: Vec, c: Vec, r: number): number | null {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  if (cc <= 0) return 0;
  if (b > 0) return null;
  const disc = b * b - cc;
  if (disc < 0) return null;
  return -b - Math.sqrt(disc);
}

/** Targets inside a cone (apex `origin`, unit axis `dir`, `range`, half
 * angle `halfAngle` radians), counting a target's radius generously. Each
 * comes with its distance and how centred it is (1 = on the axis). */
export function coneHits<T>(
  origin: Vec,
  dir: Vec,
  range: number,
  halfAngle: number,
  targets: readonly HitTarget<T>[],
): { target: HitTarget<T>; dist: number; centred: number }[] {
  const out: { target: HitTarget<T>; dist: number; centred: number }[] = [];
  const cosHalf = Math.cos(halfAngle);
  for (const target of targets) {
    const vx = target.pos.x - origin.x;
    const vy = target.pos.y - origin.y;
    const vz = target.pos.z - origin.z;
    const dist = Math.hypot(vx, vy, vz);
    if (dist - target.radius > range) continue;
    if (dist <= target.radius) {
      out.push({ target, dist: 0, centred: 1 });
      continue;
    }
    const along = (vx * dir.x + vy * dir.y + vz * dir.z) / dist;
    // Widen the cone by the angle the body subtends.
    const widen = Math.asin(Math.min(1, target.radius / dist));
    if (along < Math.cos(Math.min(Math.PI / 2, halfAngle + widen))) continue;
    out.push({ target, dist, centred: Math.max(0, Math.min(1, (along - cosHalf) / (1 - cosHalf || 1))) });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}

/** Lightning's leaps: from `start`, hop to the nearest target not yet struck
 * within `jumpRange`, up to `jumps` times. Returns the struck targets in
 * order (the first target is the caller's — pass it in `first`). */
export function chainPath<T>(
  first: HitTarget<T>,
  targets: readonly HitTarget<T>[],
  jumps: number,
  jumpRange: number,
): HitTarget<T>[] {
  const path = [first];
  const struck = new Set<HitTarget<T>>([first]);
  let from = first.pos;
  for (let i = 0; i < jumps; i++) {
    let best: HitTarget<T> | null = null;
    let bestD = jumpRange;
    for (const t of targets) {
      if (struck.has(t)) continue;
      const d = Math.hypot(t.pos.x - from.x, t.pos.y - from.y, t.pos.z - from.z) - t.radius;
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (!best) break;
    path.push(best);
    struck.add(best);
    from = best.pos;
  }
  return path;
}

/** Targets a moving sphere of `radius` touched while travelling from `a` to
 * `b` this frame (a piercing bolt), in travel order. */
export function sweptHits<T>(a: Vec, b: Vec, radius: number, targets: readonly HitTarget<T>[]): HitTarget<T>[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  const hits: { t: number; target: HitTarget<T> }[] = [];
  for (const target of targets) {
    const px = target.pos.x - a.x;
    const py = target.pos.y - a.y;
    const pz = target.pos.z - a.z;
    const t = len2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / len2)) : 0;
    const cx = a.x + dx * t - target.pos.x;
    const cy = a.y + dy * t - target.pos.y;
    const cz = a.z + dz * t - target.pos.z;
    const r = radius + target.radius;
    if (cx * cx + cy * cy + cz * cz <= r * r) hits.push({ t, target });
  }
  hits.sort((p, q) => p.t - q.t);
  return hits.map((h) => h.target);
}

/** A jagged lightning polyline from `a` to `b`: `segments` pieces, each
 * inner point displaced sideways by up to `jitter` (deterministic for a
 * given `rand`). Ends are exact. */
export function lightningPoints(a: Vec, b: Vec, segments: number, jitter: number, rand: () => number = Math.random): Vec[] {
  const pts: Vec[] = [{ ...a }];
  for (let i = 1; i < segments; i++) {
    const f = i / segments;
    // Fewer wiggles near the ends, the most in the middle.
    const k = jitter * Math.sin(f * Math.PI);
    pts.push({
      x: a.x + (b.x - a.x) * f + (rand() - 0.5) * 2 * k,
      y: a.y + (b.y - a.y) * f + (rand() - 0.5) * 2 * k,
      z: a.z + (b.z - a.z) * f + (rand() - 0.5) * 2 * k,
    });
  }
  pts.push({ ...b });
  return pts;
}
