import { gameEvents } from "../core/events";
import { ENEMY_SOURCE, WORLD_SOURCE, wizardSource, type DamageSource } from "../game/damageSource";
import { getPlayerBody } from "../game/player-state";
import { hostEvent, onAuthority } from "../net/channels";
import { FLOOR, type WizardHitMsg, type YouFellMsg } from "../net/floorProtocol";
import { useGame } from "../state/gameStore";
import type { BoomData, CastData } from "../sim/world";
import { explode } from "./explosions";
import { fireProjectile } from "./projectiles";

/** Authoritative combat effects (enemy shots, boss slams, trap darts) as host
 * events.
 *
 * One handler covers every machine: on the host (`meta.self`) the effect is
 * real and damages entities; on replicas it replays cosmetically vs entities
 * (host authority — nothing is double-counted) while still hurting and
 * shoving the LOCAL player, so your survival never waits on a round trip. */

/** Who a dungeon effect is blamed on when it hurts a wizard: a monster
 * ("enemy", the default) or the dungeon itself ("world" — traps). Sent as a
 * tag rather than a DamageSource so the wire stays a closed, tiny vocabulary. */
export type DungeonSourceTag = "enemy" | "world";

function dungeonSource(tag: DungeonSourceTag | undefined): DamageSource {
  return tag === "world" ? WORLD_SOURCE : ENEMY_SOURCE;
}

/** An enemy bolt — the sim's CastData (sim/world.ts), trap darts included. */
export type EnemyCastData = CastData;

export const enemyCast = hostEvent<EnemyCastData>(FLOOR.enemyCast, (d, meta) => {
  fireProjectile({
    team: "enemy",
    source: dungeonSource(d.source),
    position: d.origin,
    velocity: d.velocity,
    damage: d.damage,
    color: d.color,
    size: d.size,
    blastRadius: d.blastRadius,
    blastImpulse: d.blastImpulse,
    cosmetic: !meta.self,
  });
});

export type { BoomData };

// ── Duels a server host decides ───────────────────────────────────────────────

/** Another wizard's spell hurt us — the server's copy of it, judged as its
 * caster saw us (lag compensation). Our health is still ours to show: apply
 * the damage (through our gear, credited to them) and the shove. */
onAuthority<WizardHitMsg>(FLOOR.wizardHit, (d) => {
  const i = d?.impulse;
  if (typeof d?.by !== "string" || !(d.damage >= 0) || !Array.isArray(i) || !i.every(Number.isFinite)) return;
  useGame.getState().takeDamage(d.damage, wizardSource(d.by));
  getPlayerBody()?.applyImpulse({ x: i[0], y: i[1], z: i[2] }, true);
  gameEvents.emit("shake", Math.min(Math.hypot(i[0], i[1], i[2]) / 12, 1));
});

/** The server knows we're dead: the duel damage alone passed all we could
 * have healed. Fall, whatever our own count says. */
onAuthority<YouFellMsg>(FLOOR.youFell, (d) => {
  const s = useGame.getState();
  if (s.phase !== "dungeon" || s.health <= 0) return;
  s.takeDamage(Infinity, typeof d?.killer === "string" ? wizardSource(d.killer) : WORLD_SOURCE);
});

export const enemyBoom = hostEvent<BoomData>(FLOOR.enemyBoom, (d, meta) => {
  explode({
    position: d.pos,
    radius: d.radius,
    damage: d.damage,
    impulse: d.impulse,
    team: "enemy",
    source: dungeonSource(d.source),
    color: d.color,
    particles: 50,
    light: 50,
    remote: !meta.self,
  });
});
