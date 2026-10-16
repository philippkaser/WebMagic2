import { LIFE_STEPS, readLifeByte } from "../game/heart";
import { netBus } from "./bus";
import { peerMessage } from "./channels";
import { netClock } from "./clock";
import { useNet } from "./netStore";
import { readPose } from "./poseMessage";
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

/** What we send. What arrives is only what a peer claims it is: it goes
 * through net/poseMessage readPose before anything keeps it. */
export interface PoseMsg {
  p: [number, number, number];
  v: [number, number, number];
  /** yaw, pitch */
  a: [number, number];
  staffId: string;
  /** Health, as one small integer (game/heart lifeByte): 0…15, plus 16 at
   * the Brink. Shown to floor-mates only — health is still decided on its
   * owner's machine. Absent from older clients. */
  h?: number;
}

export interface PeerWizard {
  id: string;
  buffer: SnapshotBuffer;
  staffId: string;
  /** Server time of the newest pose — used to expire ghosts. */
  lastSeen: number;
  /** Their share of health (0…1), or −1 if they've never said. */
  life: number;
  /** Inside their Brink's window. */
  brink: boolean;
}

function newPeer(id: string, staffId = ""): PeerWizard {
  return { id, buffer: new SnapshotBuffer(), staffId, lastSeen: 0, life: -1, brink: false };
}

const peers = new Map<string, PeerWizard>();

const pose = peerMessage<PoseMsg>("pose", (raw, meta) => {
  // Untrusted: a pose that isn't plainly a wizard somewhere is dropped whole
  // (net/poseMessage says what one bad pose in the buffer would break).
  const msg = readPose(raw);
  if (!msg) return;
  let peer = peers.get(meta.from);
  if (!peer) {
    peer = newPeer(meta.from, msg.staffId ?? "");
    peers.set(meta.from, peer);
  }
  if (msg.staffId !== null) peer.staffId = msg.staffId;
  peer.lastSeen = meta.serverTime;
  const life = readLifeByte(raw.h);
  peer.life = life ? life.frac : -1;
  peer.brink = life ? life.brink : false;
  peer.buffer.push({ t: meta.serverTime, p: msg.p, v: msg.v, a: msg.a });
});

netBus.on("assigned", (a) => {
  const selfId = useNet.getState().playerId;
  peers.clear();
  for (const m of a.members) {
    if (m.id === selfId) continue;
    peers.set(m.id, newPeer(m.id));
  }
});

netBus.on("peerJoined", (m) => {
  if (!peers.has(m.id)) {
    peers.set(m.id, newPeer(m.id));
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

/** A floor-mate's share of health as they last told it (0…1), or −1. */
export function peerLife(id: string): number {
  return peers.get(id)?.life ?? -1;
}

/** Is a floor-mate inside their Brink's window? */
export function peerAtBrink(id: string): boolean {
  return peers.get(id)?.brink ?? false;
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
/** Our own life byte (game/heart lifeByte), kept fresh by the HUD. */
let localLife = LIFE_STEPS;

/** What our pose says of our health (the HUD writes it every frame). */
export function setLocalLife(byte: number): void {
  localLife = byte;
}

/** Called every frame by the player controller; throttles itself. */
export function publishLocalPose(
  dt: number,
  p: { x: number; y: number; z: number },
  v: { x: number; y: number; z: number },
  yaw: number,
  pitch: number,
  staffId: string,
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
    h: localLife,
  });
}
