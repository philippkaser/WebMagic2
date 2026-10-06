import type RAPIER from "@dimforge/rapier3d-compat";
import { PLAYER } from "../core/config";
import type { Vec } from "../enemies/brains/common";
import type { EnemyId } from "../enemies/roster";
import { NEUTRAL_FLOOR_RULES, type FloorRules } from "../game/floorRules";
import { q2, q3 } from "../net/snapshots";
import { sanitizeHit } from "../weapons/hits";
import { omenRules } from "../world/omens";
import type { FloorLayout, Vec3 } from "../world/types";
import { enemyBody, WIZARD_GROUPS } from "./bodies";
import { createEnemy, enemyOptions, type EnemyController } from "./enemies/controllers";
import type { EnemyCore } from "./enemies/core";
import { buildFloorPhysics, type FloorPhysics, type Rapier } from "./floorPhysics";
import type { EntitySnap, SimAction, SimTarget, SimWorld } from "./world";

/** A floor's simulation, headless: its physics (sim/floorPhysics.ts), every
 * enemy the layout spawns running the same core and controller the browser
 * host runs (sim/enemies), and the wizards on it as kinematic capsules.
 *
 * It is a floor authority without a browser — for a floor hosted on a server
 * (any floor two strangers share), for tests and for benchmarks. The caller
 * owns the clock and the wire:
 *
 *  - in:  wizard poses (setWizard / removeWizard) and hit commands (hit),
 *         which are sanitized here exactly as a browser host sanitizes them;
 *  - out: drain() — the authoritative actions (bolts, slams, splits, deaths,
 *         loot reports) a browser host would announce as host events — and
 *         snapshot() — entity snapshots in the replication wire format
 *         (sim/world.ts EntitySnap).
 *
 * Entity ids are the browser's ("e3", "p12", "boss", "s1"), so a client can't
 * tell which kind of host it is playing against. Props are physical here
 * (enemies bump them, snapshots move them); breaking them is still the
 * browser prop's job. */

export interface FloorSimOptions {
  /** The sim's dice (brains, splits). Defaults to Math.random. */
  random?: () => number;
}

interface SimEnemy {
  core: EnemyCore;
  ctl: EnemyController;
  /** Fixed bodies (the sentry) replicate position and fields only. */
  immobile: boolean;
}

interface Wizard {
  body: RAPIER.RigidBody;
  pos: Vec;
  vel: Vec;
}

/** Re-send an unchanged awake entity at least this often (sim seconds). */
const KEEPALIVE_S = 0.5;
/** Movement below this (squared, m²) isn't worth a packet: 2 cm. */
const POS_EPSILON_SQ = 0.0004;
/** Nor is a turn this small (|q·q'| above it). */
const QUAT_EPSILON = 1 - 1e-5;

interface Sent {
  p: [number, number, number];
  q: [number, number, number, number] | undefined;
  f: string;
  at: number;
  asleep: boolean;
}

export class FloorSim {
  readonly physics: FloorPhysics;
  readonly rules: Readonly<FloorRules>;
  readonly floor: number;
  /** Seconds simulated so far (the controllers' clock). */
  time = 0;

