import { netBus } from "./bus";
import { hostCommand, onAuthority, sendAuthorityTo } from "./channels";
import { netClock } from "./clock";
import { isHost, useNet } from "./netStore";
import {
  makeSampledPose,
  q2,
  q3,
  SnapshotBuffer,
  type SampledPose,
} from "./snapshots";
import { session } from "./session";

/** Host-authority entity replication — the declarative core.
 *
 * A world entity (enemy, prop, boss) registers ONCE with a spec describing
 * its body, replicated fields and lifecycle callbacks. Everything else is
 * automatic:
 *
 *  - authority side: snapshots (position/velocity/rotation/fields) are
 *    captured at a fixed rate, delta-filtered, quantized and broadcast;
 *  - replica side: snapshots land in a timestamped buffer and the entity's
 *    kinematic body is driven through interpolated poses each frame;
 *  - commands (e.g. "hit") route to the authority — locally when we are it;
 *  - despawns broadcast live and replay silently for late joiners;
 *  - on host migration the promoted client's bodies resume with the last
 *    replicated velocity, mid-fight;
 *  - late-join world sync is assembled from this registry plus pluggable
 *    sync providers (loot, treasure, future systems) — joining mid-fight
 *    never shows a pristine "ghost" floor.
 *
 * Offline there is no traffic and entities simply simulate — the authority
 * path IS the single-player path. */

/** Structural subset of a Rapier rigid body — keeps this module free of
 * physics imports (and testable / server-runnable). */
export interface NetBodyLike {
  translation(): { x: number; y: number; z: number };
  rotation(): { x: number; y: number; z: number; w: number };
  linvel(): { x: number; y: number; z: number };
  setNextKinematicTranslation(v: { x: number; y: number; z: number }): void;
  setNextKinematicRotation(q: { x: number; y: number; z: number; w: number }): void;
  setLinvel(v: { x: number; y: number; z: number }, wake: boolean): void;
  isSleeping(): boolean;
}

export interface NetEntitySpec {
  id: string;
  body: () => NetBodyLike | null;
  /** Replicate the tumbling rotation (props). Enemies that always face the
   * player don't need it. */
  rotation?: boolean;
  /** Entity never moves (sentries): replicate fields only, don't drive the
   * body on replicas. */
  immobile?: boolean;
  /** Authority: gameplay scalars to replicate alongside the pose (hp…). */
  fields?: () => Record<string, number>;
  /** Replica: authoritative field values arrived. */
  onFields?: (fields: Record<string, number>) => void;
  /** Authority: a command (e.g. "hit") requested by any player. */
  onCommand?: (cmd: string, data: unknown, from: string) => void;
  /** Replica/late-join: the authority despawned this entity (death, break).
   * `catchup` = late-join replay — apply the state change without VFX. */
  onDespawn?: (data: unknown, catchup: boolean) => void;
}

// ── Wire formats (inside opaque envelopes) ───────────────────────────────────

interface WireSnap {
  id: string;
  p: [number, number, number];
  v?: [number, number, number];
  q?: [number, number, number, number];
  f?: Record<string, number>;
}

interface DespawnMsg {
  id: string;
  data?: unknown;
}

interface CmdMsg {
  id: string;
  cmd: string;
  data: unknown;
}

interface WorldSyncMsg {
  dead: string[];
  ents: WireSnap[];
  custom: Record<string, unknown>;
}

// ── Registry state ───────────────────────────────────────────────────────────

interface Entry {
  spec: NetEntitySpec;
  buffer: SnapshotBuffer;
  lastSent: { p: [number, number, number]; q: [number, number, number, number] | null; f: string; at: number; asleep: boolean } | null;
}

const entities = new Map<string, Entry>();

/** Every entity id the current floor layout spawns — set by the floor scene.
 * (expected − registered) = the dead, which late joiners must learn. */
let expectedIds: string[] = [];

/** Despawns that arrived before their entity mounted (late join / floor load). */
const pendingDespawns = new Map<string, unknown>();

const scratchPose: SampledPose = makeSampledPose();

export interface NetEntityHandle {
  /** Authority: broadcast that this entity despawned (the authority applies
   * its own death effects directly — this informs everyone else). */
  despawn(data?: unknown): void;
  /** Anyone: route a command to the authority ("hit", …). Dispatches locally
   * when we are the authority. */
  command(cmd: string, data: unknown): void;
  /** Last replicated velocity — used when a promoted host's bodies flip back
   * to dynamic so motion resumes seamlessly. */
  lastVelocity(): [number, number, number] | null;
  unregister(): void;
}

