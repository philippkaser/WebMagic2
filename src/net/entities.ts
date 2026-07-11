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
import { steer, STEER } from "./steering";

/** Host-authority entity replication — the declarative core.
 *
 * A world entity (enemy, prop, boss) registers ONCE with a spec describing
 * its body, replicated fields and lifecycle callbacks. Everything else is
 * automatic:
 *
 *  - authority side: snapshots (position/velocity/rotation/fields) are
 *    captured at a fixed rate, delta-filtered, quantized and broadcast;
 *  - replica side: bodies stay DYNAMIC (predicted) and are steered toward
 *    the buffered authoritative stream with corrective velocities — local
 *    impulses and the player capsule act on them instantly, and authority
 *    reconciles underneath (see net/steering.ts);
 *  - commands (e.g. "hit") route to the authority — locally when we are it —
 *    and `predictImpulse` applies the physical part immediately on replicas;
 *  - despawns broadcast live and replay silently for late joiners;
 *  - host migration is free: replica bodies are already dynamic and carry
 *    real velocities, so the promoted client's AI just resumes;
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
  setTranslation(v: { x: number; y: number; z: number }, wake: boolean): void;
  setRotation(q: { x: number; y: number; z: number; w: number }, wake: boolean): void;
  setLinvel(v: { x: number; y: number; z: number }, wake: boolean): void;
  setAngvel(v: { x: number; y: number; z: number }, wake: boolean): void;
  applyImpulse(v: { x: number; y: number; z: number }, wake: boolean): void;
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
  /** Server time until which local prediction holds the steering leash soft
   * (set by predictImpulse — the round trip authority needs to agree). */
  predictUntil: number;
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
  /** Replica prediction: apply the physical part of an action immediately
   * (the authoritative damage travels via command). Softens the steering
   * leash for one round trip so the prediction isn't fought. No-op on the
   * authority — its own physics is already the truth. */
  predictImpulse(impulse: { x: number; y: number; z: number }, scale?: number): void;
  unregister(): void;
}

export function registerNetEntity(spec: NetEntitySpec): NetEntityHandle {
  const entry: Entry = { spec, buffer: new SnapshotBuffer(), lastSent: null, predictUntil: 0 };
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
    predictImpulse(impulse, scale = 1) {
      if (isHost()) return;
      spec.body()?.applyImpulse(
        { x: impulse.x * scale, y: impulse.y * scale, z: impulse.z * scale },
        true,
      );
      entry.predictUntil = netClock.serverNow() + PREDICT_WINDOW_MS;
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

/** Snapshot cadence. 20 Hz + velocity-aware interpolation reads far smoother
 * than the raw rate suggests. */
export const SNAP_INTERVAL_S = 1 / 20;
/** Target this far behind the shared timeline — ~2 snaps of jitter buffer.
 * Predicted replicas soften the cost: corrections are velocities, not warps. */
export const INTERP_DELAY_MS = 90;
/** Re-send an unchanged awake entity at least this often. */
const KEEPALIVE_MS = 500;
/** How long a predicted impulse keeps the steering leash soft (~1 RTT + one
 * snapshot interval, so authority has time to agree with the prediction). */
const PREDICT_WINDOW_MS = 300;

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

const targetPos = { x: 0, y: 0, z: 0 };
const targetVel = { x: 0, y: 0, z: 0 };
const targetQuat = { x: 0, y: 0, z: 0, w: 1 };
const ZERO_VEL = { x: 0, y: 0, z: 0 };

/** Replica: steer every entity's PREDICTED dynamic body toward its buffered
 * authoritative stream. `localPlayer` (when given) softens the leash for
 * bodies the local player is close enough to be shoving. */
export function replicaFrame(localPlayer?: { x: number; y: number; z: number }): void {
  const now = netClock.serverNow();
  const renderTime = now - INTERP_DELAY_MS;
  for (const entry of entities.values()) {
    if (entry.spec.immobile) continue;
    const body = entry.spec.body();
    if (!body) continue;
    if (!entry.buffer.sample(renderTime, scratchPose)) continue;

    targetPos.x = scratchPose.p[0];
    targetPos.y = scratchPose.p[1];
    targetPos.z = scratchPose.p[2];
    targetVel.x = scratchPose.v[0];
    targetVel.y = scratchPose.v[1];
    targetVel.z = scratchPose.v[2];
    const syncRot = entry.spec.rotation === true && scratchPose.q !== null;
    if (syncRot) {
      targetQuat.x = scratchPose.q![0];
      targetQuat.y = scratchPose.q![1];
      targetQuat.z = scratchPose.q![2];
      targetQuat.w = scratchPose.q![3];
    }

    const t = body.translation();
    // Leash tightness: soft while our prediction is in flight or the local
    // player is close enough to be physically interacting with this body.
    let gain: number = STEER.gain;
    if (entry.predictUntil > now) {
      gain = STEER.softGain;
    } else if (localPlayer) {
      const dSq =
        (localPlayer.x - t.x) ** 2 + (localPlayer.y - t.y) ** 2 + (localPlayer.z - t.z) ** 2;
      if (dSq < STEER.interactRadius * STEER.interactRadius) gain = STEER.softGain;
    }

    const cmd = steer(
      t,
      syncRot ? body.rotation() : null,
      targetPos,
      targetVel,
      syncRot ? targetQuat : null,
      gain,
    );
    if (cmd.kind === "rest") continue;
    if (cmd.kind === "snap") {
      body.setTranslation(targetPos, true);
      body.setLinvel(targetVel, true);
      if (syncRot) {
        body.setRotation(targetQuat, true);
        body.setAngvel(ZERO_VEL, true);
      }
      continue;
    }
    body.setLinvel(cmd.linvel, true);
    if (cmd.angvel) body.setAngvel(cmd.angvel, true);
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
