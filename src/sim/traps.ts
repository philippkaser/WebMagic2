import { aimDir, type Vec } from "../enemies/brains/common";
import { floorScale } from "../core/config";
import { getTrapDef } from "../world/trapCatalog";
import type { Vec3 } from "../world/types";
import type { SimWorld } from "./world";

/** The dart launcher's authority half: a reload clock, and a fast straight
 * bolt at the nearest wizard in range with a clear line — blamed on the
 * dungeon, not a monster. Spikes and warp runes need no authority (each
 * wizard's own client springs them on itself, world/traps.tsx). */

export const DART = {
  /** The emitter's muzzle above its mount point. */
  headHeight: 0.6,
  speed: 26,
  /** Seconds between shots. */
  reload: 1.6,
  /** The first shot comes min + random·spread seconds in (desyncs launchers). */
  firstShotMin: 1,
  firstShotSpread: 1.5,
  color: "#ffd24a",
  size: 0.1,
  // Bolts only hurt through their burst, so a dart needs a small one —
  // tight enough that it still has to actually reach you.
  blastRadius: 0.9,
  blastImpulse: 4,
} as const;

export class DartTrapController {
  private timer: number;
  private readonly head: Vec;
  private readonly aim: Vec = { x: 0, y: 0, z: 0 };
  private readonly range = getTrapDef("dart").radius;
  private readonly damage: number;

  constructor(
    private readonly world: SimWorld,
    pos: Vec3,
    floor: number,
  ) {
    this.head = { x: pos[0], y: pos[1] + DART.headHeight, z: pos[2] };
    this.timer = DART.firstShotMin + world.random() * DART.firstShotSpread;
    this.damage = getTrapDef("dart").baseDamage * floorScale(floor).enemyDamage;
  }

  /** One authority frame. Returns the unit aim when it fired (the view's
   * muzzle flash), else null. */
  think(dt: number): Vec | null {
    this.timer -= dt;
    if (this.timer > 0) return null;
    const head = this.head;
    const target = this.world.nearestWizard(head.x, head.y, head.z);
    if (target.dist > this.range) return null;
    const aim = aimDir(head, target.pos, this.aim);
    // Stop 0.6 short of the target, so the wizard's own collider never counts
    // as "blocked" — only walls and props between do.
    if (!this.world.clearShot(head, aim, target.dist - 0.6, null)) return null;
    this.timer = DART.reload;
    const s = DART.speed;
    this.world.act({
      type: "cast",
      data: {
        origin: [head.x + aim.x * 0.5, head.y, head.z + aim.z * 0.5],
        velocity: [aim.x * s, aim.y * s, aim.z * s],
        damage: this.damage,
        color: DART.color,
        size: DART.size,
        blastRadius: DART.blastRadius,
        blastImpulse: DART.blastImpulse,
        source: "world",
      },
    });
    return aim;
  }
}
