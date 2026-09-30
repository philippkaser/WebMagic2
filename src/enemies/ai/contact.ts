import { spawnBurst } from "../../fx/Particles";
import { getPlayerBody, playerPosition } from "../../game/player-state";
import { useGame } from "../../state/gameStore";

/** Contact damage against OUR wizard — local on every client (your health is
 * yours). Returns true when it landed. `knock` shoves the wizard away from
 * the enemy horizontally; `lift` pops them up. */
export function touchPlayer(
  x: number,
  y: number,
  z: number,
  opts: {
    reach: number;
    damage: number;
    timer: { current: number };
    cooldown: number;
    knock: number;
    lift?: number;
    color: string;
  },
): boolean {
  if (opts.timer.current > 0) return false;
  const dx = playerPosition.x - x;
  const dy = playerPosition.y - y;
  const dz = playerPosition.z - z;
  if (dx * dx + dy * dy + dz * dz > opts.reach * opts.reach) return false;
  opts.timer.current = opts.cooldown;
  useGame.getState().takeDamage(opts.damage);
  // Sparks at the point of contact — not inside the camera.
  spawnBurst({
    position: [x + dx * 0.3, y + dy * 0.3, z + dz * 0.3],
    count: 8,
    color: ["#ff5d5d", opts.color],
    speed: 4,
    ttl: 0.5,
    size: 0.05,
  });
  const h = Math.hypot(dx, dz) || 1;
  getPlayerBody()?.applyImpulse(
    { x: (dx / h) * opts.knock, y: opts.lift ?? 2, z: (dz / h) * opts.knock },
    true,
  );
  return true;
}
