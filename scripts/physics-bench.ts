// Floor physics benchmark: what simulating one floor headless costs, and how
// that grows with the number of physics objects. Runs real generated floors
// through sim/floorPhysics.ts (the same bodies the browser builds) and prints,
// per scenario: dynamic bodies, how many are awake, physics ms per step, the
// share of one CPU core at the given tick rate, and the snapshot bandwidth
// the replication layer would send (net/entities.ts: 20 Hz, 2 cm delta
// filter, keepalive while awake, silent once asleep).
//
//   bun run physics-bench            (or: bun scripts/physics-bench.ts)
//
// Scenarios:
//   patrol — enemies steer around (as their brains do), props left alone
//   brawl  — every half second explosions shove a third of the props and
//            every enemy, and 40 bolts are in flight: a worst case
//   ×N     — the floor with N times its props (more physics objects later)
import RAPIER from "@dimforge/rapier3d-compat";
import { Rng } from "../src/core/rng";
import { q2, q3 } from "../src/net/snapshots";
import { PROP_BODIES, type BodySpec } from "../src/sim/bodies";
import { buildFloorPhysics, type FloorPhysics } from "../src/sim/floorPhysics";
import { generateFloor } from "../src/world/gen";
import type { FloorLayout } from "../src/world/types";

await RAPIER.init();

const FLOORS = [1, 10, 30, 60, 95];
const SEEDS = [11, 22, 33];
const SECONDS = 8;
const SNAP_HZ = 20;
const BOLT: BodySpec = {
  type: "dynamic",
  shape: { kind: "ball", radius: 0.14 },
  mass: 0.05,
  gravityScale: 0,
  linearDamping: 0,
  angularDamping: 0,
  lockRotations: true,
  groups: PROP_BODIES.pot.groups,
};

interface Result {
  bodies: number;
  awake: number;
  meanMs: number;
  p95Ms: number;
  bytesPerSec: number;
  /** The same, each message compressed on its own (permessage-deflate
   * without context takeover — a conservative bound). */
  deflatedPerSec: number;
}

/** Extra props around the real ones (jittered, stacked a little higher so
 * they don't start inside each other). */
function withMoreProps(layout: FloorLayout, factor: number, rng: Rng): FloorLayout {
  if (factor <= 1) return layout;
  const props = [...layout.props];
  for (let k = 1; k < factor; k++) {
    for (const p of layout.props) {
      props.push({
        kind: p.kind,
        pos: [p.pos[0] + rng.range(-1.2, 1.2), p.pos[1] + 0.9 * k, p.pos[2] + rng.range(-1.2, 1.2)],
      });
    }
  }
  return { ...layout, props };
}

/** The replication delta filter (net/entities.ts captureSnap), counting bytes. */
class SnapMeter {
  private last = new Map<string, { p: number[]; at: number; asleep: boolean }>();
  bytes = 0;
  deflated = 0;
  tick(physics: FloorPhysics, now: number): void {
    const batch: unknown[] = [];
    for (const [id, b] of physics.bodies) {
      if (!b.isDynamic()) continue;
      const t = b.translation();
      const p = [q2(t.x), q2(t.y), q2(t.z)];
      const asleep = b.isSleeping();
      const prev = this.last.get(id);
      if (prev) {
        const moved = (prev.p[0] - p[0]) ** 2 + (prev.p[1] - p[1]) ** 2 + (prev.p[2] - p[2]) ** 2 > 0.0004;
        const stale = !asleep && now - prev.at > 500;
        if (!moved && !stale) continue;
        if (asleep && prev.asleep) continue;
      }
      const v = b.linvel();
      const q = b.rotation();
      batch.push({
        id,
        p,
        v: [q2(v.x), q2(v.y), q2(v.z)],
        q: [q3(q.x), q3(q.y), q3(q.z), q3(q.w)],
        f: { hp: 26 },
      });
      this.last.set(id, { p, at: now, asleep });
    }
    // The envelope the relay adds around a batch (ch, from, epoch, time).
    if (batch.length === 0) return;
    const json = JSON.stringify({ t: "msg", ch: "a:snap", from: "abcd1234", epoch: 1, serverTime: now, data: { ents: batch } });
    this.bytes += json.length;
    this.deflated += Bun.deflateSync(new TextEncoder().encode(json)).length;
  }
}