export function registerNetEntity(spec: NetEntitySpec): NetEntityHandle {
  const entry: Entry = { spec, buffer: new SnapshotBuffer(), lastSent: null };
  entities.set(spec.id, entry);

  if (pendingDespawns.has(spec.id)) {
    const data = pendingDespawns.get(spec.id);
    pendingDespawns.delete(spec.id);
    // Died before we finished loading — apply silently once mounted.
    queueMicrotask(() => spec.onDespawn?.(data, true));
  }

  return {
    despawn(data?: unknown) {
      if (!isHost()) return;
      session.sendEnvelope("a:despawn", { id: spec.id, data } satisfies DespawnMsg);
    },
    command(cmd: string, data: unknown) {
      entityCmd.request({ id: spec.id, cmd, data });
    },
    lastVelocity() {
      const latest = entry.buffer.latest();
      return latest?.v ?? null;
    },
    unregister() {
      // Guard against a new floor's entity re-registering under the same id
      // before the old floor finished unmounting.
      if (entities.get(spec.id) === entry) entities.delete(spec.id);
    },
  };
}

export function setExpectedEntities(ids: string[]): void {
  expectedIds = ids;
  pendingDespawns.clear();
}

/** Called when a floor unmounts. */
export function resetNetEntities(): void {
  entities.clear();
  expectedIds = [];
  pendingDespawns.clear();
}

// ── Pluggable world-sync providers ───────────────────────────────────────────

/** Systems with world state beyond entities (loot orbs, treasure, future
 * systems) register a provider; late-join sync then includes them
 * automatically. `apply` runs with catchup=true on the joining client. */
export interface SyncProvider {
  collect(): unknown;
  apply(data: unknown, catchup: boolean): void;
}

const syncProviders = new Map<string, SyncProvider>();

export function registerSyncProvider(key: string, provider: SyncProvider): () => void {
  syncProviders.set(key, provider);
  return () => {
    if (syncProviders.get(key) === provider) syncProviders.delete(key);
  };
}

// ── Incoming routing (module-level: exactly one subscriber app-wide) ─────────

onAuthority<{ ents: WireSnap[] }>("snap", (msg, meta) => {
  if (isHost()) return; // stale packet around a host migration
  for (const snap of msg.ents) {
    const entry = entities.get(snap.id);
    if (!entry) continue;
    entry.buffer.push({ t: meta.serverTime, p: snap.p, v: snap.v, q: snap.q });
    if (snap.f) entry.spec.onFields?.(snap.f);
    appliedSnaps++;
  }
});

onAuthority<DespawnMsg>("despawn", (msg, meta) => {
  if (meta.self) return;
  const entry = entities.get(msg.id);
  if (entry) entry.spec.onDespawn?.(msg.data, false);
  else pendingDespawns.set(msg.id, msg.data);
});

const entityCmd = hostCommand<CmdMsg>("entityCmd");
entityCmd.on((msg, meta) => {
  entities.get(msg.id)?.spec.onCommand?.(msg.cmd, msg.data, meta.from);
});

// ── Late-join world sync ─────────────────────────────────────────────────────

// Host: a late joiner needs the current floor.
netBus.on("syncRequest", ({ playerId }) => {
  if (!isHost()) return;
  const ents: WireSnap[] = [];
  for (const entry of entities.values()) {
    const snap = captureSnap(entry, true);
    if (snap) ents.push(snap);
  }
  const alive = new Set(entities.keys());
  const custom: Record<string, unknown> = {};
  for (const [key, provider] of syncProviders) custom[key] = provider.collect();
  const msg: WorldSyncMsg = {
    dead: expectedIds.filter((id) => !alive.has(id)),
    ents,
    custom,
  };
  sendAuthorityTo("worldSync", msg, playerId);
});

// Late joiner: apply the host's authoritative state.
onAuthority<WorldSyncMsg>("worldSync", (msg, meta) => {
  if (isHost() || meta.self) return;
  for (const id of msg.dead) {
    const entry = entities.get(id);
    if (entry) entry.spec.onDespawn?.(undefined, true);
    else pendingDespawns.set(id, undefined);
  }
  for (const snap of msg.ents) {
    const entry = entities.get(snap.id);
    if (!entry) continue;
    entry.buffer.push({ t: meta.serverTime, p: snap.p, v: snap.v, q: snap.q });
    if (snap.f) entry.spec.onFields?.(snap.f);
  }
  for (const [key, provider] of syncProviders) {
    if (key in msg.custom) provider.apply(msg.custom[key], true);
  }
});

