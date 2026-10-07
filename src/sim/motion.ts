import type RAPIER from "@dimforge/rapier3d-compat";
import { GROUPS, PLAYER, WALL_HEIGHT } from "../core/config";
import type { Vec3 } from "../world/types";
import { interactionGroups } from "./bodies";
import type { Rapier } from "./floorPhysics";

/** Could a wizard really have moved like that? The floor's authority asks
 * this of every pose a wizard reports (server/floorHost.ts): a wizard's
 * client moves its own body — that's what makes movement feel instant —
 * so the authority can only judge the path it's told about.
 *
 * A pose is refused when it
 *  - lies outside the floor (beside the map, under the floor, over the roof),
 *  - lies inside a wall,
 *  - got there THROUGH a wall since the last good pose, or
 *  - outruns the wizard's movement budget: a reservoir of `burst` metres
 *    that refills at a sustained speed well above anything legit (running
 *    with speed gear, dashing, blast-jumping, being thrown by a barrel) —
 *    but not a teleport across the floor to the loot.
 * A refused pose is ignored: the authority keeps the last good one (for
 * range checks and the enemies' aim) and the wizard is put back there.
 *
 * Pure logic over the floor's physics world (walls only). */

export const MOTION = {
  /** Metres of slack for bursts of speed. */
  burst: 24,
  /** Sustained speed allowed, as a multiple of the wizard's run speed. */
  sustainedSlack: 2,
  /** A wall must be crossed by at least this much to count: a fast wizard
   * rounding a corner between two poses can clip its edge, never its depth. */
  wallDepth: 0.6,
  /** How far outside the floor's walls (and above/below) still counts as on it. */
  margin: 1,
} as const;

export type MoveVerdict = "ok" | "outside" | "inWall" | "throughWall" | "tooFast";

/** Only the floor's own fixed pieces (walls, floor, ceiling, rift stones). */
const WALLS_ONLY = interactionGroups(GROUPS.PLAYER, [GROUPS.WORLD]);

interface Track {
  pos: Vec3;
  /** Metres of burst left. */
  budget: number;
  /** When the last good pose arrived (s, the authority's clock). */
  at: number;
}

export class MotionGuard {
  private readonly tracks = new Map<string, Track>();
  private readonly ray: RAPIER.Ray;

  constructor(
    R: Rapier,
    private readonly world: RAPIER.World,
    /** The floor's half-extent (layout.extent). */
    private readonly extent: number,
  ) {
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  }

  /** Judge a pose that arrived at `now` (s). `speedMult` is the wizard's
   * gear (DerivedStats.speedMult). "ok" moves the wizard there. */
  judge(id: string, pos: Vec3, now: number, speedMult = 1): MoveVerdict {
    if (!this.onFloor(pos)) return "outside";
    if (this.insideWall(pos)) return "inWall";
    const track = this.tracks.get(id);
    if (!track) {
      this.tracks.set(id, { pos: [pos[0], pos[1], pos[2]], budget: MOTION.burst, at: now });
      return "ok";
    }
    const sustained = PLAYER.speed * Math.max(1, speedMult) * MOTION.sustainedSlack;
    const budget = Math.min(MOTION.burst, track.budget + Math.max(0, now - track.at) * sustained);
    const dist = Math.hypot(pos[0] - track.pos[0], pos[1] - track.pos[1], pos[2] - track.pos[2]);
    if (dist > budget) return "tooFast";
    if (this.throughWall(track.pos, pos, dist)) return "throughWall";
    track.pos = [pos[0], pos[1], pos[2]];
    track.budget = budget - dist;
    track.at = now;
    return "ok";
  }

  /** The last pose this wizard was believed at. */
  lastGood(id: string): Readonly<Vec3> | null {
    return this.tracks.get(id)?.pos ?? null;
  }

  forget(id: string): void {
    this.tracks.delete(id);
  }

  private onFloor(p: Vec3): boolean {
    const e = this.extent + MOTION.margin;
    return (
      Math.abs(p[0]) <= e && Math.abs(p[2]) <= e && p[1] >= -MOTION.margin && p[1] <= WALL_HEIGHT + MOTION.margin
    );
  }

  private insideWall(p: Vec3): boolean {
    const hit = this.world.projectPoint({ x: p[0], y: p[1], z: p[2] }, true, undefined, WALLS_ONLY);
    return hit !== null && hit.isInside;
  }

  /** Does the straight path a→b pass through more than a corner's worth of
   * wall? Measured from both ends: the stretch between the first wall hit
   * going forward and the first going back is inside something. */
  private throughWall(a: Vec3, b: Vec3, dist: number): boolean {
    if (dist < MOTION.wallDepth) return false;
    const fwd = this.cast(a, b, dist);
    if (fwd === null) return false;
    const back = this.cast(b, a, dist);
    return back !== null && dist - fwd - back >= MOTION.wallDepth;
  }

  private cast(from: Vec3, to: Vec3, dist: number): number | null {
    const r = this.ray;
    r.origin.x = from[0];
    r.origin.y = from[1];
    r.origin.z = from[2];
    r.dir.x = (to[0] - from[0]) / dist;
    r.dir.y = (to[1] - from[1]) / dist;
    r.dir.z = (to[2] - from[2]) / dist;
    const hit = this.world.castRay(r, dist, true, undefined, WALLS_ONLY);
    return hit ? hit.timeOfImpact : null;
  }
}
