import type RAPIER from "@dimforge/rapier3d-compat";
import { PLAYER } from "../core/config";
import type { Vec } from "../enemies/brains/common";
import { ENEMY_STATS, type EnemyId } from "../enemies/roster";
import { NEUTRAL_FLOOR_RULES, type FloorRules } from "../game/floorRules";
import { q2, q3 } from "../net/snapshots";
import { sanitizeHit } from "../weapons/hits";
import { omenRules } from "../world/omens";
import type { FloorLayout, PropKind, Vec3 } from "../world/types";
import { enemyBody, WIZARD_GROUPS } from "./bodies";
import { createEnemy, enemyOptions, type EnemyController } from "./enemies/controllers";
import type { EnemyCore } from "./enemies/core";
import { buildFloorPhysics, type FloorPhysics, type Rapier } from "./floorPhysics";
import { blastFalloff, PROP_LOOT_MIN_Y, PROP_RULES } from "./props";
import { DartTrapController } from "./traps";
import type { EntitySnap, SimAction, SimCue, SimTarget, SimWorld } from "./world";

/** A floor's simulation, headless: its physics (sim/floorPhysics.ts), every
 * enemy the layout spawns running the same core and controller the browser
 * host runs (sim/enemies), its breakable props (sim/props.ts) and dart
 * launchers (sim/traps.ts), and the wizards on it as kinematic capsules.
 *
 * It is a floor authority without a browser — for a floor hosted on a server
 * (any floor two strangers share), for tests and for benchmarks. The caller
 * owns the clock and the wire:
 *
 *  - in:  wizard poses (setWizard / removeWizard) and hit commands (hit),
 *         which are sanitized here exactly as a browser host sanitizes them;
 *  - out: drain() — the authoritative actions (bolts, slams, splits, deaths
 *         and breaks, loot reports) a browser host would announce as host
 *         events — and snapshot() — entity snapshots in the replication
 *         wire format (sim/world.ts EntitySnap).
 *
 * Entity ids are the browser's ("e3", "p12", "boss", "s1"), so a client can't
 * tell which kind of host it is playing against. A sim can also start as a
 * REPLICA of a floor someone else has been hosting (mirror / mirrorDespawn /
 * mirrorSpawn — the same facts a browser replica applies) and take over from
 * there: host migration, with a headless host on the receiving end.
 *
 * Not simulated here: enemy bolts in flight (every client flies its own
 * copy; their bursts hurt wizards client-side and leave props be), and the
 * wizards' own spells, whose hits arrive as commands from their casters. */

export interface FloorSimOptions {
  /** The sim's dice (brains, splits, trap clocks). Defaults to Math.random. */
  random?: () => number;
}

/** An enemy spawned at runtime (a slime's child) — what a late joiner must
 * be told to spawn (enemies/spawnedStore.ts SpawnedEnemy, the same shape). */
