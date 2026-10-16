/** A floor-mate's `p:pose` as it comes off the wire, checked before anything
 * keeps it.
 *
 * Peer messages are untrusted (anyone may send `p:`, and the relay forwards
 * them unread), and a pose isn't only drawn. It goes into a snapshot buffer
 * that RemoteWizards, PeerBodies, targeting and the audio sample every frame,
 * so one `p` that isn't three numbers throws in each of those useFrames and
 * the frame dies there, over and over while it's the newest pose. Garbage
 * that does sample comes out NaN, which reaches Rapier as a kinematic
 * translation, and slips through the check that a cast leaves from where its
 * caster stands (NaN is never too far). So a pose that isn't plainly a wizard
 * somewhere on the floor is dropped whole, and the last good one stands.
 * Pure; unit-tested. */

/** No floor, hall or camp reaches this far from the origin, and nothing in
 * this game moves this fast or turns this far — past it is garbage. */
export const POSE_LIMIT = 1e4;

export interface ReceivedPose {
  p: [number, number, number];
  v: [number, number, number];
  /** yaw, pitch — absent if they sent none (they keep their last facing). */
  a?: [number, number];
  /** Their staff, or null to keep the one they had. */
  staffId: string | null;
}

/** Check a received pose. Returns a clean copy, or null if it can't be one:
 * not an object, or a position or velocity that isn't three sane numbers, or
 * angles sent that aren't two. A staff that isn't a string just isn't news. */
export function readPose(raw: unknown): ReceivedPose | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const p = saneVec(m.p, 3);
  const v = saneVec(m.v, 3);
  if (!p || !v) return null;
  const pose: ReceivedPose = {
    p: [p[0], p[1], p[2]],
    v: [v[0], v[1], v[2]],
    staffId: typeof m.staffId === "string" ? m.staffId : null,
  };
  if (m.a !== undefined) {
    const a = saneVec(m.a, 2);
    if (!a) return null;
    pose.a = [a[0], a[1]];
  }
  return pose;
}

function saneVec(v: unknown, n: number): number[] | null {
  if (!Array.isArray(v) || v.length !== n) return null;
  for (const x of v) {
    // Also refuses NaN and ±Infinity: neither is less than anything.
    if (typeof x !== "number" || !(Math.abs(x) < POSE_LIMIT)) return null;
  }
  return v as number[];
}
