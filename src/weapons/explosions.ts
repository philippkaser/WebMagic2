import { Vector3 } from "three";
import { playExplosion } from "../audio/sound";
import { gameEvents } from "../core/events";
import { flashLight } from "../fx/DynamicLights";
import { explosionFx, shockwaveFx } from "../fx/effects";
import type { DamageSource } from "../game/damageSource";
import { getFloorRules } from "../game/floorRules";
import { isHostileWizard } from "../game/hostility";
import { getPlayerBody, playerPosition } from "../game/player-state";
import { forEachHittable, type Hittable } from "../game/registry";
import { useGame } from "../state/gameStore";
import { localBlastEffect, type DamageTeam } from "./allegiance";
import { land } from "./land";
import { localWizardId } from "./localWizard";
import { critMult, type WeakSpot } from "./precision";
import { reportLocalHit } from "./procs";

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
  /** Made by a legendary power: its hits don't roll powers again. */
  noProc?: boolean;
  /** How heavy each of its hits lands, 0…1 (weapons/castFeel hitWeight) —
   * for the shooter's confirm and hitstop. Default: from `particles`. */
  weight?: number;
  /** What a bolt burst ON: that body takes the full blow (the blast
   * measured to its centre would rob a direct hit of a third), times the
   * precision multiplier if the bolt went through its weak point (`crit`,
   * else null). */
  direct?: { target: Hittable; crit: WeakSpot | null };
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
  gameEvents.emit("explosion", {
    x: center.x,
    y: center.y,
    z: center.z,
    radius,
    color,
    power: particles / 36,
    vfx: opts.vfx ?? "blast",
  });

  if (!opts.remote) {
    // Our own magic's toll on creatures feeds lifesteal and the
    // legendaries' powers (weapons/procs.ts).
    const ours = team === "player" && opts.source?.kind === "wizard" && opts.source.id === localWizardId();
    const weight = opts.weight ?? Math.min(1, particles / 36);
    const direct = opts.direct;
    let dealt = 0;
    forEachHittable((h) => {
      const hurtEnemies = team === "player" || team === "neutral";
      if (h.team === "enemy" && !hurtEnemies) return;
      const p = h.getPosition();
      tmp.set(p.x - center.x, p.y - center.y, p.z - center.z);
      const dist = tmp.length();
      const struck = direct?.target === h;
      if (dist > radius && !struck) return;
      const falloff = struck ? 1 : 1 - dist / radius;
      const spot = struck ? direct.crit : null;
      const dmg = damage * falloff * (spot ? critMult(spot) : 1);
      tmp.normalize().multiplyScalar(impulse * falloff);
      tmp.y += impulse * falloff * 0.35; // lift things — more satisfying
      // Numbers and sparks: the bolt's own point on what it burst on, the
      // body for what the blast caught.
      const at: [number, number, number] = struck ? [center.x, center.y, center.z] : [p.x, p.y, p.z];
      land(h, dmg, { x: tmp.x, y: tmp.y, z: tmp.z }, { mine: ours, at, crit: spot !== null }, weight);
      if (h.team === "enemy") dealt += dmg;
    });
    if (ours && !opts.noProc && dealt > 0) reportLocalHit(center, dealt);
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
