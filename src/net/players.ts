import { netBus } from "./bus";
import { getPlayerBody, playerPosition } from "../game/player-state";
import { onAuthority, peerMessage } from "./channels";
import { netClock } from "./clock";
import { FLOOR, type CorrectMsg, type PoseMsg } from "./floorProtocol";
import { useNet } from "./netStore";
import {
  makeSampledPose,
  q2,
  q3,
  SnapshotBuffer,
  type SampledPose,
} from "./snapshots";

/** Replication of the wizards themselves.
 *
 * The local player publishes its pose (position + velocity + yaw/pitch +
 * staff) at 20 Hz; every peer keeps those in a timestamped buffer. Two views
 * are exposed:
 *
 *  - `samplePeer`   — smooth, ~140 ms-delayed pose for RENDERING;
 *  - `estimatePeer` — freshest extrapolated pose (with velocity!) for
 *    GAMEPLAY: enemy targeting, aim leading, aggro. This is why enemies
 *    threaten and lead every wizard on the floor, not just the host's. */

export type { PoseMsg };

export interface PeerWizard {
  id: string;
  buffer: SnapshotBuffer;
  staffId: string;
  /** Server time of the newest pose — used to expire ghosts. */
  lastSeen: number;
}

const peers = new Map<string, PeerWizard>();

// The floor's host refused where we said we moved (a server host checks
// every pose — sim/motion.ts): we're back where it last believed us.
onAuthority<CorrectMsg>(FLOOR.correct, (msg) => {
  const p = msg?.p;
  if (!Array.isArray(p) || p.length !== 3 || !p.every((n) => typeof n === "number" && Number.isFinite(n))) return;
  const body = getPlayerBody() as unknown as {
    setTranslation(v: { x: number; y: number; z: number }, wake: boolean): void;
    setLinvel(v: { x: number; y: number; z: number }, wake: boolean): void;
  } | null;
  body?.setTranslation({ x: p[0], y: p[1], z: p[2] }, true);
  body?.setLinvel({ x: 0, y: 0, z: 0 }, true);
  playerPosition.set(p[0], p[1], p[2]);
});

const pose = peerMessage<PoseMsg>(FLOOR.pose, (msg, meta) => {
  let peer = peers.get(meta.from);
  if (!peer) {
    peer = { id: meta.from, buffer: new SnapshotBuffer(), staffId: msg.staffId, lastSeen: 0 };
    peers.set(meta.from, peer);
  }
  peer.staffId = msg.staffId;
  peer.lastSeen = meta.serverTime;
  peer.buffer.push({ t: meta.serverTime, p: msg.p, v: msg.v, a: msg.a });
});

netBus.on("assigned", (a) => {
  const selfId = useNet.getState().playerId;
  peers.clear();
  for (const m of a.members) {
    if (m.id === selfId) continue;
    peers.set(m.id, { id: m.id, buffer: new SnapshotBuffer(), staffId: "", lastSeen: 0 });
  }
});

netBus.on("peerJoined", (m) => {
  if (!peers.has(m.id)) {
    peers.set(m.id, { id: m.id, buffer: new SnapshotBuffer(), staffId: "", lastSeen: 0 });
  }
});

netBus.on("peerLeft", ({ playerId }) => {
  peers.delete(playerId);
});

netBus.on("leftDungeon", () => {
  peers.clear();
});

export function resetPeers(): void {
  peers.clear();
}

/** Ids of the other wizards on this floor (they render once a pose arrives). */
export function peerIds(): string[] {
  return [...peers.keys()];
}

export function peerStaffId(id: string): string {
  return peers.get(id)?.staffId ?? "";
}

export function peerName(id: string): string {
  return useNet.getState().roster[id] ?? "";
}

/** Smooth delayed pose for rendering. False until the first pose arrives. */
export function samplePeer(id: string, renderTime: number, out: SampledPose): boolean {
  const peer = peers.get(id);
  if (!peer || peer.buffer.size === 0) return false;
  return peer.buffer.sample(renderTime, out);
}

const estimate: SampledPose = makeSampledPose();

/** Freshest extrapolated pose for gameplay (targeting, aim leading). */
export function estimatePeer(id: string): SampledPose | null {
  const peer = peers.get(id);
  if (!peer || peer.buffer.size === 0) return null;
  return peer.buffer.sample(netClock.serverNow(), estimate) ? estimate : null;
}

// ── Local pose publishing ────────────────────────────────────────────────────

const PUBLISH_INTERVAL_S = 1 / 20;
let publishClock = 0;

/** Called every frame by the player controller; throttles itself. */
export function publishLocalPose(
  dt: number,
  p: { x: number; y: number; z: number },
  v: { x: number; y: number; z: number },
  yaw: number,
  pitch: number,
  staffId: string,
  /** Our health — a floor the server hosts takes it as where we start
   * there (no higher than the run's own record of it), then keeps it. */
  health: number,
): void {
  publishClock -= dt;
  if (publishClock > 0) return;
  publishClock = PUBLISH_INTERVAL_S;
  if (useNet.getState().mode !== "online") return;
  pose.send({
    p: [q2(p.x), q2(p.y), q2(p.z)],
    v: [q2(v.x), q2(v.y), q2(v.z)],
    a: [q3(yaw), q3(pitch)],
    staffId,
    h: Math.round(health * 10) / 10,
  });
}
