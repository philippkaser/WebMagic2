import { Vector3 } from "three";
import { playExplosion } from "../audio/sound";
import { gameEvents } from "../core/events";
import { flashLight } from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { getPlayerBody, playerPosition } from "../game/player-state";
import { forEachHittable } from "../game/registry";
import { useGame } from "../state/gameStore";

export type DamageTeam = "player" | "enemy" | "neutral";

/** A "hit" command payload as it travels over the network (client → floor
 * authority). Untrusted: the sender picks the numbers. */
export interface HitData {
  damage: number;
  impulse: { x: number; y: number; z: number };
}

/** Ceiling for a single networked hit. The strongest legit hit today is
 * ~44 (34 base × 1.3 damage mult); the headroom covers future item stacking
 * without letting a hacked client one-shot everything. */
const MAX_HIT_DAMAGE = 100;
/** Per-axis impulse ceiling (legit peak ≈ 60 incl. the blast y-lift). */
const MAX_HIT_IMPULSE = 150;

const clamp = (n: number, max: number) => Math.min(max, Math.max(-max, n));

/** Validate a hit command that arrived from another player. Returns a copy
 * with damage/impulse clamped to plausible gameplay ranges, or null when the
 * payload is malformed (wrong shape, NaN/Infinity — NaN hp would make an
 * entity unkillable). Authorities must route every remote hit through this. */
export function sanitizeHit(data: unknown): HitData | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as HitData;
  const i = d.impulse;
  if (
    typeof d.damage !== "number" ||
    !Number.isFinite(d.damage) ||
    typeof i !== "object" ||
    i === null ||
    !Number.isFinite(i.x) ||
    !Number.isFinite(i.y) ||
    !Number.isFinite(i.z)
  ) {
    return null;
  }
  return {
    damage: Math.min(MAX_HIT_DAMAGE, Math.max(0, d.damage)),
    impulse: {
      x: clamp(i.x, MAX_HIT_IMPULSE),
      y: clamp(i.y, MAX_HIT_IMPULSE),
      z: clamp(i.z, MAX_HIT_IMPULSE),
    },
  };
}

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
  /** Replayed from another client: full VFX and local-player damage, but no
   * entity damage — the authoritative copy of this explosion runs elsewhere.
   * Prevents double damage in multiplayer. */
  remote?: boolean;
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

  // Layered detonation, all chunky pixel debris: a white-hot core that dies
  // fast, tumbling flame chunks, fast sparks that rain and bounce, slow dark
  // smoke that rises, and a flat shockwave ring racing along the ground.
  // `particles` is the budget knob — bigger blasts spend more everywhere.
  const at: [number, number, number] = [center.x, center.y, center.z];
  spawnBurst({
    position: at,
    count: Math.round(particles * 0.3),
    color: ["#fffbe8", "#ffe9a8", color],
    speed: radius * 3.1,
    upward: 1,
    ttl: 0.2,
    size: 0.19,
    gravity: 0,
    drag: 5,
  });
  spawnBurst({
    position: at,
    count: Math.round(particles * 0.4),
    color: [color, "#ffd27a", "#ff7a2a"],
    speed: radius * 2.3,
    ttl: 0.55,
    size: 0.13,
    gravity: -7,
    drag: 2,
    spawnRadius: radius * 0.12,
  });
  spawnBurst({
    position: at,
    count: Math.round(particles * 0.25),
    color: ["#fff3d0", "#ffca6b", color],
    speed: radius * 4.4,
    upward: 3,
    ttl: 1.05,
    size: 0.055,
    gravity: -24,
    drag: 0.35,
  });
  spawnBurst({
    position: at,
    count: Math.round(particles * 0.3),
    color: ["#241c16", "#3c2a18", "#141110"],
    speed: radius * 0.8,
    upward: 1.6,
    ttl: 1.4,
    size: 0.26,
    gravity: 2.4,
    drag: 2.6,
    spawnRadius: radius * 0.3,
  });
  spawnBurst({
    position: [center.x, center.y + 0.1, center.z],
    count: Math.round(8 + radius * 3),
    color: ["#fff3d0", color],
    speed: radius * 4.6,
    upward: 0,
    ttl: 0.28,
    size: 0.09,
    gravity: 0,
    drag: 3.2,
    ring: true,
  });
  flashLight(at, "#fff6e0", light * 0.9, radius * 3.2);
  flashLight(at, color, light, radius * 2.4);
  playExplosion(radius);

  if (!opts.remote) {
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
  }

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
    gameEvents.emit("shake", Math.min(0.25 + falloff * (0.5 + radius * 0.09), 1));
  } else if (playerDist < radius * 3) {
    // Nearby blasts still thump — force you can feel from the next room over.
    gameEvents.emit("shake", 0.28 * (1 - playerDist / (radius * 3)) + 0.06);
  }
}