export interface SpawnRecord {
  id: string;
  kind: EnemyId;
  generation: number;
  pos: Vec3;
  floor: number;
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

interface Blast {
  at: Vec;
  /** Base radius — the floor's explosionRadiusMult scales it. */
  radius: number;
  damage: number;
  impulse: number;
  /** Neutral blasts (barrels) hurt enemies too; the Warden's slam doesn't. */
  hurtsEnemies: boolean;
}

const ENEMY_KINDS: ReadonlySet<string> = new Set(ENEMY_STATS.map((e) => e.id));

function isTriple(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
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
  private readonly props = new Map<string, { kind: PropKind; hp: number }>();
  private readonly spawnRecords = new Map<string, SpawnRecord>();
  private readonly darts: DartTrapController[];
  private readonly wizards = new Map<string, Wizard>();
  /** Every id the layout put on this floor — the dead are these minus the
   * living, which is what a late joiner must learn. (Runtime spawns travel
   * as their own live list.) */
  private readonly known: string[] = [];
  private readonly outbox: SimAction[] = [];
  private readonly cueBox: { id: string; cue: SimCue }[] = [];
  private readonly blasts: Blast[] = [];
  private readonly sent = new Map<string, Sent>();
  private readonly ray: RAPIER.Ray;
  private readonly target: SimTarget = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, dist: Infinity };
  private readonly shove: Vec = { x: 0, y: 0, z: 0 };
  private spawned = 0;
  private flushing = false;

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
        return this.physics.world.castRay(ray, dist, true, undefined, undefined, undefined, self ?? undefined) === null;
      },
      random,
      act: (a) => this.act(a),
      // Copied: a cue's vectors are its controller's scratch.
      cue: (id, cue) => this.cueBox.push({ id, cue: structuredClone(cue) }),
    };

    layout.enemies.forEach((e, i) => this.addEnemy(`e${i}`, e.kind, e.pos, 0));
    if (layout.boss) this.addEnemy("boss", "boss", layout.boss, 0);
    layout.props.forEach((p, i) => this.props.set(`p${i}`, { kind: p.kind, hp: PROP_RULES[p.kind].hp }));
    this.known.push(...this.enemies.keys(), ...this.props.keys());
    this.darts = layout.traps
      .filter((t) => t.kind === "dart")
      .map((t) => new DartTrapController(this.world, t.pos, floor));
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

  /** Where a wizard last said they were (null if not on the floor). */
  wizardAt(id: string): Readonly<Vec> | null {
    return this.wizards.get(id)?.pos ?? null;
  }

  /** A "hit" command from a wizard, straight off the wire: sanitized and
   * capped for this depth, then taken by the enemy or prop. False when it
   * couldn't land (malformed, or nothing living by that id). */
  hit(id: string, data: unknown): boolean {
    const d = sanitizeHit(data, this.floor);
    if (!d || !this.alive(id)) return false;
    this.strike(id, d.damage, d.impulse);
    this.flush();
    return true;
  }

  // ── Tick ───────────────────────────────────────────────────────────────────

  /** One tick: every living enemy and dart launcher thinks, then the world
   * steps. An empty floor idles — nobody to hunt, nothing to decide. */
  step(dt: number): void {
    if (this.wizards.size > 0) {
      for (const e of this.enemies.values()) {
        const b = e.core.beginFrame(dt);
        if (b) e.ctl.think(b, dt, this.time);
      }
      for (const dart of this.darts) dart.think(dt);
      this.flush();
    }
    this.physics.step(dt);
    this.time += dt;
  }

  // ── Replica (before taking a floor over) ───────────────────────────────────

  /** The floor's current host says where `snap.id` is and what it holds.
   * (Its word is checked for shape — it is another machine's.) */
  mirror(snap: EntitySnap): void {
    if (!snap || typeof snap.id !== "string" || !isTriple(snap.p)) return;
    const body = this.physics.bodies.get(snap.id);
    if (!body) return;
    const [x, y, z] = snap.p;
    body.setTranslation({ x, y, z }, true);
    if (isTriple(snap.v)) body.setLinvel({ x: snap.v[0], y: snap.v[1], z: snap.v[2] }, true);
    if (Array.isArray(snap.q) && snap.q.length === 4 && snap.q.every(Number.isFinite)) {
      body.setRotation({ x: snap.q[0], y: snap.q[1], z: snap.q[2], w: snap.q[3] }, true);
    }
    const hp = typeof snap.f === "object" && snap.f ? snap.f.hp : undefined;
    if (typeof hp !== "number" || !Number.isFinite(hp)) return;
    const e = this.enemies.get(snap.id);
    if (e) {
      e.core.syncHp(hp);
      // Hurt means it was in a fight: it wakes into this host's hands awake.
      if (hp < e.core.maxHp) e.core.aggro = true;
    }
    const prop = this.props.get(snap.id);
    if (prop) prop.hp = hp;
  }

  /** The floor's current host says `id` died or broke. */
  mirrorDespawn(id: string): void {
    const e = this.enemies.get(id);
    if (e) {
      e.core.despawned(true);
      this.forget(id);
      return;
    }
    if (this.props.has(id)) this.forget(id);
  }

  /** The floor's current host spawned an enemy at runtime. */
  mirrorSpawn(s: SpawnRecord): void {
    if (!s || typeof s.id !== "string" || this.physics.bodies.has(s.id) || !isTriple(s.pos)) return;
    if (!ENEMY_KINDS.has(s.kind) || s.kind === "boss" || !Number.isFinite(s.generation)) return;
    this.addEnemy(s.id, s.kind, s.pos, s.generation);
    this.spawnRecords.set(s.id, { ...s, floor: this.floor });
    // Our own children are named past every name the floor has used.
    const n = /^s(\d+)$/.exec(s.id);
    if (n) this.spawned = Math.max(this.spawned, Number(n[1]));
  }

  // ── Out ────────────────────────────────────────────────────────────────────

  /** The authoritative actions since the last drain, in order. */
  drain(): SimAction[] {
    return this.outbox.splice(0);
  }

  /** The cues since the last drain — for the clients' views. */
  drainCues(): { id: string; cue: SimCue }[] {
    return this.cueBox.splice(0);
  }

  /** Snapshots of the floor's entities. `full` = everything that lives (a
   * late joiner's sync); otherwise only what changed since the last call,
   * with a keepalive while awake — the browser host's delta filter. */
  snapshot(full = false): EntitySnap[] {
    const out: EntitySnap[] = [];
    for (const [id, body] of this.physics.bodies) {
      const e = this.enemies.get(id);
      const prop = this.props.get(id);
      const t = body.translation();
      const snap: EntitySnap = { id, p: [q2(t.x), q2(t.y), q2(t.z)] };
      if (!e?.immobile) {
        const v = body.linvel();
        snap.v = [q2(v.x), q2(v.y), q2(v.z)];
      }
      if (prop) {
        // Props tumble — their rotation replicates too.
        const q = body.rotation();
        snap.q = [q3(q.x), q3(q.y), q3(q.z), q3(q.w)];
        snap.f = { hp: prop.hp };
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

  /** Is `id` a living enemy or an unbroken prop? */
  alive(id: string): boolean {
    return (this.enemies.has(id) && !this.enemies.get(id)!.core.dead) || this.props.has(id);
  }

  /** Every layout entity that was on this floor and isn't any more. */
  gone(): string[] {
    return this.known.filter((id) => !this.physics.bodies.has(id));
  }

  /** The runtime spawns still alive (a late joiner spawns these). */
  spawns(): SpawnRecord[] {
    return [...this.spawnRecords.values()];
  }

  /** An enemy's authority state (tests, debugging). */
  enemy(id: string): EnemyCore | undefined {
    return this.enemies.get(id)?.core;
  }

  /** A prop's health, if it stands. */
  propHp(id: string): number | undefined {
    return this.props.get(id)?.hp;
  }

  /** Stepping cost: dynamic bodies, how many are awake, wizards. */
  counts(): { bodies: number; awake: number; enemies: number; wizards: number } {
    const c = this.physics.counts();
    return { bodies: c.bodies, awake: c.awake, enemies: this.enemies.size, wizards: this.wizards.size };
  }

  free(): void {
    this.physics.free();
    this.enemies.clear();
    this.props.clear();
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
  }

  /** Damage and a shove land on an enemy or a prop (already sanitized). */
  private strike(id: string, damage: number, impulse: Vec): void {
    const e = this.enemies.get(id);
    if (e) {
      e.core.hit(damage, impulse);
      return;
    }
    const prop = this.props.get(id);
    if (!prop) return;
    prop.hp -= damage;
    const body = this.physics.bodies.get(id);
    body?.applyImpulse(impulse, true);
    if (prop.hp > 0 || !body) return;
    // It breaks: gone for everyone, its hiding place rolled by the loot book,
    // and a barrel goes up (queued, so a chain reaction never re-enters here).
    const t = body.translation();
    this.forget(id);
    this.outbox.push({ type: "died", id });
    this.outbox.push({ type: "loot", id, source: { kind: "prop", prop: prop.kind }, at: [t.x, Math.max(t.y, PROP_LOOT_MIN_Y), t.z] });
    const blast = PROP_RULES[prop.kind].blast;
    if (blast) this.blasts.push({ at: { x: t.x, y: t.y, z: t.z }, ...blast, hurtsEnemies: true });
  }

  /** Detonate queued blasts — and whatever they set off — in order. */
  private flush(): void {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (let blast = this.blasts.shift(); blast; blast = this.blasts.shift()) this.detonate(blast);
    } finally {
      this.flushing = false;
    }
  }

  private detonate(b: Blast): void {
    const radius = b.radius * this.rules.explosionRadiusMult;
    const shove = this.shove;
    for (const [id, body] of [...this.physics.bodies]) {
      const enemy = this.enemies.has(id);
      if (enemy && !b.hurtsEnemies) continue;
      if (!enemy && !this.props.has(id)) continue;
      const dealt = blastFalloff(b.at, body.translation(), radius, b.damage, b.impulse, shove);
      if (dealt !== null && this.alive(id)) this.strike(id, dealt, { x: shove.x, y: shove.y, z: shove.z });
    }
  }

  /** Out of the world: an entity that died or broke. */
  private forget(id: string): void {
    this.enemies.delete(id);
    this.props.delete(id);
    this.spawnRecords.delete(id);
    this.physics.remove(id);
    this.sent.delete(id);
  }

  private act(a: SimAction): void {
    switch (a.type) {
      case "spawn": {
        // This host names the child, so every client spawns the same one.
        const id = a.id ?? `s${++this.spawned}`;
        this.addEnemy(id, a.kind, a.pos, a.generation);
        this.spawnRecords.set(id, { id, kind: a.kind, generation: a.generation, pos: a.pos, floor: a.floor });
        this.outbox.push({ ...a, id });
        return;
      }
      case "died":
        // The death has read its body's last position already (core.die).
        this.forget(a.id);
        break;
      case "boom":
        // The Warden's slam shoves and breaks props here, as on a browser
        // host (its damage to wizards is each client's own business).
        this.blasts.push({
          at: { x: a.data.pos[0], y: a.data.pos[1], z: a.data.pos[2] },
          radius: a.data.radius,
          damage: a.data.damage,
          impulse: a.data.impulse,
          hurtsEnemies: false,
        });
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