  private readonly R: Rapier;
  private readonly enemies = new Map<string, SimEnemy>();
  private readonly wizards = new Map<string, Wizard>();
  /** Every id this floor has had (layout and spawned) — the dead are these
   * minus the living, which is what a late joiner must learn. */
  private readonly known: string[] = [];
  private readonly outbox: SimAction[] = [];
  private readonly sent = new Map<string, Sent>();
  private readonly ray: RAPIER.Ray;
  private readonly target: SimTarget = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, dist: Infinity };
  private spawned = 0;

  /** What the sim asks of the world — answered from this floor alone. */
  readonly world: SimWorld;

  constructor(R: Rapier, layout: FloorLayout, floor: number, opts: FloorSimOptions = {}) {
    this.R = R;
    this.floor = floor;
    this.rules = Object.freeze({ ...NEUTRAL_FLOOR_RULES, ...omenRules(layout.omen) });
    this.physics = buildFloorPhysics(R, layout);
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    const random = opts.random ?? Math.random;
    this.world = {
      rules: () => this.rules,
      nearestWizard: (x, y, z) => this.nearestWizard(x, y, z),
      // Stealth is a wizard's stat; a shared floor wakes to everyone alike.
      aggroMult: () => 1,
      clearShot: (from, dir, dist, self) => {
        const ray = this.ray;
        ray.origin.x = from.x;
        ray.origin.y = from.y;
        ray.origin.z = from.z;
        ray.dir.x = dir.x;
        ray.dir.y = dir.y;
        ray.dir.z = dir.z;
        return this.physics.world.castRay(ray, dist, true, undefined, undefined, undefined, self) === null;
      },
      random,
      act: (a) => this.act(a),
    };

    layout.enemies.forEach((e, i) => this.addEnemy(`e${i}`, e.kind, e.pos, 0));
    if (layout.boss) this.addEnemy("boss", "boss", layout.boss, 0);
    layout.props.forEach((_, i) => this.known.push(`p${i}`));
  }

  // ── In ─────────────────────────────────────────────────────────────────────

  /** A wizard's latest pose (its capsule centre and velocity). */
  setWizard(id: string, pos: Vec, vel: Vec): void {
    let w = this.wizards.get(id);
    if (!w) {
      const body = this.physics.world.createRigidBody(
        this.R.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z),
      );
      this.physics.world.createCollider(
        this.R.ColliderDesc.capsule(PLAYER.halfHeight, PLAYER.radius).setFriction(0).setCollisionGroups(WIZARD_GROUPS),
        body,
      );
      w = { body, pos: { x: pos.x, y: pos.y, z: pos.z }, vel: { x: 0, y: 0, z: 0 } };
      this.wizards.set(id, w);
    }
    w.pos.x = pos.x;
    w.pos.y = pos.y;
    w.pos.z = pos.z;
    w.vel.x = vel.x;
    w.vel.y = vel.y;
    w.vel.z = vel.z;
    w.body.setNextKinematicTranslation(w.pos);
  }

  /** A wizard left the floor. */
  removeWizard(id: string): void {
    const w = this.wizards.get(id);
    if (!w) return;
    this.physics.world.removeRigidBody(w.body);
    this.wizards.delete(id);
  }

  /** A "hit" command from a wizard, straight off the wire: sanitized and
   * capped for this depth, then taken by the enemy. False when it couldn't
   * land (malformed, or no such living enemy). */
  hit(id: string, data: unknown): boolean {
    const e = this.enemies.get(id);
    const d = sanitizeHit(data, this.floor);
    if (!e || e.core.dead || !d) return false;
    e.core.hit(d.damage, d.impulse);
    return true;
  }

  // ── Tick ───────────────────────────────────────────────────────────────────

  /** One tick: every living enemy thinks, then the world steps. An empty
   * floor idles — nobody to hunt, nothing to decide. */
  step(dt: number): void {
    if (this.wizards.size > 0) {
      for (const e of this.enemies.values()) {
        const b = e.core.beginFrame(dt);
        if (b) e.ctl.think(b, dt, this.time);
      }
    }
    this.physics.step(dt);
    this.time += dt;
  }

  // ── Out ────────────────────────────────────────────────────────────────────

  /** The authoritative actions since the last drain, in order. */
  drain(): SimAction[] {
    return this.outbox.splice(0);
  }

  /** Snapshots of the floor's entities. `full` = everything that lives (a
   * late joiner's sync); otherwise only what changed since the last call,
   * with a keepalive while awake — the browser host's delta filter. */
  snapshot(full = false): EntitySnap[] {
    const out: EntitySnap[] = [];
    for (const [id, body] of this.physics.bodies) {
      const e = this.enemies.get(id);
      const prop = !e;
      const t = body.translation();
      const snap: EntitySnap = { id, p: [q2(t.x), q2(t.y), q2(t.z)] };
      if (!e?.immobile) {
        const v = body.linvel();
        snap.v = [q2(v.x), q2(v.y), q2(v.z)];
      }
      if (prop) {
        const q = body.rotation();
        snap.q = [q3(q.x), q3(q.y), q3(q.z), q3(q.w)];
      }
      if (e) snap.f = e.core.fields();
      // A fixed body (the sentry) never moves: only its fields can change.
      if (full || this.changed(id, snap, !!e?.immobile || body.isSleeping())) out.push(snap);
    }
    return out;
  }

  /** Living enemies (ids). */
  living(): string[] {
    return [...this.enemies.keys()];
  }

  /** Everything that was on this floor and isn't any more. */
  gone(): string[] {
    return this.known.filter((id) => !this.physics.bodies.has(id));
  }

  /** An enemy's authority state (tests, debugging). */
  enemy(id: string): EnemyCore | undefined {
    return this.enemies.get(id)?.core;
  }

  /** Stepping cost: dynamic bodies, how many are awake, wizards. */
  counts(): { bodies: number; awake: number; enemies: number; wizards: number } {
    const c = this.physics.counts();
    return { bodies: c.bodies, awake: c.awake, enemies: this.enemies.size, wizards: this.wizards.size };
  }

  free(): void {
    this.physics.free();
    this.enemies.clear();
    this.wizards.clear();
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private addEnemy(id: string, kind: EnemyId, pos: Vec3, generation: number): void {
    const spec = enemyBody(kind, generation);
    if (!this.physics.bodies.has(id)) this.physics.add(id, spec, pos);
    const { core, ctl } = createEnemy(
      this.world,
      enemyOptions(id, kind, this.floor, pos, generation),
      () => this.physics.bodies.get(id) ?? null,
    );
    this.enemies.set(id, { core, ctl, immobile: spec.type === "fixed" });
    this.known.push(id);
  }

  private act(a: SimAction): void {
    switch (a.type) {
      case "spawn": {
        // This host names the child, so every client spawns the same one.
        const id = a.id ?? `s${++this.spawned}`;
        this.addEnemy(id, a.kind, a.pos, a.generation);
        this.outbox.push({ ...a, id });
        return;
      }
      case "died":
        // The death has read its body's last position already (core.die).
        this.enemies.delete(a.id);
        this.physics.remove(a.id);
        this.sent.delete(a.id);
        break;
    }
    this.outbox.push(a);
  }

  private nearestWizard(x: number, y: number, z: number): SimTarget {
    const target = this.target;
    let best = Infinity;
    let found: Wizard | null = null;
    for (const w of this.wizards.values()) {
      const d2 = (w.pos.x - x) ** 2 + (w.pos.y - y) ** 2 + (w.pos.z - z) ** 2;
      if (d2 < best) {
        best = d2;
        found = w;
      }
    }
    if (found) {
      target.pos.x = found.pos.x;
      target.pos.y = found.pos.y;
      target.pos.z = found.pos.z;
      target.vel.x = found.vel.x;
      target.vel.y = found.vel.y;
      target.vel.z = found.vel.z;
    } else {
      // Nobody here: a target where the asker stands, infinitely far — out
      // of every wake and fire range. (step() doesn't think on an empty floor.)
      target.pos.x = x;
      target.pos.y = y;
      target.pos.z = z;
      target.vel.x = target.vel.y = target.vel.z = 0;
    }
    target.dist = Math.sqrt(best);
    return target;
  }

  private changed(id: string, snap: EntitySnap, asleep: boolean): boolean {
    const fKey = snap.f ? JSON.stringify(snap.f) : "";
    const prev = this.sent.get(id);
    if (prev) {
      const moved =
        (prev.p[0] - snap.p[0]) ** 2 + (prev.p[1] - snap.p[1]) ** 2 + (prev.p[2] - snap.p[2]) ** 2 > POS_EPSILON_SQ;
      const turned =
        snap.q && prev.q
          ? Math.abs(snap.q[0] * prev.q[0] + snap.q[1] * prev.q[1] + snap.q[2] * prev.q[2] + snap.q[3] * prev.q[3]) <
            QUAT_EPSILON
          : false;
      const fieldsChanged = fKey !== prev.f;
      const stale = !asleep && this.time - prev.at > KEEPALIVE_S;
      if (!moved && !turned && !fieldsChanged && !stale) return false;
      if (asleep && prev.asleep && !fieldsChanged) return false; // settled — go quiet
    }
    this.sent.set(id, { p: snap.p, q: snap.q, f: fKey, at: this.time, asleep });
    return true;
  }
}
