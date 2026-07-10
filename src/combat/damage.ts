import { Vector3 } from "three";
import { playExplosion } from "../audio/sound";
import { gameEvents } from "../core/events";
import { flashLight } from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { getPlayerBody, playerPosition } from "../game/player-state";
import { forEachHittable } from "../game/registry";
import { useGame } from "../state/gameStore";

export type DamageTeam = "player" | "enemy" | "neutral";

export interface ExplosionOptions {
  position: Vector3 | [number, number, number];
  radius: number;
  damage: number;
  /** Peak physical impulse at the center. */
  impulse: number;
  /** Who caused it — decides who gets hurt. Neutral hurts everyone. */
  team: DamageTeam;
  color?: string;
  particles?: number;
  light?: number;
}

const tmp = new Vector3();
const center = new Vector3();

/** Radial damage + physical impulse. This is the heart of the sandbox: every
 * spell detonation shoves crates, pots, enemies and (a little) the caster. */
export function explode(opts: ExplosionOptions): void {
  const {
    radius,
    damage,
    impulse,
    team,
    color = "#ffb367",
    particles = 26,
    light = 30,
  } = opts;
  if (Array.isArray(opts.position)) center.set(...opts.position);
  else center.copy(opts.position);

  spawnBurst({
    position: [center.x, center.y, center.z],
    count: particles,
    color: [color, "#fff3d0", "#3c2a18"],
    speed: radius * 2.6,
    ttl: 0.7,
    size: 0.11,
  });
  flashLight([center.x, center.y, center.z], color, light);
  playExplosion(radius);

  forEachHittable((h) => {
    const hurtEnemies = team === "player" || team === "neutral";
    if (h.team === "enemy" && !hurtEnemies) return;
    const p = h.getPosition();
    tmp.set(p.x - center.x, p.y - center.y, p.z - center.z);
    const dist = tmp.length();
    if (dist > radius) return;
    const falloff = 1 - dist / radius;
    tmp.normalize().multiplyScalar(impulse * falloff);
    tmp.y += impulse * falloff * 0.35; // lift things — more satisfying
    h.hit(damage * falloff, { x: tmp.x, y: tmp.y, z: tmp.z });
  });

  // The player is also physical: enemy/neutral blasts damage them, and every
  // blast pushes them (friendly ones gently — that's the blast-jump).
  tmp.copy(playerPosition).sub(center);
  const playerDist = tmp.length();
  if (playerDist < radius) {
    const falloff = 1 - playerDist / radius;
    if (team !== "player") {
      useGame.getState().takeDamage(damage * falloff);
    }
    const body = getPlayerBody();
    if (body) {
      const push = impulse * falloff * (team === "player" ? 0.16 : 0.32);
      tmp.normalize().multiplyScalar(push);
      body.applyImpulse({ x: tmp.x, y: tmp.y + push * 0.5, z: tmp.z }, true);
    }
    gameEvents.emit("shake", Math.min(falloff * 0.7, 1));
  } else if (playerDist < radius * 2.5) {
    gameEvents.emit("shake", 0.15);
  }
}