// ── Ticking (driven by NetSystems) ───────────────────────────────────────────

/** Snapshot cadence. 15 Hz + interpolation reads far smoother than the raw
 * rate suggests because every snap carries velocity. */
export const SNAP_INTERVAL_S = 1 / 15;
/** Render this far behind the shared timeline — buys 2+ snaps of buffer. */
export const INTERP_DELAY_MS = 140;
/** Re-send an unchanged awake entity at least this often. */
const KEEPALIVE_MS = 500;

const POS_EPSILON_SQ = 0.0004; // 2 cm
const QUAT_EPSILON = 1 - 1e-5;

function captureSnap(entry: Entry, full: boolean): WireSnap | null {
  const body = entry.spec.body();
  if (!body) return null;
  const t = body.translation();
  const snap: WireSnap = { id: entry.spec.id, p: [q2(t.x), q2(t.y), q2(t.z)] };
  if (!entry.spec.immobile) {
    const v = body.linvel();
    snap.v = [q2(v.x), q2(v.y), q2(v.z)];
    if (entry.spec.rotation) {
      const q = body.rotation();
      snap.q = [q3(q.x), q3(q.y), q3(q.z), q3(q.w)];
    }
  }
  const fields = entry.spec.fields?.();
  if (fields) snap.f = fields;
  if (full) return snap;

  // Delta filter: only ship what changed (with a keepalive while awake).
  const now = netClock.serverNow();
  const asleep = body.isSleeping();
  const fKey = fields ? JSON.stringify(fields) : "";
  const prev = entry.lastSent;
  if (prev) {
    const moved =
      (prev.p[0] - snap.p[0]) ** 2 +
        (prev.p[1] - snap.p[1]) ** 2 +
        (prev.p[2] - snap.p[2]) ** 2 >
      POS_EPSILON_SQ;
    const turned =
      snap.q && prev.q
        ? Math.abs(
            snap.q[0] * prev.q[0] +
              snap.q[1] * prev.q[1] +
              snap.q[2] * prev.q[2] +
              snap.q[3] * prev.q[3],
          ) < QUAT_EPSILON
        : false;
    const fieldsChanged = fKey !== prev.f;
    const stale = !asleep && now - prev.at > KEEPALIVE_MS;
    if (!moved && !turned && !fieldsChanged && !stale) return null;
    if (asleep && prev.asleep && !fieldsChanged) return null; // settled — go quiet
  }
  entry.lastSent = { p: snap.p, q: snap.q ?? null, f: fKey, at: now, asleep };
  return snap;
}

/** Authority: collect changed snapshots and broadcast one batch. */
export function authorityTick(): void {
  const batch: WireSnap[] = [];
  for (const entry of entities.values()) {
    const snap = captureSnap(entry, false);
    if (snap) batch.push(snap);
  }
  if (batch.length > 0) session.sendEnvelope("a:snap", { ents: batch });
}

/** Replica: drive every entity's kinematic body through its buffer. */
export function replicaFrame(): void {
  const renderTime = netClock.serverNow() - INTERP_DELAY_MS;
  for (const entry of entities.values()) {
    if (entry.spec.immobile) continue;
    const body = entry.spec.body();
    if (!body) continue;
    if (!entry.buffer.sample(renderTime, scratchPose)) continue;
    body.setNextKinematicTranslation({
      x: scratchPose.p[0],
      y: scratchPose.p[1],
      z: scratchPose.p[2],
    });
    if (entry.spec.rotation && scratchPose.q) {
      body.setNextKinematicRotation({
        x: scratchPose.q[0],
        y: scratchPose.q[1],
        z: scratchPose.q[2],
        w: scratchPose.q[3],
      });
    }
  }
}

// ── Dev-only inspection for end-to-end tests ─────────────────────────────────

let appliedSnaps = 0;

if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__replication = {
    entityCount: () => entities.size,
    entityIds: () => [...entities.keys()],
    appliedSnaps: () => appliedSnaps,
    isHost: () => isHost(),
    net: () => useNet.getState(),
    snapOf: (id: string) => {
      const entry = entities.get(id);
      return entry ? captureSnap(entry, true) : null;
    },
  };
}