function run(layout: FloorLayout, hz: number, scenario: "patrol" | "brawl", seed: number): Result {
  const physics = buildFloorPhysics(RAPIER, layout);
  const rng = new Rng(seed);
  const dt = 1 / hz;
  for (let i = 0; i < hz * 3; i++) physics.step(dt); // settle

  const enemies = [...physics.bodies.entries()].filter(([id]) => id.startsWith("e") || id === "boss");
  const props = [...physics.bodies.entries()].filter(([id]) => id.startsWith("p"));
  const targets = new Map(enemies.map(([id, b]) => [id, b.translation()]));
  const times: number[] = [];
  let awakeSum = 0;
  const meter = new SnapMeter();
  let nextSnap = 0;
  let bolts = 0;

  for (let i = 0; i < hz * SECONDS; i++) {
    const now = i * dt * 1000;
    // Enemies steer as their brains do: a velocity toward a wander target.
    for (const [id, b] of enemies) {
      if (!b.isDynamic()) continue;
      const t = b.translation();
      let goal = targets.get(id)!;
      if ((goal.x - t.x) ** 2 + (goal.z - t.z) ** 2 < 1 || rng.next() < 0.01) {
        goal = { x: t.x + rng.range(-6, 6), y: t.y, z: t.z + rng.range(-6, 6) };
        targets.set(id, goal);
      }
      const dx = goal.x - t.x;
      const dz = goal.z - t.z;
      const d = Math.hypot(dx, dz) || 1;
      b.setLinvel({ x: (dx / d) * 3, y: b.linvel().y, z: (dz / d) * 3 }, true);
    }
    if (scenario === "brawl" && i % Math.round(hz / 2) === 0) {
      for (const [, b] of props) {
        if (rng.next() < 0.33) b.applyImpulse({ x: rng.range(-3, 3), y: rng.range(1, 4), z: rng.range(-3, 3) }, true);
      }
      for (const [, b] of enemies) if (b.isDynamic()) b.applyImpulse({ x: rng.range(-8, 8), y: 2, z: rng.range(-8, 8) }, true);
      // Keep ~40 bolts in flight (each lives about a second).
      for (let k = 0; k < 20; k++) {
        const id = `bolt${bolts++}`;
        const from = enemies[k % Math.max(1, enemies.length)]?.[1].translation() ?? { x: 0, y: 1.5, z: 0 };
        const body = physics.add(id, BOLT, [from.x, 1.5, from.z]);
        body.enableCcd(true);
        body.setLinvel({ x: rng.range(-20, 20), y: 0, z: rng.range(-20, 20) }, true);
        if (bolts > 40) physics.remove(`bolt${bolts - 41}`);
      }
    }
    const t0 = performance.now();
    physics.step(dt);
    times.push(performance.now() - t0);
    awakeSum += physics.counts().awake;
    if (now >= nextSnap) {
      meter.tick(physics, now);
      nextSnap += 1000 / SNAP_HZ;
    }
  }
  const sorted = [...times].sort((a, b) => a - b);
  const result: Result = {
    bodies: physics.counts().bodies,
    awake: awakeSum / times.length,
    meanMs: times.reduce((a, b) => a + b, 0) / times.length,
    p95Ms: sorted[Math.floor(sorted.length * 0.95)],
    bytesPerSec: meter.bytes / SECONDS,
    deflatedPerSec: meter.deflated / SECONDS,
  };
  physics.free();
  return result;
}

function average(rs: Result[]): Result {
  const avg = (k: keyof Result) => rs.reduce((a, r) => a + r[k], 0) / rs.length;
  return {
    bodies: avg("bodies"),
    awake: avg("awake"),
    meanMs: avg("meanMs"),
    p95Ms: Math.max(...rs.map((r) => r.p95Ms)),
    bytesPerSec: avg("bytesPerSec"),
    deflatedPerSec: avg("deflatedPerSec"),
  };
}

const rows: string[][] = [];
for (const hz of [30, 60]) {
  for (const scenario of ["patrol", "brawl"] as const) {
    for (const factor of [1, 5, 10]) {
      const results: Result[] = [];
      for (const floor of FLOORS) {
        for (const seed of SEEDS) {
          const layout = withMoreProps(generateFloor(seed * 7919 + floor, floor), factor, new Rng(seed));
          results.push(run(layout, hz, scenario, seed));
        }
      }
      const r = average(results);
      rows.push([
        `${hz} Hz`,
        scenario,
        `×${factor}`,
        r.bodies.toFixed(0),
        r.awake.toFixed(0),
        r.meanMs.toFixed(3),
        r.p95Ms.toFixed(2),
        `${((r.meanMs * hz) / 10).toFixed(2)} %`,
        `${(r.bytesPerSec / 1024).toFixed(1)} KiB/s`,
        `${(r.deflatedPerSec / 1024).toFixed(1)} KiB/s`,
      ]);
    }
  }
}

const head = ["tick", "scenario", "props", "bodies", "awake", "ms/step", "p95 ms", "core", "snapshots/player", "deflated"];
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const line = (cells: string[]) => cells.map((c, i) => c.padStart(widths[i])).join("  ");
console.log(line(head));
for (const r of rows) console.log(line(r));
console.log(`\n${FLOORS.length * SEEDS.length} floors per row (floors ${FLOORS.join(", ")}), ${SECONDS} s each.`);
