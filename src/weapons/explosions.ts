import { Vector3 } from "three";
import { playExplosion } from "../audio/sound";
import { gameEvents } from "../core/events";
import { flashLight } from "../fx/DynamicLights";
import { explosionFx, shockwaveFx } from "../fx/effects";
import type { DamageSource } from "../game/damageSource";
import { getFloorRules } from "../game/floorRules";
import { isHostileWizard } from "../game/hostility";
import { getPlayerBody, playerPosition } from "../game/player-state";
import { forEachHittable } from "../game/registry";
import { useGame } from "../state/gameStore";
import { localBlastEffect, type DamageTeam } from "./allegiance";
import { localWizardId } from "./localWizard";

export type { DamageTeam } from "./allegiance";

export interface ExplosionOptions {
  position: Vector3 | [number, number, number];
  /** Base radius; the floor's explosionRadiusMult (omens) scales it. */
  radius: number;
  damage: number;
  /** Peak physical impulse at the center. */
  impulse: number;
  /** Who caused it — decides who gets hurt. Neutral hurts everyone. */
  team: DamageTeam;
  /** Who to blame when this hurts the local wizard (death credit), and — for
   * player-team blasts — WHICH wizard cast it, which decides whether it may
   * hurt us at all (see allegiance.ts#localBlastEffect). Defaults: enemy →
   * ENEMY_SOURCE, neutral → WORLD_SOURCE, player → our own magic. */
  source?: DamageSource;
  color?: string;
  particles?: number;
  light?: number;
  /** Which look: "blast" (a detonation at the point, the default) or
   * "shockwave" (a ring of force centred on its caster — no fireball in
   * the caster's face, the energy is all in the expanding rings). */
  vfx?: "blast" | "shockwave";
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
    damage,
    impulse,
    team,
    color = "#ffb367",
    particles = 26,
    light = 30,
  } = opts;
  // Omens bend every blast alike — spells, barrels and slams — and the VFX,
  // sound and damage all use the same scaled radius so what you see is what hits.
  const radius = opts.radius * getFloorRules().explosionRadiusMult;
  if (Array.isArray(opts.position)) center.set(...opts.position);
  else center.copy(opts.position);

  // `particles` is the caller's sense of how big a deal this blast is (a
  // bolt's pop ≈ 14, a barrel 36, a boss slam 50) — it scales the effect's
  // particle budget, while the radius scales its size.
  if (opts.vfx === "shockwave") shockwaveFx(center, radius, color, particles / 36);
  else explosionFx(center, radius, color, particles / 36);
  flashLight([center.x, center.y, center.z], color, light);
  playExplosion(radius, [center.x, center.y, center.z]);

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

  // The local wizard is physical too, and every machine decides for itself:
  // dungeon and hostile-wizard blasts hurt and throw us, our own and allies'
  // only nudge us (the blast-jump). Runs for remote replays as well — your
  // health is always yours, so incoming blasts never wait on a round trip.
  tmp.copy(playerPosition).sub(center);
  const playerDist = tmp.length();
  if (playerDist < radius) {
    const falloff = 1 - playerDist / radius;
    const effect = localBlastEffect(team, opts.source, localWizardId(), isHostileWizard);
    if (effect.damageMult > 0) {
      useGame.getState().takeDamage(damage * falloff * effect.damageMult, effect.source);
    }
    const body = getPlayerBody();
    if (body) {
      const push = impulse * falloff * effect.pushMult;
      tmp.normalize().multiplyScalar(push);
      body.applyImpulse({ x: tmp.x, y: tmp.y + push * 0.5, z: tmp.z }, true);
    }
    gameEvents.emit("shake", Math.min(falloff * 0.7, 1));
  } else if (playerDist < radius * 2.5) {
    gameEvents.emit("shake", 0.15);
  }
}
